package direcao

import (
	"errors"
	"os"
	"testing"
	"time"

	"github.com/conecta/notifica-agent/internal/config"
	"github.com/conecta/notifica-agent/internal/modelo"
	"gopkg.in/yaml.v3"
)

func carregar(t *testing.T, texto string) *config.Config {
	t.Helper()
	base := `
escola: {nome: Teste, timezone: America/Sao_Paulo}
banco: {servidor: x, database: y, usuario: z}
saas: {base_url: "https://x", api_key: k}
`
	var c config.Config
	if err := yaml.Unmarshal([]byte(base+texto), &c); err != nil {
		t.Fatal(err)
	}
	// Passa por Carregar via arquivo temporário para aplicar padrões e validação.
	f := t.TempDir() + "/config.yaml"
	b, _ := yaml.Marshal(c)
	if err := os.WriteFile(f, b, 0o644); err != nil {
		t.Fatal(err)
	}
	cfg, err := config.Carregar(f)
	if err != nil {
		t.Fatal(err)
	}
	return cfg
}

func TestMapearDataHoraNoFusoDaEscola(t *testing.T) {
	cfg := carregar(t, "direcao: {modo: fixo, padrao: in}\n")
	m := modelo.Marcacao{
		Inners: "3", Complemento: "0", Cartao: "0000000000012345",
		DataHora: "260825073015", CodigoPessoa: "77", CodigoLocal: "1",
	}
	e, err := Novo(cfg).Mapear(m)
	if err != nil {
		t.Fatal(err)
	}
	// 25/08/2026 07:30:15 em São Paulo = 10:30:15 UTC.
	if got := e.OcorridoEm.UTC().Format(time.RFC3339); got != "2026-08-25T10:30:15Z" {
		t.Fatalf("occurred_at = %s", got)
	}
	if e.IDExterno != "3|0|0000000000012345|260825073015" {
		t.Fatalf("external_event_id = %s", e.IDExterno)
	}
	if e.AlunoIDExterno != "77" {
		t.Fatalf("external_student_id = %s", e.AlunoIDExterno)
	}
}

func TestDirecaoPeloLocal(t *testing.T) {
	cfg := carregar(t, "direcao:\n  modo: local\n  padrao: in\n  mapa: {\"1\": in, \"2\": out, \"9\": ignorar}\n")
	mp := Novo(cfg)

	casos := []struct {
		local string
		quer  string
		erro  error
	}{
		{"1", "in", nil},
		{"2", "out", nil},
		{"9", "", ErrIgnorada},
		{"7", "in", nil}, // fora do mapa cai no padrão
	}
	for _, c := range casos {
		e, err := mp.Mapear(modelo.Marcacao{
			DataHora: "260825073015", CodigoLocal: c.local, Cartao: "1", Inners: "1", Complemento: "0",
		})
		if !errors.Is(err, c.erro) {
			t.Fatalf("local %s: erro = %v, queria %v", c.local, err, c.erro)
		}
		if c.erro == nil && e.Direcao != c.quer {
			t.Fatalf("local %s: direção = %s, queria %s", c.local, e.Direcao, c.quer)
		}
	}
}

func TestDescartarSemMapa(t *testing.T) {
	cfg := carregar(t, "direcao:\n  modo: origem\n  padrao: in\n  descartar_sem_mapa: true\n  mapa: {\"1\": in}\n")
	_, err := Novo(cfg).Mapear(modelo.Marcacao{DataHora: "260825073015", Origem: "5"})
	if !errors.Is(err, ErrIgnorada) {
		t.Fatalf("erro = %v, queria ErrIgnorada", err)
	}
}

func TestCartaoSemPessoaViraPendencia(t *testing.T) {
	cfg := carregar(t, "direcao: {modo: fixo, padrao: in}\n")
	e, err := Novo(cfg).Mapear(modelo.Marcacao{
		DataHora: "260825073015", CodigoPessoa: "0", Cartao: "9999",
	})
	if err != nil {
		t.Fatal(err)
	}
	if e.AlunoIDExterno != "cartao:9999" {
		t.Fatalf("aluno = %s", e.AlunoIDExterno)
	}
}

func TestIgnorarMarcacaoAntiga(t *testing.T) {
	cfg := carregar(t, "direcao: {modo: fixo, padrao: in}\ncoleta: {ignorar_antes_de_dias: 2}\n")
	antiga := time.Now().AddDate(0, 0, -5).Format("060102150405")
	_, err := Novo(cfg).Mapear(modelo.Marcacao{DataHora: antiga, Cartao: "1"})
	if !errors.Is(err, ErrIgnorada) {
		t.Fatalf("erro = %v, queria ErrIgnorada", err)
	}
}

func TestDataHoraForaDoFormato(t *testing.T) {
	cfg := carregar(t, "direcao: {modo: fixo, padrao: in}\n")
	_, err := Novo(cfg).Mapear(modelo.Marcacao{DataHora: "2026-08-25", Cartao: "1"})
	if err == nil || errors.Is(err, ErrIgnorada) {
		t.Fatalf("erro = %v, queria erro de formato", err)
	}
}

func TestPadraoComplemento(t *testing.T) {
	// Sem seção direcao no config: Complemento 1 = entrada, 0 = saída.
	cfg := carregar(t, "")
	mp := Novo(cfg)
	for compl, quer := range map[string]string{"1": "in", "0": "out"} {
		e, err := mp.Mapear(modelo.Marcacao{
			DataHora: "260825073015", Complemento: compl, Cartao: "1", Inners: "1",
		})
		if err != nil {
			t.Fatal(err)
		}
		if e.Direcao != quer {
			t.Fatalf("Complemento %s: direção = %s, queria %s", compl, e.Direcao, quer)
		}
	}
}
