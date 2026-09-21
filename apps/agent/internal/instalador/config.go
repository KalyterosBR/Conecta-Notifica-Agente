package instalador

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// Dados é tudo o que o config.yaml precisa saber para o agente subir. É o
// contrato entre o assistente de console e o instalador do Windows, que
// coleta os mesmos campos em janelas e chama `notifica-agent configurar`.
type Dados struct {
	Escola    string
	Servidor  string
	Instancia string
	Porta     int
	Database  string
	Usuario   string
	Senha     string
	BaseURL   string
	APIKey    string
}

// Validar recusa o que impediria o agente de subir, com mensagem que diz o
// que fazer. Falhar aqui é melhor que instalar um serviço que nasce morto.
func (d Dados) Validar() error {
	var faltando []string
	if strings.TrimSpace(d.Servidor) == "" {
		faltando = append(faltando, "servidor do SQL Server")
	}
	if strings.TrimSpace(d.Database) == "" {
		faltando = append(faltando, "nome do banco da catraca")
	}
	if strings.TrimSpace(d.Usuario) == "" {
		faltando = append(faltando, "usuário do banco")
	}
	if strings.TrimSpace(d.APIKey) == "" {
		faltando = append(faltando, "chave da escola (api_key)")
	}
	if strings.TrimSpace(d.BaseURL) == "" {
		faltando = append(faltando, "endereço do servidor (base_url)")
	}
	if len(faltando) > 0 {
		return fmt.Errorf("falta preencher: %s", strings.Join(faltando, ", "))
	}
	if !strings.HasPrefix(d.BaseURL, "http://") && !strings.HasPrefix(d.BaseURL, "https://") {
		return fmt.Errorf("endereço do servidor deve começar com http:// ou https:// (recebi %q)", d.BaseURL)
	}
	if !strings.HasPrefix(d.APIKey, "cn_") {
		return fmt.Errorf("a chave da escola começa com \"cn_\" — confira se copiou inteira do painel")
	}
	if d.Instancia == "" && d.Porta == 0 {
		return fmt.Errorf("informe a instância do SQL Server (ex.: SQLEXPRESS) ou a porta (ex.: 1433)")
	}
	return nil
}

// Escrever grava o config.yaml. Sobrescreve o que existir, guardando uma
// cópia .bak: reconfigurar não pode custar a configuração que funcionava.
func Escrever(caminho string, d Dados) error {
	if err := d.Validar(); err != nil {
		return err
	}
	if d.Usuario == "" {
		d.Usuario = "notifica_ro"
	}
	if _, err := os.Stat(caminho); err == nil {
		_ = os.Rename(caminho, caminho+".bak")
	}
	if dir := filepath.Dir(caminho); dir != "" {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return err
		}
	}

	linhaConexao := fmt.Sprintf("  instancia: %q\n", d.Instancia)
	if d.Instancia == "" {
		linhaConexao = fmt.Sprintf("  porta: %d\n", d.Porta)
	}
	conteudo := fmt.Sprintf(`# Conecta Notifica — gerado pelo instalador em %s
escola:
  nome: %q

banco:
  servidor: %q
%s  database: %q
  usuario: %q
  senha: %q

saas:
  base_url: %q
  api_key: %q

coleta:
  inicio_em: agora

log:
  nivel: info
  arquivo: logs/agente.log
`, time.Now().Format("02/01/2006 15:04"), d.Escola, d.Servidor, linhaConexao,
		d.Database, d.Usuario, d.Senha, strings.TrimRight(d.BaseURL, "/"), d.APIKey)

	// 0600: o arquivo carrega a senha do banco e a chave da escola.
	return os.WriteFile(caminho, []byte(conteudo), 0o600)
}
