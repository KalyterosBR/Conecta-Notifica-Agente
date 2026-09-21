// Package instalador é o assistente de instalação interativo: descobre a
// instância do SQL Server, prepara rede e autenticação, cria o usuário
// somente leitura, escreve o config.yaml e testa a ponta a ponta.
// Um passo falhou? Cai no modo manual com instrução pronta, sem abortar.
package instalador

import (
	"bufio"
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/base64"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"gopkg.in/yaml.v3"

	"github.com/conecta/notifica-agent/internal/api"
	"github.com/conecta/notifica-agent/internal/banco"
	"github.com/conecta/notifica-agent/internal/config"
	"github.com/conecta/notifica-agent/internal/modelo"
)

// Resultado diz ao chamador o que o usuário decidiu no final.
type Resultado struct {
	InstalarServico bool
}

type assistente struct {
	leitor  *bufio.Reader
	caminho string
	// valores atuais do config.yaml, se existir (defaults dos prompts)
	atual map[string]any
}

// Rodar executa o assistente completo. caminhoConfig é onde gravar o yaml.
func Rodar(caminhoConfig string) (Resultado, error) {
	a := &assistente{
		leitor:  bufio.NewReader(os.Stdin),
		caminho: caminhoConfig,
		atual:   map[string]any{},
	}
	if b, err := os.ReadFile(caminhoConfig); err == nil {
		_ = yaml.Unmarshal(b, &a.atual)
	}
	return a.executar()
}

func (a *assistente) executar() (Resultado, error) {
	fmt.Println()
	fmt.Println("=====================================================")
	fmt.Println("  CONECTA NOTIFICA — instalador do agente")
	fmt.Println("=====================================================")
	fmt.Println()

	if !elevado() {
		fmt.Println("AVISO: sem permissão de administrador alguns passos")
		fmt.Println("(habilitar rede do SQL Server, instalar o serviço) podem falhar.")
		fmt.Println("Se algo der errado, feche e use o INSTALAR.bat.")
		fmt.Println()
	}

	// ---- 1. instância do SQL Server -------------------------------------
	fmt.Println("[1/6] Procurando o SQL Server nesta máquina...")
	instancia, servidor, porta := a.escolherInstancia()

	// ---- 2. preparo do servidor (registro do Windows) --------------------
	if instancia != "" {
		fmt.Println("\n[2/6] Preparando o SQL Server (TCP, autenticação mista)...")
		mudou, avisos := prepararServidor(instancia)
		for _, av := range avisos {
			fmt.Println("   ", av)
		}
		if mudou {
			fmt.Println("    reiniciando o serviço do SQL Server para aplicar...")
			for _, av := range reiniciarSQLServer(instancia) {
				fmt.Println("   ", av)
			}
		} else {
			fmt.Println("    nada a mudar — já estava pronto.")
		}
	} else {
		fmt.Println("\n[2/6] Servidor remoto/porta fixa: pulando preparo local.")
	}

	// ---- 3. conexão administrativa + banco da catraca --------------------
	fmt.Println("\n[3/6] Localizando o banco da catraca...")
	admin := a.conectarAdmin(servidor, instancia, porta)
	database := ""
	if admin != nil {
		defer admin.Close()
		database = a.detectarDatabase(admin)
	}
	if database == "" {
		database = a.perguntar("Nome do banco de dados da catraca", a.textoAtual("banco", "database"))
	}

	// ---- 4. usuário somente leitura ---------------------------------------
	fmt.Println("\n[4/6] Criando o usuário de leitura (notifica_ro)...")
	senha := novaSenha()
	if admin != nil {
		if err := criarLogin(admin, database, senha); err != nil {
			fmt.Println("    não consegui criar automaticamente:", resumo(err))
			a.loginManual(database, senha)
		} else {
			fmt.Println("    usuário notifica_ro criado/atualizado com senha gerada.")
		}
	} else {
		a.loginManual(database, senha)
	}

	// ---- 5. servidor Conecta Notifica ------------------------------------
	fmt.Println("\n[5/6] Conexão com o Conecta Notifica")
	baseURL := a.perguntar("Endereço do servidor", a.textoAtual("saas", "base_url"))
	apiKey := a.perguntar("Chave da escola (API key)", a.textoAtual("saas", "api_key"))
	nomeEscola := a.perguntar("Nome da escola", a.textoAtualOu("escola", "nome", "Minha Escola"))

	// ---- grava o config ---------------------------------------------------
	if err := a.gravarConfig(nomeEscola, servidor, instancia, porta, database, senha, baseURL, apiKey); err != nil {
		return Resultado{}, err
	}
	fmt.Println("\nconfig.yaml gravado em", a.caminho)

	// ---- 6. teste ponta a ponta ------------------------------------------
	fmt.Println("\n[6/6] Testando tudo...")
	if err := a.testar(); err != nil {
		fmt.Println("    TESTE FALHOU:", resumo(err))
		fmt.Println("    Corrija e rode o teste de novo pelo menu (opção 2).")
		a.pausar()
		return Resultado{}, nil
	}
	fmt.Println("    banco ok · marcações ok · servidor ok")

	fmt.Println()
	r := Resultado{}
	if a.confirmar("Instalar como serviço do Windows agora (inicia junto com o sistema)?", true) {
		r.InstalarServico = true
	}
	return r, nil
}

// ---------------------------------------------------------------------------

func (a *assistente) escolherInstancia() (instancia, servidor string, porta int) {
	servidor = "localhost"
	instancias := listarInstancias()
	switch len(instancias) {
	case 0:
		fmt.Println("    nenhuma instância local encontrada no registro.")
		entrada := a.perguntar(`Endereço do SQL Server (ex.: localhost\SQLEXPRESS ou servidor,1433)`,
			a.instanciaAtual())
		return separarEndereco(entrada)
	case 1:
		fmt.Printf("    encontrada: %s\n", rotulo(instancias[0]))
		return instancias[0], "localhost", 0
	default:
		fmt.Println("    instâncias encontradas:")
		for i, inst := range instancias {
			fmt.Printf("      [%d] %s\n", i+1, rotulo(inst))
		}
		for {
			e := a.perguntar("Qual delas é a da catraca? (número)", "1")
			var n int
			fmt.Sscanf(e, "%d", &n)
			if n >= 1 && n <= len(instancias) {
				return instancias[n-1], "localhost", 0
			}
		}
	}
}

func rotulo(instancia string) string {
	if instancia == "MSSQLSERVER" {
		return "instância padrão (MSSQLSERVER)"
	}
	return `localhost\` + instancia
}

func separarEndereco(e string) (instancia, servidor string, porta int) {
	e = strings.TrimSpace(e)
	if i := strings.IndexByte(e, ','); i > 0 {
		fmt.Sscanf(e[i+1:], "%d", &porta)
		return "", e[:i], porta
	}
	if i := strings.IndexByte(e, '\\'); i > 0 {
		return e[i+1:], e[:i], 0
	}
	return "", e, 1433
}

// conectarAdmin tenta entrar com a conta Windows de quem está instalando
// (autenticação integrada). Funciona quando quem instala tem acesso de
// administrador no SQL Server — o caso comum no Express da catraca.
func (a *assistente) conectarAdmin(servidor, instancia string, porta int) *sql.DB {
	dsn := dsnIntegrado(servidor, instancia, porta)
	if dsn == "" {
		return nil
	}
	db, err := sql.Open("sqlserver", dsn)
	if err != nil {
		return nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := db.PingContext(ctx); err != nil {
		fmt.Println("    sem acesso administrativo automático:", resumo(err))
		db.Close()
		return nil
	}
	fmt.Println("    conectado com a conta do Windows.")
	return db
}

// detectarDatabase procura em quais bancos existe a tabela dbo.Marcacao.
func (a *assistente) detectarDatabase(db *sql.DB) string {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	// Mesma busca que o instalador do Windows usa (deteccao.go): um banco só
	// é candidato se tiver a tabela que o agente lê.
	candidatos := bancosComMarcacao(ctx, db)
	switch len(candidatos) {
	case 0:
		fmt.Println("    nenhum banco com a tabela dbo.Marcacao foi encontrado.")
		return ""
	case 1:
		fmt.Printf("    banco da catraca encontrado: %s\n", candidatos[0])
		return candidatos[0]
	default:
		fmt.Println("    mais de um banco tem dbo.Marcacao:")
		for i, n := range candidatos {
			fmt.Printf("      [%d] %s\n", i+1, n)
		}
		for {
			e := a.perguntar("Qual usar? (número)", "1")
			var n int
			fmt.Sscanf(e, "%d", &n)
			if n >= 1 && n <= len(candidatos) {
				return candidatos[n-1]
			}
		}
	}
}

func criarLogin(db *sql.DB, database, senha string) error {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	dbSeguro := strings.ReplaceAll(database, "]", "]]")
	cmds := []string{
		fmt.Sprintf(`IF SUSER_ID('notifica_ro') IS NULL
			CREATE LOGIN [notifica_ro] WITH PASSWORD = '%s', CHECK_POLICY = OFF, DEFAULT_DATABASE = [master]
		ELSE
			ALTER LOGIN [notifica_ro] WITH PASSWORD = '%s', DEFAULT_DATABASE = [master]`, senha, senha),
		`ALTER LOGIN [notifica_ro] ENABLE`,
		fmt.Sprintf(`USE [%s]; IF USER_ID('notifica_ro') IS NULL CREATE USER [notifica_ro] FOR LOGIN [notifica_ro]`, dbSeguro),
		fmt.Sprintf(`USE [%s]; GRANT SELECT ON dbo.Marcacao TO [notifica_ro];
			IF OBJECT_ID('dbo.Locais') IS NOT NULL GRANT SELECT ON dbo.Locais TO [notifica_ro];
			IF OBJECT_ID('dbo.Inners') IS NOT NULL GRANT SELECT ON dbo.Inners TO [notifica_ro];
			GRANT VIEW DEFINITION ON dbo.Marcacao TO [notifica_ro]`, dbSeguro),
	}
	for _, c := range cmds {
		if _, err := db.ExecContext(ctx, c); err != nil {
			return err
		}
	}
	return nil
}

func (a *assistente) loginManual(database, senha string) {
	fmt.Println()
	fmt.Println("    MODO MANUAL: cole o bloco abaixo no SSMS (conectado como")
	fmt.Println("    administrador) e execute. Depois volte aqui e dê Enter.")
	fmt.Println("    ------------------------------------------------------")
	fmt.Printf(`    IF SUSER_ID('notifica_ro') IS NULL
      CREATE LOGIN [notifica_ro] WITH PASSWORD = '%s', CHECK_POLICY = OFF, DEFAULT_DATABASE = [master];
    ELSE
      ALTER LOGIN [notifica_ro] WITH PASSWORD = '%s', DEFAULT_DATABASE = [master];
    USE [%s];
    IF USER_ID('notifica_ro') IS NULL CREATE USER [notifica_ro] FOR LOGIN [notifica_ro];
    GRANT SELECT ON dbo.Marcacao TO [notifica_ro];
    GRANT VIEW DEFINITION ON dbo.Marcacao TO [notifica_ro];
`, senha, senha, database)
	fmt.Println("    ------------------------------------------------------")
	fmt.Println("    (a senha acima já vai gravada no config.yaml)")
	a.pausar()
}

func (a *assistente) gravarConfig(nome, servidor, instancia string, porta int, database, senha, baseURL, apiKey string) error {
	// O formato do arquivo mora em Escrever, compartilhado com o comando
	// `configurar` que o instalador do Windows chama.
	return Escrever(a.caminho, Dados{
		Escola:    nome,
		Servidor:  servidor,
		Instancia: instancia,
		Porta:     porta,
		Database:  database,
		Usuario:   "notifica_ro",
		Senha:     senha,
		BaseURL:   baseURL,
		APIKey:    apiKey,
	})
}

func (a *assistente) testar() error {
	cfg, err := config.Carregar(a.caminho)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	repo, err := banco.Abrir(ctx, cfg)
	if err != nil {
		return fmt.Errorf("banco: %w", err)
	}
	defer repo.Fechar()
	if _, err := repo.BuscarMarcacoes(ctx, "0", 1); err != nil {
		return fmt.Errorf("consulta de marcações: %w", err)
	}
	cli := api.Novo(cfg, "instalador")
	if err := cli.Heartbeat(ctx, modelo.Heartbeat{BancoOK: true}); err != nil {
		return fmt.Errorf("servidor: %w", err)
	}
	return nil
}

// -------------------- utilitários de prompt e config -----------------------

func (a *assistente) perguntar(rotulo, padrao string) string {
	if padrao != "" {
		fmt.Printf("  %s [%s]: ", rotulo, padrao)
	} else {
		fmt.Printf("  %s: ", rotulo)
	}
	linha, _ := a.leitor.ReadString('\n')
	linha = strings.TrimSpace(linha)
	if linha == "" {
		return padrao
	}
	return linha
}

func (a *assistente) confirmar(rotulo string, padrao bool) bool {
	sim := "S/n"
	if !padrao {
		sim = "s/N"
	}
	r := strings.ToLower(a.perguntar(rotulo+" ["+sim+"]", ""))
	if r == "" {
		return padrao
	}
	return r == "s" || r == "sim" || r == "y"
}

func (a *assistente) pausar() {
	fmt.Print("  pressione Enter para continuar... ")
	a.leitor.ReadString('\n')
}

func (a *assistente) textoAtual(secao, chave string) string {
	if m, ok := a.atual[secao].(map[string]any); ok {
		if v, ok := m[chave].(string); ok {
			// placeholders do pacote não valem como default
			if strings.HasPrefix(v, "NOME_") || strings.HasPrefix(v, "TROQUE") || v == "MINHA ESCOLA" {
				return ""
			}
			return v
		}
	}
	return ""
}

func (a *assistente) textoAtualOu(secao, chave, padrao string) string {
	if v := a.textoAtual(secao, chave); v != "" {
		return v
	}
	return padrao
}

func (a *assistente) instanciaAtual() string {
	if m, ok := a.atual["banco"].(map[string]any); ok {
		srv, _ := m["servidor"].(string)
		if inst, ok := m["instancia"].(string); ok && inst != "" {
			return srv + `\` + inst
		}
	}
	return `localhost\SQLEXPRESS`
}

func novaSenha() string {
	b := make([]byte, 18)
	rand.Read(b)
	return "Cn1!" + base64.RawURLEncoding.EncodeToString(b)
}

func resumo(err error) string {
	s := err.Error()
	if len(s) > 180 {
		s = s[:180] + "..."
	}
	return s
}

var _ = filepath.Dir // mantém o import em builds sem uso direto
