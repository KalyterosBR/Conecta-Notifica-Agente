// Package config carrega e valida o config.yaml do agente.
package config

import (
	"fmt"
	"net/url"
	"os"
	"strings"
	"time"

	"gopkg.in/yaml.v3"
)

type Config struct {
	Escola        Escola        `yaml:"escola"`
	Banco         Banco         `yaml:"banco"`
	SaaS          SaaS          `yaml:"saas"`
	Coleta        Coleta        `yaml:"coleta"`
	Direcao       Direcao       `yaml:"direcao"`
	Consultas     Consultas     `yaml:"consultas"`
	Armazenamento Armazenamento `yaml:"armazenamento"`
	Log           Log           `yaml:"log"`
}

type Escola struct {
	Nome     string `yaml:"nome"`
	Timezone string `yaml:"timezone"`

	loc *time.Location
}

// Local devolve o fuso da escola, usado para interpretar o DataHora da catraca,
// que é gravado sem informação de fuso.
func (e Escola) Local() *time.Location { return e.loc }

type Banco struct {
	Servidor  string `yaml:"servidor"`
	Porta     int    `yaml:"porta"`
	Instancia string `yaml:"instancia"`
	Database  string `yaml:"database"`
	Usuario   string `yaml:"usuario"`
	Senha     string `yaml:"senha"`
	// Criptografia: disable | true | false (parâmetro encrypt do driver).
	Criptografia    string `yaml:"criptografia"`
	ConfiarNoCert   bool   `yaml:"confiar_no_certificado"`
	TimeoutSegundos int    `yaml:"timeout_segundos"`
	// DSN sobrescreve todos os campos acima quando preenchido.
	DSN string `yaml:"dsn"`
}

// String monta a connection string do driver go-mssqldb.
func (b Banco) String() string {
	if b.DSN != "" {
		return b.DSN
	}
	q := url.Values{}
	q.Set("database", b.Database)
	q.Set("app name", "Conecta Notifica Agent")
	q.Set("connection timeout", fmt.Sprint(b.TimeoutSegundos))
	if b.Criptografia != "" {
		q.Set("encrypt", b.Criptografia)
	}
	if b.ConfiarNoCert {
		q.Set("TrustServerCertificate", "true")
	}
	host := b.Servidor
	if b.Instancia == "" && b.Porta > 0 {
		host = fmt.Sprintf("%s:%d", b.Servidor, b.Porta)
	}
	u := url.URL{
		Scheme:   "sqlserver",
		User:     url.UserPassword(b.Usuario, b.Senha),
		Host:     host,
		Path:     b.Instancia,
		RawQuery: q.Encode(),
	}
	return u.String()
}

// Redigido devolve a connection string sem a senha, para log.
func (b Banco) Redigido() string {
	s := b.String()
	if b.Senha == "" {
		return s
	}
	return strings.ReplaceAll(s, url.QueryEscape(b.Senha), "***")
}

type SaaS struct {
	BaseURL         string `yaml:"base_url"`
	APIKey          string `yaml:"api_key"`
	TimeoutSegundos int    `yaml:"timeout_segundos"`
	LoteMax         int    `yaml:"lote_max"`
	// EnvioSegundos é o intervalo de drenagem da fila local.
	EnvioSegundos     int `yaml:"envio_segundos"`
	HeartbeatSegundos int `yaml:"heartbeat_segundos"`
}

type Coleta struct {
	IntervaloSegundos int `yaml:"intervalo_segundos"`
	LimitePorCiclo    int `yaml:"limite_por_ciclo"`
	// Cursor: auto | codigo | datahora.
	Cursor string `yaml:"cursor"`
	// FormatoDataHora é o layout Go do varchar(12) da coluna DataHora.
	FormatoDataHora string `yaml:"formato_datahora"`
	// InicioEm define de onde começar na primeira execução:
	// "agora", "tudo" ou uma data ISO (2026-08-01T00:00:00).
	InicioEm string `yaml:"inicio_em"`
	// Varredura relê uma janela recente para pegar marcações que chegaram
	// atrasadas (equipamento offline que descarrega depois). Só se aplica ao
	// cursor por datahora; com cursor por Codigo (identity) é desnecessário.
	VarreduraMinutos int `yaml:"varredura_minutos"`
	VarreduraHoras   int `yaml:"varredura_horas"`
	// IgnorarAntesDe descarta marcações mais antigas que N dias (0 = desligado).
	IgnorarAntesDeDias int `yaml:"ignorar_antes_de_dias"`
}

type Direcao struct {
	// Modo: fixo | local | inner | origem | complemento.
	Modo   string            `yaml:"modo"`
	Padrao string            `yaml:"padrao"`
	Mapa   map[string]string `yaml:"mapa"`
	// DescartarSemMapa ignora a marcação quando o valor não está no mapa,
	// em vez de cair no padrão.
	DescartarSemMapa bool `yaml:"descartar_sem_mapa"`
}

type Consultas struct {
	// Eventos e Alunos sobrescrevem o SQL padrão. Ver README para o contrato
	// de colunas que cada consulta precisa devolver.
	Eventos               string `yaml:"eventos"`
	Alunos                string `yaml:"alunos"`
	SincronizarAlunos     bool   `yaml:"sincronizar_alunos"`
	IntervaloAlunosMinuto int    `yaml:"intervalo_alunos_minutos"`
}

type Armazenamento struct {
	Diretorio string `yaml:"diretorio"`
}

type Log struct {
	Nivel   string `yaml:"nivel"`
	Arquivo string `yaml:"arquivo"`
}

// Carregar lê o arquivo, aplica os padrões e valida.
func Carregar(caminho string) (*Config, error) {
	b, err := os.ReadFile(caminho)
	if err != nil {
		return nil, fmt.Errorf("lendo %s: %w", caminho, err)
	}
	var c Config
	if err := yaml.Unmarshal(b, &c); err != nil {
		return nil, fmt.Errorf("yaml inválido em %s: %w", caminho, err)
	}
	c.padroes()
	if err := c.validar(); err != nil {
		return nil, err
	}
	return &c, nil
}

func (c *Config) padroes() {
	def := func(s *string, v string) {
		if strings.TrimSpace(*s) == "" {
			*s = v
		}
	}
	defi := func(n *int, v int) {
		if *n == 0 {
			*n = v
		}
	}

	def(&c.Escola.Timezone, "America/Sao_Paulo")
	def(&c.Banco.Criptografia, "disable")
	defi(&c.Banco.TimeoutSegundos, 15)
	if c.Banco.Instancia == "" && c.Banco.Porta == 0 {
		c.Banco.Porta = 1433
	}

	defi(&c.SaaS.TimeoutSegundos, 20)
	defi(&c.SaaS.LoteMax, 200)
	defi(&c.SaaS.EnvioSegundos, 5)
	defi(&c.SaaS.HeartbeatSegundos, 60)

	defi(&c.Coleta.IntervaloSegundos, 7)
	defi(&c.Coleta.LimitePorCiclo, 500)
	def(&c.Coleta.Cursor, "auto")
	def(&c.Coleta.FormatoDataHora, "060102150405") // YYMMDDHHMMSS
	def(&c.Coleta.InicioEm, "agora")
	defi(&c.Coleta.VarreduraMinutos, 10)
	defi(&c.Coleta.VarreduraHoras, 6)

	def(&c.Direcao.Modo, "complemento")
	def(&c.Direcao.Padrao, "in")
	// Padrão do software da catraca: Marcacao.Complemento = 1 entrada, 0 saída.
	if c.Direcao.Modo == "complemento" && len(c.Direcao.Mapa) == 0 {
		c.Direcao.Mapa = map[string]string{"1": "in", "0": "out"}
	}

	defi(&c.Consultas.IntervaloAlunosMinuto, 60)

	def(&c.Armazenamento.Diretorio, "dados")
	def(&c.Log.Nivel, "info")
}

func (c *Config) validar() error {
	var faltando []string
	if c.Banco.DSN == "" {
		if c.Banco.Servidor == "" {
			faltando = append(faltando, "banco.servidor")
		}
		if c.Banco.Database == "" {
			faltando = append(faltando, "banco.database")
		}
		if c.Banco.Usuario == "" {
			faltando = append(faltando, "banco.usuario")
		}
	}
	if c.SaaS.BaseURL == "" {
		faltando = append(faltando, "saas.base_url")
	}
	if c.SaaS.APIKey == "" {
		faltando = append(faltando, "saas.api_key")
	}
	if len(faltando) > 0 {
		return fmt.Errorf("configuração incompleta: %s", strings.Join(faltando, ", "))
	}

	switch c.Coleta.Cursor {
	case "auto", "codigo", "datahora":
	default:
		return fmt.Errorf("coleta.cursor inválido: %q (use auto, codigo ou datahora)", c.Coleta.Cursor)
	}

	switch c.Direcao.Modo {
	case "fixo", "local", "inner", "origem", "complemento":
	default:
		return fmt.Errorf("direcao.modo inválido: %q", c.Direcao.Modo)
	}
	if c.Direcao.Padrao != "in" && c.Direcao.Padrao != "out" {
		return fmt.Errorf("direcao.padrao deve ser in ou out, veio %q", c.Direcao.Padrao)
	}
	for k, v := range c.Direcao.Mapa {
		if v != "in" && v != "out" && v != "ignorar" {
			return fmt.Errorf("direcao.mapa[%s] deve ser in, out ou ignorar, veio %q", k, v)
		}
	}

	if _, err := time.Parse(c.Coleta.FormatoDataHora, time.Now().Format(c.Coleta.FormatoDataHora)); err != nil {
		return fmt.Errorf("coleta.formato_datahora inválido: %w", err)
	}

	loc, err := time.LoadLocation(c.Escola.Timezone)
	if err != nil {
		return fmt.Errorf("escola.timezone inválido: %w", err)
	}
	c.Escola.loc = loc

	c.SaaS.BaseURL = strings.TrimSuffix(c.SaaS.BaseURL, "/")
	return nil
}
