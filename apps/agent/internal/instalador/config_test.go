package instalador

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func base() Dados {
	return Dados{
		Escola:    "Escola Ávila",
		Servidor:  "localhost",
		Instancia: "SQLEXPRESS",
		Database:  "Catraca",
		Usuario:   "notifica_ro",
		Senha:     "s3nh4",
		BaseURL:   "https://notifica.exemplo/api",
		APIKey:    "cn_abc123",
	}
}

func TestValidarAceitaOCasoNormal(t *testing.T) {
	if err := base().Validar(); err != nil {
		t.Fatalf("caso normal recusado: %v", err)
	}
}

func TestValidarRecusaCamposQueImpediremOAgenteDeSubir(t *testing.T) {
	casos := map[string]func(d *Dados){
		"servidor do SQL Server":   func(d *Dados) { d.Servidor = "" },
		"nome do banco da catraca": func(d *Dados) { d.Database = "" },
		"chave da escola":          func(d *Dados) { d.APIKey = "" },
		"endereço do servidor":     func(d *Dados) { d.BaseURL = "" },
	}
	for esperado, quebrar := range casos {
		d := base()
		quebrar(&d)
		err := d.Validar()
		if err == nil {
			t.Fatalf("%s: deveria recusar", esperado)
		}
		if !strings.Contains(err.Error(), esperado) {
			t.Fatalf("%s: mensagem não diz o que falta: %v", esperado, err)
		}
	}
}

func TestValidarExigeInstanciaOuPorta(t *testing.T) {
	d := base()
	d.Instancia = ""
	if err := d.Validar(); err == nil {
		t.Fatal("sem instância e sem porta deveria falhar")
	}
	d.Porta = 1433
	if err := d.Validar(); err != nil {
		t.Fatalf("porta deveria bastar: %v", err)
	}
}

func TestValidarPegaChaveEUrlColadasErrado(t *testing.T) {
	// Erros que a secretaria comete de verdade: colar a chave pela metade
	// ou o endereço sem o esquema.
	d := base()
	d.APIKey = "abc123"
	if err := d.Validar(); err == nil || !strings.Contains(err.Error(), "cn_") {
		t.Fatalf("chave sem prefixo deveria falhar com dica: %v", err)
	}
	d = base()
	d.BaseURL = "notifica.exemplo/api"
	if err := d.Validar(); err == nil || !strings.Contains(err.Error(), "http") {
		t.Fatalf("url sem esquema deveria falhar com dica: %v", err)
	}
}

func TestEscreverGeraYamlLegivelPeloConfig(t *testing.T) {
	dir := t.TempDir()
	caminho := filepath.Join(dir, "config.yaml")
	if err := Escrever(caminho, base()); err != nil {
		t.Fatal(err)
	}
	b, err := os.ReadFile(caminho)
	if err != nil {
		t.Fatal(err)
	}
	texto := string(b)
	for _, trecho := range []string{
		`nome: "Escola Ávila"`,
		`servidor: "localhost"`,
		`instancia: "SQLEXPRESS"`,
		`usuario: "notifica_ro"`,
		`base_url: "https://notifica.exemplo/api"`,
		`api_key: "cn_abc123"`,
	} {
		if !strings.Contains(texto, trecho) {
			t.Errorf("faltou no yaml: %s", trecho)
		}
	}
}

func TestEscreverUsaPortaQuandoNaoHaInstancia(t *testing.T) {
	d := base()
	d.Instancia = ""
	d.Porta = 1433
	caminho := filepath.Join(t.TempDir(), "config.yaml")
	if err := Escrever(caminho, d); err != nil {
		t.Fatal(err)
	}
	b, _ := os.ReadFile(caminho)
	if !strings.Contains(string(b), "porta: 1433") {
		t.Errorf("deveria gravar a porta: %s", b)
	}
	if strings.Contains(string(b), "instancia:") {
		t.Errorf("não deveria gravar instância vazia: %s", b)
	}
}

func TestEscreverGuardaOAnteriorAntesDeSobrescrever(t *testing.T) {
	// Reconfigurar não pode custar a configuração que funcionava.
	caminho := filepath.Join(t.TempDir(), "config.yaml")
	if err := os.WriteFile(caminho, []byte("velho"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := Escrever(caminho, base()); err != nil {
		t.Fatal(err)
	}
	bak, err := os.ReadFile(caminho + ".bak")
	if err != nil {
		t.Fatalf("backup não foi criado: %v", err)
	}
	if string(bak) != "velho" {
		t.Errorf("backup com conteúdo errado: %q", bak)
	}
}

func TestEscreverRecusaAntesDeTocarNoArquivo(t *testing.T) {
	caminho := filepath.Join(t.TempDir(), "config.yaml")
	d := base()
	d.APIKey = ""
	if err := Escrever(caminho, d); err == nil {
		t.Fatal("deveria recusar")
	}
	if _, err := os.Stat(caminho); !os.IsNotExist(err) {
		t.Error("não deveria ter criado o arquivo com dados inválidos")
	}
}
