// Package estado publica, num arquivo, o que o serviço está fazendo — para o
// ícone ao lado do relógio poder mostrar sem falar com o serviço.
//
// Um arquivo em vez de IPC porque o serviço roda na sessão 0 e o ícone na
// sessão do usuário: pipe ou socket entre as duas exigiria permissão que não
// vale a pena para mostrar quatro números.
package estado

import (
	"encoding/json"
	"os"
	"path/filepath"
	"time"
)

// Arquivo é o nome dentro do diretório de dados do agente.
const Arquivo = "estado.json"

// ArquivoIdentidade guarda a resposta não sensível do SaaS usada pela central
// gráfica para provar qual escola está vinculada à API key local.
const ArquivoIdentidade = "identidade.json"

type Estado struct {
	Em                          time.Time `json:"em"`
	Escola                      string    `json:"escola"`
	Versao                      string    `json:"versao"`
	BancoOK                     bool      `json:"banco_ok"`
	SaaSOK                      bool      `json:"saas_ok"`
	Pendentes                   int       `json:"pendentes"`
	EnviadosHoje                int64     `json:"enviados_hoje"`
	UltimaLeitura               time.Time `json:"ultima_leitura,omitempty"`
	UltimoEnvio                 time.Time `json:"ultimo_envio,omitempty"`
	UltimoEvento                string    `json:"ultimo_evento,omitempty"`
	SincronizacaoHabilitada     bool      `json:"sincronizacao_habilitada"`
	ConsultaAlunosConfigurada   bool      `json:"consulta_alunos_configurada"`
	IntervaloAlunosMinutos      int       `json:"intervalo_alunos_minutos,omitempty"`
	UltimoErro                  string    `json:"ultimo_erro,omitempty"`
}

// Sincronizacao registra apenas metadados do último envio de alunos; nomes,
// cartões e conteúdo da consulta nunca são gravados neste arquivo.
type Sincronizacao struct {
	TentativaEm time.Time `json:"tentativa_em,omitempty"`
	ConcluidaEm time.Time `json:"concluida_em,omitempty"`
	Quantidade  int       `json:"quantidade"`
	Sucesso     bool      `json:"sucesso"`
	Mensagem    string    `json:"mensagem,omitempty"`
}

type Identidade struct {
	AtualizadoEm      time.Time `json:"atualizado_em"`
	EscolaID          string    `json:"escola_id"`
	EscolaNome        string    `json:"escola_nome"`
	Timezone          string    `json:"timezone"`
	Bloqueada         bool      `json:"bloqueada"`
	WhatsAppConectado bool      `json:"whatsapp_conectado"`
}

// Caminho monta o caminho do arquivo dentro do diretório de dados.
func Caminho(dirDados string) string { return filepath.Join(dirDados, Arquivo) }

func CaminhoIdentidade(dirDados string) string { return filepath.Join(dirDados, ArquivoIdentidade) }

func CaminhoSincronizacao(dirDados string) string {
	return filepath.Join(dirDados, "sincronizacao-alunos.json")
}

// Gravar escreve de forma atômica: o ícone lê a cada poucos segundos e não
// pode pegar meio arquivo.
func Gravar(caminho string, e Estado) error {
	e.Em = time.Now()
	b, err := json.MarshalIndent(e, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(caminho), 0o755); err != nil {
		return err
	}
	tmp := caminho + ".tmp"
	if err := os.WriteFile(tmp, b, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, caminho)
}

func Ler(caminho string) (Estado, error) {
	var e Estado
	b, err := os.ReadFile(caminho)
	if err != nil {
		return e, err
	}
	return e, json.Unmarshal(b, &e)
}

func GravarIdentidade(caminho string, i Identidade) error {
	i.AtualizadoEm = time.Now()
	b, err := json.MarshalIndent(i, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(caminho), 0o755); err != nil {
		return err
	}
	tmp := caminho + ".tmp"
	if err := os.WriteFile(tmp, b, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, caminho)
}

func LerIdentidade(caminho string) (Identidade, error) {
	var i Identidade
	b, err := os.ReadFile(caminho)
	if err != nil {
		return i, err
	}
	return i, json.Unmarshal(b, &i)
}

func GravarSincronizacao(caminho string, s Sincronizacao) error {
	b, err := json.MarshalIndent(s, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(caminho), 0o755); err != nil {
		return err
	}
	tmp := caminho + ".tmp"
	if err := os.WriteFile(tmp, b, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, caminho)
}

func LerSincronizacao(caminho string) (Sincronizacao, error) {
	var s Sincronizacao
	b, err := os.ReadFile(caminho)
	if err != nil {
		return s, err
	}
	err = json.Unmarshal(b, &s)
	return s, err
}

// Fresco diz se o estado ainda vale. Arquivo velho significa serviço parado —
// e mostrar "conectado" com base num arquivo de ontem seria mentir.
func (e Estado) Fresco(agora time.Time, limite time.Duration) bool {
	return !e.Em.IsZero() && agora.Sub(e.Em) < limite
}

// Resumo devolve o texto do balão/tooltip e se está tudo bem, na ordem em que
// as coisas quebram: serviço parado, banco fora, SaaS fora, fila acumulando.
func (e Estado) Resumo(agora time.Time, limite time.Duration) (string, bool) {
	if !e.Fresco(agora, limite) {
		return "Serviço parado — os giros não estão sendo enviados", false
	}
	if !e.BancoOK {
		msg := "Sem acesso ao banco da catraca"
		if e.UltimoErro != "" {
			msg += " (" + primeiraLinha(e.UltimoErro) + ")"
		}
		return msg, false
	}
	if !e.SaaSOK {
		return "Sem conexão com o Conecta Notifica — a fila está guardando os giros", false
	}
	if e.Pendentes > 0 {
		return plural(e.Pendentes, "giro na fila", "giros na fila") + ", enviando…", true
	}
	return "Conectado — " + plural(int(e.EnviadosHoje), "giro enviado hoje", "giros enviados hoje"), true
}

func plural(n int, um, muitos string) string {
	if n == 1 {
		return "1 " + um
	}
	return itoa(n) + " " + muitos
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	neg := n < 0
	if neg {
		n = -n
	}
	var b []byte
	for n > 0 {
		b = append([]byte{byte('0' + n%10)}, b...)
		n /= 10
	}
	if neg {
		return "-" + string(b)
	}
	return string(b)
}

func primeiraLinha(s string) string {
	for i := 0; i < len(s); i++ {
		if s[i] == '\n' || s[i] == '\r' {
			return s[:i]
		}
	}
	if len(s) > 80 {
		return s[:80] + "…"
	}
	return s
}
