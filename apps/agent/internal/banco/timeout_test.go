package banco

import (
	"context"
	"testing"
	"time"

	"github.com/conecta/notifica-agent/internal/config"
)

func TestContextoConsultaLimitaTempoEPreservaPrazoMenor(t *testing.T) {
	cfg := &config.Config{}
	cfg.Banco.TimeoutSegundos = 2
	ctx, cancelar := contextoConsulta(context.Background(), cfg)
	defer cancelar()
	prazo, ok := ctx.Deadline()
	if !ok || time.Until(prazo) > 2*time.Second {
		t.Fatal("prazo SQL não aplicado")
	}
	pai, cancelarPai := context.WithTimeout(context.Background(), time.Second)
	defer cancelarPai()
	filho, cancelarFilho := contextoConsulta(pai, cfg)
	defer cancelarFilho()
	prazoPai, _ := pai.Deadline()
	prazoFilho, _ := filho.Deadline()
	if !prazoPai.Equal(prazoFilho) {
		t.Fatal("ampliou o prazo do chamador")
	}
	cancelarPai()
	if filho.Err() != context.Canceled {
		t.Fatal("parada não cancelou consulta")
	}
}
