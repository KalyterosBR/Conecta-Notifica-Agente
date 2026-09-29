package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/conecta/notifica-agent/internal/estado"
)

func TestDiagnosticoSeguroMantemHistoricoEFormataDataDoEvento(t *testing.T) {
	dir := t.TempDir()
	configuracao := filepath.Join(dir, "config.yaml")
	conteudoConfig := `escola:
  nome: "Escola de teste"
banco:
  servidor: "localhost"
  database: "TopPortaria"
  usuario: "notifica_ro"
  senha: "nao-exibir"
saas:
  base_url: "https://painel.exemplo.test/api"
  api_key: "cn_nao-exibir"
armazenamento:
  diretorio: "dados"
`
	if err := os.WriteFile(configuracao, []byte(conteudoConfig), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := estado.Gravar(estado.Caminho(filepath.Join(dir, "dados")), estado.Estado{
		BancoOK:      true,
		SaaSOK:       true,
		Pendentes:    2,
		EnviadosHoje: 5,
		UltimoEvento: "2026-09-23T14:35:00-03:00",
	}); err != nil {
		t.Fatal(err)
	}

	caminho, err := diagnosticoSeguroParaArquivo(configuracao)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := diagnosticoSeguroParaArquivo(configuracao); err != nil {
		t.Fatal(err)
	}

	resultado, err := os.ReadFile(caminho)
	if err != nil {
		t.Fatal(err)
	}
	texto := string(resultado)
	if strings.Count(texto, "histórico de diagnóstico seguro") != 1 {
		t.Errorf("cabeçalho deve aparecer uma vez:\n%s", texto)
	}
	if strings.Count(texto, "Diagnóstico solicitado") != 2 {
		t.Errorf("queria duas entradas preservadas no histórico:\n%s", texto)
	}
	ultimoEvento, err := time.Parse(time.RFC3339, "2026-09-23T14:35:00-03:00")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(texto, "Data/hora do último evento enviado: "+dataHoraSegura(ultimoEvento)) {
		t.Errorf("data do evento não foi formatada:\n%s", texto)
	}
	if strings.Contains(texto, "nao-exibir") || strings.Contains(texto, "cn_nao-exibir") {
		t.Errorf("diagnóstico expôs um segredo:\n%s", texto)
	}
}
