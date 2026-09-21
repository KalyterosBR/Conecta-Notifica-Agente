// Package fila é o buffer local em disco. Tudo que sai do SQL Server é
// gravado aqui antes de ir para a rede, então queda de internet não perde
// marcação: o envio retoma de onde parou quando o link volta.
package fila

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sync"

	"github.com/conecta/notifica-agent/internal/modelo"
)

// compactarAcima define quando reescrevemos o arquivo descartando o trecho já
// enviado, para o disco não crescer indefinidamente.
const compactarAcima = 8 << 20 // 8 MB

type Estado struct {
	Cursor       string `json:"cursor"`
	Offset       int64  `json:"offset"`
	Enfileirados int64  `json:"enfileirados"`
	Enviados     int64  `json:"enviados"`
	UltimoEvento string `json:"ultimo_evento"`
}

type Fila struct {
	mu       sync.Mutex
	dir      string
	arquivo  string
	estadoFn string
	escrita  *os.File
	estado   Estado
}

func Abrir(dir string) (*Fila, error) {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, fmt.Errorf("criando %s: %w", dir, err)
	}
	f := &Fila{
		dir:      dir,
		arquivo:  filepath.Join(dir, "fila.jsonl"),
		estadoFn: filepath.Join(dir, "estado.json"),
	}
	if err := f.carregarEstado(); err != nil {
		return nil, err
	}
	w, err := os.OpenFile(f.arquivo, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
	if err != nil {
		return nil, fmt.Errorf("abrindo fila: %w", err)
	}
	f.escrita = w

	// Offset maior que o arquivo indica estado e fila fora de sincronia
	// (arquivo apagado à mão, por exemplo). Recomeçamos do início do arquivo.
	if st, err := w.Stat(); err == nil && f.estado.Offset > st.Size() {
		f.estado.Offset = 0
		_ = f.salvarEstado()
	}
	return f, nil
}

func (f *Fila) Fechar() error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if err := f.salvarEstado(); err != nil {
		return err
	}
	return f.escrita.Close()
}

func (f *Fila) carregarEstado() error {
	b, err := os.ReadFile(f.estadoFn)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("lendo estado: %w", err)
	}
	if err := json.Unmarshal(b, &f.estado); err != nil {
		return fmt.Errorf("estado.json corrompido: %w", err)
	}
	return nil
}

// salvarEstado grava com temporário + rename para não deixar um estado
// truncado se a máquina cair no meio da escrita.
func (f *Fila) salvarEstado() error {
	b, err := json.Marshal(f.estado)
	if err != nil {
		return err
	}
	tmp := f.estadoFn + ".tmp"
	if err := os.WriteFile(tmp, b, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, f.estadoFn)
}

func (f *Fila) Estado() Estado {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.estado
}

func (f *Fila) Pendentes() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	n := f.estado.Enfileirados - f.estado.Enviados
	if n < 0 {
		return 0
	}
	return int(n)
}

func (f *Fila) Cursor() string {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.estado.Cursor
}

func (f *Fila) DefinirCursor(c string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.estado.Cursor = c
	return f.salvarEstado()
}

// Enfileirar grava os eventos e avança o cursor na mesma operação, para não
// existir janela em que o cursor andou mas o evento não foi persistido.
func (f *Fila) Enfileirar(evs []modelo.Evento, cursor string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if len(evs) > 0 {
		w := bufio.NewWriter(f.escrita)
		for _, e := range evs {
			b, err := json.Marshal(e)
			if err != nil {
				return err
			}
			if _, err := w.Write(append(b, '\n')); err != nil {
				return err
			}
		}
		if err := w.Flush(); err != nil {
			return err
		}
		if err := f.escrita.Sync(); err != nil {
			return err
		}
		f.estado.Enfileirados += int64(len(evs))
		f.estado.UltimoEvento = evs[len(evs)-1].OcorridoEm.Format("2006-01-02T15:04:05Z07:00")
	}
	if cursor != "" {
		f.estado.Cursor = cursor
	}
	return f.salvarEstado()
}

// Espiar devolve até n eventos ainda não confirmados, junto com quantos bytes
// eles ocupam — o valor que Confirmar espera receber.
func (f *Fila) Espiar(n int) ([]modelo.Evento, int64, error) {
	f.mu.Lock()
	defer f.mu.Unlock()

	r, err := os.Open(f.arquivo)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, 0, nil
		}
		return nil, 0, err
	}
	defer r.Close()

	if _, err := r.Seek(f.estado.Offset, io.SeekStart); err != nil {
		return nil, 0, err
	}
	sc := bufio.NewScanner(r)
	sc.Buffer(make([]byte, 0, 64*1024), 1<<20)

	var (
		evs   []modelo.Evento
		bytes int64
	)
	for len(evs) < n && sc.Scan() {
		linha := sc.Bytes()
		bytes += int64(len(linha)) + 1 // +1 do \n
		if len(linha) == 0 {
			continue
		}
		var e modelo.Evento
		if err := json.Unmarshal(linha, &e); err != nil {
			// Linha corrompida não pode travar a fila para sempre: pula.
			continue
		}
		evs = append(evs, e)
	}
	if err := sc.Err(); err != nil {
		return nil, 0, err
	}
	return evs, bytes, nil
}

// Confirmar marca como enviados os bytes devolvidos por Espiar.
func (f *Fila) Confirmar(bytes int64, quantidade int) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.estado.Offset += bytes
	f.estado.Enviados += int64(quantidade)
	if err := f.salvarEstado(); err != nil {
		return err
	}
	if f.estado.Offset >= compactarAcima {
		return f.compactar()
	}
	return nil
}

// compactar reescreve o arquivo sem o trecho já enviado. Chamado com o mutex
// travado.
func (f *Fila) compactar() error {
	origem, err := os.Open(f.arquivo)
	if err != nil {
		return err
	}
	defer origem.Close()
	if _, err := origem.Seek(f.estado.Offset, io.SeekStart); err != nil {
		return err
	}

	tmp := f.arquivo + ".tmp"
	destino, err := os.Create(tmp)
	if err != nil {
		return err
	}
	if _, err := io.Copy(destino, origem); err != nil {
		destino.Close()
		return err
	}
	if err := destino.Sync(); err != nil {
		destino.Close()
		return err
	}
	if err := destino.Close(); err != nil {
		return err
	}
	if err := f.escrita.Close(); err != nil {
		return err
	}
	if err := os.Rename(tmp, f.arquivo); err != nil {
		return err
	}
	w, err := os.OpenFile(f.arquivo, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
	if err != nil {
		return err
	}
	f.escrita = w
	f.estado.Offset = 0
	return f.salvarEstado()
}
