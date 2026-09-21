package estado

import (
	"path/filepath"
	"testing"
	"time"
)

const limite = 3 * time.Minute

func TestGravarELerVoltaOMesmo(t *testing.T) {
	c := filepath.Join(t.TempDir(), "estado.json")
	if err := Gravar(c, Estado{Escola: "Escola X", BancoOK: true, SaaSOK: true, EnviadosHoje: 7}); err != nil {
		t.Fatal(err)
	}
	e, err := Ler(c)
	if err != nil {
		t.Fatal(err)
	}
	if e.Escola != "Escola X" || e.EnviadosHoje != 7 || !e.BancoOK {
		t.Fatalf("voltou diferente: %+v", e)
	}
	if e.Em.IsZero() {
		t.Error("Gravar deveria carimbar a hora")
	}
}

func TestGravarNaoDeixaArquivoTemporario(t *testing.T) {
	dir := t.TempDir()
	c := filepath.Join(dir, "estado.json")
	if err := Gravar(c, Estado{}); err != nil {
		t.Fatal(err)
	}
	if _, err := Ler(c + ".tmp"); err == nil {
		t.Error("o .tmp deveria ter virado o arquivo final")
	}
}

func TestGravarELerIdentidade(t *testing.T) {
	c := filepath.Join(t.TempDir(), ArquivoIdentidade)
	if err := GravarIdentidade(c, Identidade{EscolaID: "esc-1", EscolaNome: "Escola X", WhatsAppConectado: true}); err != nil {
		t.Fatal(err)
	}
	i, err := LerIdentidade(c)
	if err != nil {
		t.Fatal(err)
	}
	if i.EscolaNome != "Escola X" || !i.WhatsAppConectado || i.AtualizadoEm.IsZero() {
		t.Fatalf("identidade inesperada: %+v", i)
	}
}

func TestEstadoVelhoNaoContaComoConectado(t *testing.T) {
	// Serviço parado deixa o arquivo para trás; mostrar "conectado" com base
	// nele seria mentir para a escola.
	agora := time.Now()
	e := Estado{Em: agora.Add(-2 * time.Hour), BancoOK: true, SaaSOK: true}
	if e.Fresco(agora, limite) {
		t.Fatal("estado de duas horas atrás não é fresco")
	}
	msg, ok := e.Resumo(agora, limite)
	if ok {
		t.Error("deveria estar em falha")
	}
	if msg == "" {
		t.Error("precisa dizer o que houve")
	}
}

func TestResumoSegueAOrdemEmQueAsCoisasQuebram(t *testing.T) {
	agora := time.Now()
	casos := []struct {
		nome   string
		e      Estado
		ok     bool
		contem string
	}{
		{"banco fora", Estado{Em: agora, BancoOK: false, SaaSOK: true}, false, "banco"},
		{"saas fora", Estado{Em: agora, BancoOK: true, SaaSOK: false}, false, "Conecta Notifica"},
		{"fila acumulando", Estado{Em: agora, BancoOK: true, SaaSOK: true, Pendentes: 4}, true, "4 giros na fila"},
		{"tudo bem", Estado{Em: agora, BancoOK: true, SaaSOK: true, EnviadosHoje: 12}, true, "Conectado"},
	}
	for _, c := range casos {
		msg, ok := c.e.Resumo(agora, limite)
		if ok != c.ok {
			t.Errorf("%s: ok=%v, esperava %v (%s)", c.nome, ok, c.ok, msg)
		}
		if !contemTexto(msg, c.contem) {
			t.Errorf("%s: %q não menciona %q", c.nome, msg, c.contem)
		}
	}
}

func TestResumoUsaSingularQuandoEhUmSo(t *testing.T) {
	agora := time.Now()
	msg, _ := Estado{Em: agora, BancoOK: true, SaaSOK: true, Pendentes: 1}.Resumo(agora, limite)
	if !contemTexto(msg, "1 giro na fila") {
		t.Errorf("esperava singular: %q", msg)
	}
}

func TestResumoAchataErroDeVariasLinhas(t *testing.T) {
	agora := time.Now()
	e := Estado{Em: agora, BancoOK: false, UltimoErro: "login failed\nstack inteira aqui"}
	msg, _ := e.Resumo(agora, limite)
	if contemTexto(msg, "stack") {
		t.Errorf("tooltip não pode carregar a stack: %q", msg)
	}
}

func contemTexto(s, sub string) bool {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return true
		}
	}
	return false
}
