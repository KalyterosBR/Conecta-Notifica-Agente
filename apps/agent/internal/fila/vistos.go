package fila

import (
	"bufio"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Vistos guarda os IDs de evento já enfileirados dentro de uma janela de
// tempo. Serve para a varredura de marcações atrasadas não reenviar o que já
// passou. É persistido para sobreviver a restart do serviço — sem isso, todo
// reinício repetiria a janela inteira para o servidor deduplicar.
type Vistos struct {
	mu      sync.Mutex
	caminho string
	janela  time.Duration
	itens   map[string]int64
	arquivo *os.File
}

func AbrirVistos(dir string, janela time.Duration) (*Vistos, error) {
	v := &Vistos{
		caminho: filepath.Join(dir, "vistos.log"),
		janela:  janela,
		itens:   map[string]int64{},
	}
	if err := v.carregar(); err != nil {
		return nil, err
	}
	// Reescreve já podado e reabre em append.
	if err := v.compactar(); err != nil {
		return nil, err
	}
	return v, nil
}

func (v *Vistos) carregar() error {
	f, err := os.Open(v.caminho)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return err
	}
	defer f.Close()

	limite := time.Now().Add(-v.janela).Unix()
	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 0, 64*1024), 1<<20)
	for sc.Scan() {
		linha := sc.Text()
		sep := strings.IndexByte(linha, ' ')
		if sep <= 0 {
			continue
		}
		ts, err := strconv.ParseInt(linha[:sep], 10, 64)
		if err != nil || ts < limite {
			continue
		}
		v.itens[linha[sep+1:]] = ts
	}
	return sc.Err()
}

// Marcar registra o ID e devolve true se ele ainda não era conhecido.
func (v *Vistos) Marcar(id string) bool {
	v.mu.Lock()
	defer v.mu.Unlock()
	if _, ok := v.itens[id]; ok {
		return false
	}
	agora := time.Now().Unix()
	v.itens[id] = agora
	if v.arquivo != nil {
		fmt.Fprintf(v.arquivo, "%d %s\n", agora, id)
	}
	return true
}

func (v *Vistos) Conhece(id string) bool {
	v.mu.Lock()
	defer v.mu.Unlock()
	_, ok := v.itens[id]
	return ok
}

// Compactar poda o que saiu da janela e reescreve o arquivo.
func (v *Vistos) Compactar() error {
	v.mu.Lock()
	defer v.mu.Unlock()
	return v.compactar()
}

func (v *Vistos) compactar() error {
	if v.arquivo != nil {
		v.arquivo.Close()
		v.arquivo = nil
	}
	limite := time.Now().Add(-v.janela).Unix()
	for id, ts := range v.itens {
		if ts < limite {
			delete(v.itens, id)
		}
	}

	tmp := v.caminho + ".tmp"
	f, err := os.Create(tmp)
	if err != nil {
		return err
	}
	w := bufio.NewWriter(f)
	for id, ts := range v.itens {
		fmt.Fprintf(w, "%d %s\n", ts, id)
	}
	if err := w.Flush(); err != nil {
		f.Close()
		return err
	}
	if err := f.Close(); err != nil {
		return err
	}
	if err := os.Rename(tmp, v.caminho); err != nil {
		return err
	}
	v.arquivo, err = os.OpenFile(v.caminho, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
	return err
}

func (v *Vistos) Fechar() error {
	v.mu.Lock()
	defer v.mu.Unlock()
	if v.arquivo == nil {
		return nil
	}
	err := v.arquivo.Close()
	v.arquivo = nil
	return err
}
