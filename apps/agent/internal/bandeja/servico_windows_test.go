//go:build windows

package bandeja

import (
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/conecta/notifica-agent/internal/estado"
	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/svc"
)

func TestResumoMonitorPriorizaServicoSobreEstadoRecente(t *testing.T) {
	agora := time.Now()
	e := estado.Estado{Em: agora, BancoOK: true, SaaSOK: true}
	for _, caso := range []struct {
		nome      string
		servico   svc.State
		err       error
		conectado bool
		texto     string
	}{
		{"rodando", svc.Running, nil, true, "Conectado"},
		{"parado", svc.Stopped, nil, false, "Desconectado"},
		{"parando", svc.StopPending, nil, false, "Desconectado"},
		{"iniciando", svc.StartPending, nil, false, "Desconectado"},
		{"ausente", 0, windows.ERROR_SERVICE_DOES_NOT_EXIST, false, "não instalado"},
		{"sem permissão", 0, windows.ERROR_ACCESS_DENIED, false, "verificar"},
	} {
		t.Run(caso.nome, func(t *testing.T) {
			texto, ok := resumoMonitor(e, nil, caso.servico, caso.err, agora)
			if ok != caso.conectado || !strings.Contains(texto, caso.texto) {
				t.Fatalf("resumo=%q, conectado=%v", texto, ok)
			}
		})
	}
	if _, ok := resumoMonitor(e, errors.New("estado indisponível"), svc.Running, nil, agora); ok {
		t.Fatal("estado indisponível não pode indicar conectado")
	}
	if _, ok := resumoMonitor(estado.Estado{Em: agora.Add(-4 * time.Minute), BancoOK: true, SaaSOK: true}, nil, svc.Running, nil, agora); ok {
		t.Fatal("estado antigo não pode indicar conectado")
	}
}
