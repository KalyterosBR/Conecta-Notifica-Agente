package instalador

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestRotuloDistingueInstanciaDePorta(t *testing.T) {
	i := Instancia{Servidor: "localhost", Instancia: "SQLEXPRESS"}
	if got := i.Rotulo(); got != `localhost\SQLEXPRESS` {
		t.Errorf("instância nomeada: %q", got)
	}
	p := Instancia{Servidor: "10.0.0.5", Porta: 1433}
	if got := p.Rotulo(); got != "10.0.0.5,1433" {
		t.Errorf("porta: %q", got)
	}
}

func TestSepararRotuloVoltaAoQueEra(t *testing.T) {
	// Ida e volta: o que a tela mostra tem que virar de novo os campos certos.
	casos := []Instancia{
		{Servidor: "localhost", Instancia: "SQLEXPRESS"},
		{Servidor: "10.0.0.5", Porta: 1433},
	}
	for _, c := range casos {
		got := SepararRotulo(c.Rotulo())
		if got.Servidor != c.Servidor || got.Instancia != c.Instancia {
			t.Errorf("%s virou %+v", c.Rotulo(), got)
		}
		if c.Porta != 0 && got.Porta != c.Porta {
			t.Errorf("%s perdeu a porta: %+v", c.Rotulo(), got)
		}
	}
}

func TestSepararRotuloAceitaSoOHost(t *testing.T) {
	// Quem digita "localhost" sem instância nem porta espera a porta padrão.
	got := SepararRotulo(" localhost ")
	if got.Servidor != "localhost" || got.Porta != 1433 {
		t.Errorf("esperava localhost:1433, veio %+v", got)
	}
}

func TestEscreverINIEhLegivelPeloInstalador(t *testing.T) {
	d := Deteccao{
		Instancias: []Instancia{
			{Servidor: "localhost", Instancia: "SQLEXPRESS"},
			{Servidor: "localhost", Instancia: "CATRACA"},
		},
		Bancos:    []string{"Acesso", "Catraca"},
		Escolhida: Instancia{Servidor: "localhost", Instancia: "SQLEXPRESS"},
		Database:  "Acesso",
	}
	caminho := filepath.Join(t.TempDir(), "deteccao.ini")
	if err := d.EscreverINI(caminho); err != nil {
		t.Fatal(err)
	}
	b, _ := os.ReadFile(caminho)
	texto := string(b)
	for _, esperado := range []string{
		"[deteccao]",
		`instancias=localhost\SQLEXPRESS|localhost\CATRACA`,
		"bancos=Acesso|Catraca",
		"servidor=localhost",
		"instancia=SQLEXPRESS",
		"database=Acesso",
	} {
		if !strings.Contains(texto, esperado) {
			t.Errorf("faltou %q em:\n%s", esperado, texto)
		}
	}
}

func TestEscreverININaoQuebraComAvisoDeVariasLinhas(t *testing.T) {
	// Aviso com \n viraria uma chave inválida no INI e quebraria a leitura.
	d := Deteccao{Aviso: "linha um\nlinha dois"}
	caminho := filepath.Join(t.TempDir(), "d.ini")
	if err := d.EscreverINI(caminho); err != nil {
		t.Fatal(err)
	}
	b, _ := os.ReadFile(caminho)
	if strings.Contains(strings.SplitN(string(b), "aviso=", 2)[1], "\nlinha dois") {
		t.Error("aviso não foi achatado numa linha")
	}
}

func TestDetectarNuncaFalhaEDaUmPalpite(t *testing.T) {
	// Fora do Windows não há registro nem autenticação integrada: mesmo assim
	// a detecção precisa devolver algo utilizável, com o motivo.
	d := Detectar()
	if len(d.Instancias) == 0 {
		t.Fatal("deveria ao menos palpitar localhost")
	}
	if d.Escolhida.Servidor != "localhost" {
		t.Errorf("palpite estranho: %+v", d.Escolhida)
	}
	if d.Aviso == "" {
		t.Error("sem descoberta, deveria explicar o porquê")
	}
}
