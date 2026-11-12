// Package api fala com o SaaS: envio de eventos, sync de alunos e heartbeat.
package api

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"time"

	"github.com/conecta/notifica-agent/internal/config"
	"github.com/conecta/notifica-agent/internal/modelo"
)

type Cliente struct {
	base   string
	chave  string
	versao string
	http   *http.Client
}

func Novo(cfg *config.Config, versao string) *Cliente {
	return &Cliente{
		base:   cfg.SaaS.BaseURL,
		chave:  cfg.SaaS.APIKey,
		versao: versao,
		http: &http.Client{
			Timeout: time.Duration(cfg.SaaS.TimeoutSegundos) * time.Second,
		},
	}
}

// ErroHTTP carrega o status para o chamador decidir entre reenviar e descartar.
type ErroHTTP struct {
	Status int
	Corpo  string
}

func (e *ErroHTTP) Error() string {
	return fmt.Sprintf("HTTP %d: %s", e.Status, e.Corpo)
}

// Permanente indica payload que o servidor nunca vai aceitar. Reenviar não
// resolve e ainda trava a fila atrás de um lote envenenado.
func (e *ErroHTTP) Permanente() bool {
	switch e.Status {
	case http.StatusBadRequest, http.StatusNotFound, http.StatusConflict,
		http.StatusRequestEntityTooLarge, http.StatusUnprocessableEntity:
		return true
	}
	return false
}

// Autenticacao indica chave inválida ou revogada: o lote continua na fila,
// mas o painel precisa avisar a escola.
func (e *ErroHTTP) Autenticacao() bool {
	return e.Status == http.StatusUnauthorized || e.Status == http.StatusForbidden
}

type loteEventos struct {
	Eventos []modelo.Evento `json:"events"`
}

type loteAlunos struct {
	Alunos   []modelo.Aluno `json:"students"`
	Completo bool           `json:"full"`
}

// Perfil identifica o tenant associado à API key do agente. É deliberadamente
// pequeno: a central precisa mostrar a escola certa, não dados pessoais ou
// segredos operacionais do SaaS.
type Perfil struct {
	EscolaID          string `json:"school_id"`
	EscolaNome        string `json:"school_name"`
	Timezone          string `json:"timezone"`
	Bloqueada         bool   `json:"blocked"`
	WhatsAppConectado bool   `json:"whatsapp_connected"`
}

// EnviarEventos manda um lote. A idempotência é garantida pelo
// external_event_id de cada evento mais o Idempotency-Key do lote, então
// reenviar depois de um timeout é seguro.
func (c *Cliente) EnviarEventos(ctx context.Context, evs []modelo.Evento) (modelo.RespostaLote, error) {
	var r modelo.RespostaLote
	if len(evs) == 0 {
		return r, nil
	}
	h := sha256.New()
	for _, e := range evs {
		io.WriteString(h, e.IDExterno)
		io.WriteString(h, ";")
	}
	chaveLote := hex.EncodeToString(h.Sum(nil))[:32]

	err := c.post(ctx, "/v1/agent/events", loteEventos{Eventos: evs}, chaveLote, &r)
	return r, err
}

func (c *Cliente) SincronizarAlunos(ctx context.Context, alunos []modelo.Aluno, completo bool) error {
	return c.post(ctx, "/v1/agent/students/sync", loteAlunos{Alunos: alunos, Completo: completo}, "", nil)
}

// EnviarFoto manda o JPEG de uma pessoa. O painel responde "gravada" ou
// "igual" quando o SHA-256 já está lá. O corpo não entra em log.
func (c *Cliente) EnviarFoto(ctx context.Context, idExterno, sha string, jpeg []byte) (string, error) {
	var resp struct {
		Status string `json:"status"`
	}
	corpo := struct {
		SHA  string `json:"sha256"`
		Data string `json:"data_base64"`
	}{sha, base64.StdEncoding.EncodeToString(jpeg)}
	err := c.post(ctx, "/v1/agent/students/"+url.PathEscape(idExterno)+"/photo", corpo, "", &resp)
	return resp.Status, err
}

func (c *Cliente) Heartbeat(ctx context.Context, hb modelo.Heartbeat) error {
	hb.Versao = c.versao
	return c.post(ctx, "/v1/agent/heartbeat", hb, "", nil)
}

func (c *Cliente) Perfil(ctx context.Context) (Perfil, error) {
	var perfil Perfil
	err := c.get(ctx, "/v1/agent/profile", &perfil)
	return perfil, err
}

func (c *Cliente) post(ctx context.Context, caminho string, corpo any, idem string, saida any) error {
	b, err := json.Marshal(corpo)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.base+caminho, bytes.NewReader(b))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+c.chave)
	req.Header.Set("User-Agent", "conecta-notifica-agent/"+c.versao)
	if idem != "" {
		req.Header.Set("Idempotency-Key", idem)
	}

	resp, err := c.http.Do(req)
	if err != nil {
		return fmt.Errorf("chamando %s: %w", caminho, err)
	}
	defer resp.Body.Close()

	lido, _ := io.ReadAll(io.LimitReader(resp.Body, 8<<10))
	if resp.StatusCode >= 300 {
		return &ErroHTTP{Status: resp.StatusCode, Corpo: string(lido)}
	}
	if saida != nil && len(lido) > 0 {
		if err := json.Unmarshal(lido, saida); err != nil {
			// Corpo inesperado com 2xx não invalida o envio.
			return nil
		}
	}
	return nil
}

func (c *Cliente) get(ctx context.Context, caminho string, saida any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.base+caminho, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+c.chave)
	req.Header.Set("User-Agent", "conecta-notifica-agent/"+c.versao)

	resp, err := c.http.Do(req)
	if err != nil {
		return fmt.Errorf("chamando %s: %w", caminho, err)
	}
	defer resp.Body.Close()
	lido, _ := io.ReadAll(io.LimitReader(resp.Body, 8<<10))
	if resp.StatusCode >= 300 {
		return &ErroHTTP{Status: resp.StatusCode, Corpo: string(lido)}
	}
	if err := json.Unmarshal(lido, saida); err != nil {
		return fmt.Errorf("lendo resposta de %s: %w", caminho, err)
	}
	return nil
}
