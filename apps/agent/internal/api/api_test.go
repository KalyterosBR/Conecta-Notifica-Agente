package api

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/conecta/notifica-agent/internal/config"
)

func TestPerfilUsaChaveDoAgenteERetornaEscola(t *testing.T) {
	servidor := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/agent/profile" {
			t.Fatalf("caminho: %s", r.URL.Path)
		}
		if r.Header.Get("Authorization") != "Bearer cn_teste" {
			t.Fatalf("authorization: %q", r.Header.Get("Authorization"))
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"school_id":"esc-1","school_name":"Escola Horizonte","timezone":"America/Sao_Paulo","blocked":false,"whatsapp_connected":true}`))
	}))
	defer servidor.Close()

	c := Novo(&config.Config{SaaS: config.SaaS{BaseURL: servidor.URL, APIKey: "cn_teste", TimeoutSegundos: 5}}, "teste")
	perfil, err := c.Perfil(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if perfil.EscolaNome != "Escola Horizonte" || !perfil.WhatsAppConectado || perfil.Bloqueada {
		t.Fatalf("perfil inesperado: %+v", perfil)
	}
}
