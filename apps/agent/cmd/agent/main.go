// Comando notifica-agent: serviço que lê as marcações da catraca no SQL
// Server da escola e envia para o Conecta Notifica.
package main

import (
	"bufio"
	"context"
	"flag"
	"fmt"
	"io"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
	// Embute o banco de fusos IANA no binário: o Windows não tem zoneinfo,
	// e sem isto escola.timezone ("America/Sao_Paulo") falha ao carregar.
	_ "time/tzdata"

	"github.com/kardianos/service"

	"github.com/conecta/notifica-agent/internal/agente"
	"github.com/conecta/notifica-agent/internal/api"
	"github.com/conecta/notifica-agent/internal/banco"
	"github.com/conecta/notifica-agent/internal/bandeja"
	"github.com/conecta/notifica-agent/internal/config"
	"github.com/conecta/notifica-agent/internal/estado"
	"github.com/conecta/notifica-agent/internal/fila"
	"github.com/conecta/notifica-agent/internal/instalador"
	"github.com/conecta/notifica-agent/internal/modelo"
	"github.com/conecta/notifica-agent/internal/painel"
)

// Versao é injetada no build: -ldflags "-X main.Versao=1.0.0".
var Versao = "dev"

const uso = `notifica-agent — ponte entre a catraca (SQL Server) e o Conecta Notifica

uso: notifica-agent [comando] [flags]

comandos:
	  (sem args)   abre a central gráfica (dois cliques no .exe, Windows)
	  painel       abre a central gráfica de operação
	  menu         abre o menu de texto (suporte e automação manual)
  assistente   instalador guiado: configura banco, usuário e serviço
  configurar   grava o config.yaml pelas flags, sem perguntar nada
               (é o que o instalador do Windows chama entre as telas)
  bandeja      ícone ao lado do relógio com o estado do agente (Windows)
  detectar     procura o SQL Server desta máquina e os bancos da catraca;
               com -saida, grava um .ini que o instalador lê para já vir
               com servidor, instância, porta e banco preenchidos
  run          roda em primeiro plano
  instalar     registra como serviço do Windows
  desinstalar  remove o serviço
  iniciar      inicia o serviço
  parar        para o serviço
  status       mostra o estado do serviço
  testar       testa a conexão com o banco e com o SaaS e sai
  descobrir    imprime o reconhecimento do banco (colunas, locais, amostras)
  versao       imprime a versão

flags:
`

func main() {
	fs := flag.NewFlagSet("notifica-agent", flag.ExitOnError)
	caminhoConfig := fs.String("config", "config.yaml", "caminho do config.yaml")
	// Flags do comando `configurar`. Ficam no mesmo FlagSet por simplicidade;
	// os outros comandos apenas as ignoram.
	cfgEscola := fs.String("escola", "", "configurar: nome da escola")
	cfgServidor := fs.String("servidor", "", "configurar: host do SQL Server")
	cfgInstancia := fs.String("instancia", "", "configurar: instância nomeada (ex.: SQLEXPRESS)")
	cfgPorta := fs.Int("porta", 0, "configurar: porta do SQL Server (alternativa à instância)")
	cfgDatabase := fs.String("database", "", "configurar: banco da catraca")
	cfgUsuario := fs.String("usuario", "notifica_ro", "configurar: usuário de leitura do banco")
	cfgSenha := fs.String("senha", "", "configurar: senha do usuário de leitura")
	cfgURL := fs.String("url", "", "configurar: endereço do Conecta Notifica")
	cfgChave := fs.String("api-key", "", "configurar: chave da escola (cn_...)")
	cfgTestar := fs.Bool("testar", false, "configurar: testa banco e SaaS depois de gravar")
	detSaida := fs.String("saida", "", "detectar: grava o resultado neste .ini")
	detInstancia := fs.String("da-instancia", "", "detectar: lista os bancos só desta instância (ex.: localhost\\SQLEXPRESS)")
	fs.Usage = func() {
		fmt.Fprint(os.Stderr, uso)
		fs.PrintDefaults()
	}

	comando := "painel"
	args := os.Args[1:]
	if len(args) > 0 && !strings.HasPrefix(args[0], "-") {
		comando, args = args[0], args[1:]
	}
	if err := fs.Parse(args); err != nil {
		os.Exit(2)
	}

	if comando == "versao" {
		fmt.Println("notifica-agent", Versao)
		return
	}

	if comando == "detectar" {
		if err := detectar(*detSaida, *detInstancia); err != nil {
			fmt.Fprintln(os.Stderr, "erro:", err)
			os.Exit(1)
		}
		return
	}

	if comando == "configurar" {
		if err := configurar(*caminhoConfig, instalador.Dados{
			Escola:    *cfgEscola,
			Servidor:  *cfgServidor,
			Instancia: *cfgInstancia,
			Porta:     *cfgPorta,
			Database:  *cfgDatabase,
			Usuario:   *cfgUsuario,
			Senha:     *cfgSenha,
			BaseURL:   *cfgURL,
			APIKey:    *cfgChave,
		}, *cfgTestar); err != nil {
			fmt.Fprintln(os.Stderr, "erro:", err)
			os.Exit(1)
		}
		return
	}

	if err := executar(comando, *caminhoConfig); err != nil {
		fmt.Fprintln(os.Stderr, "erro:", err)
		os.Exit(1)
	}
}

func executar(comando, caminhoConfig string) error {
	abs, err := filepath.Abs(caminhoConfig)
	if err != nil {
		return err
	}

	svcCfg := &service.Config{
		Name:        "ConectaNotificaAgent",
		DisplayName: "Conecta Notifica — Agente",
		Description: "Lê as marcações de acesso no SQL Server e envia para o Conecta Notifica.",
		Arguments:   []string{"run", "-config", abs},
	}

	switch comando {
	case "painel":
		return abrirPainel(abs, svcCfg)
	case "menu":
		return menu(abs, svcCfg)
	case "assistente":
		return assistente(abs, svcCfg)
	}

	// Comandos de ciclo de vida do serviço não precisam do config carregado.
	switch comando {
	case "instalar", "desinstalar", "iniciar", "parar", "status":
		s, err := service.New(&programa{}, svcCfg)
		if err != nil {
			return err
		}
		return controlarServico(s, comando)
	}

	cfg, err := config.Carregar(abs)
	if err != nil {
		return err
	}
	baseDir := filepath.Dir(abs)
	if !filepath.IsAbs(cfg.Armazenamento.Diretorio) {
		cfg.Armazenamento.Diretorio = filepath.Join(baseDir, cfg.Armazenamento.Diretorio)
	}
	if cfg.Log.Arquivo != "" && !filepath.IsAbs(cfg.Log.Arquivo) {
		cfg.Log.Arquivo = filepath.Join(baseDir, cfg.Log.Arquivo)
	}
	log, fecharLog, err := montarLog(cfg)
	if err != nil {
		return err
	}
	defer fecharLog()

	switch comando {
	case "bandeja":
		// Roda na sessão do usuário e só lê o arquivo de estado que o
		// serviço publica — não fala com o banco nem com o SaaS.
		exe, err := os.Executable()
		if err != nil {
			exe = "notifica-agent.exe"
		}
		return bandeja.Rodar(cfg.Armazenamento.Diretorio, exe)
	case "descobrir":
		return descobrir(cfg)
	case "testar":
		return testar(cfg, log)
	case "run":
		p := &programa{cfg: cfg, log: log}
		s, err := service.New(p, svcCfg)
		if err != nil {
			return err
		}
		return s.Run()
	default:
		return fmt.Errorf("comando desconhecido: %q (use -h)", comando)
	}
}

// configurar grava o config.yaml sem interação. É o que o instalador do
// Windows chama depois de coletar os campos nas telas de "Avançar": a lógica
// (validação, formato do arquivo, backup) fica aqui, no código testado, e não
// espalhada no script do instalador.
func configurar(caminho string, d instalador.Dados, comTeste bool) error {
	abs, err := filepath.Abs(caminho)
	if err != nil {
		return err
	}
	if err := instalador.Escrever(abs, d); err != nil {
		return err
	}
	fmt.Println("config.yaml gravado em", abs)
	if !comTeste {
		return nil
	}

	cfg, err := config.Carregar(abs)
	if err != nil {
		return err
	}
	baseDir := filepath.Dir(abs)
	if !filepath.IsAbs(cfg.Armazenamento.Diretorio) {
		cfg.Armazenamento.Diretorio = filepath.Join(baseDir, cfg.Armazenamento.Diretorio)
	}
	if cfg.Log.Arquivo != "" && !filepath.IsAbs(cfg.Log.Arquivo) {
		cfg.Log.Arquivo = filepath.Join(baseDir, cfg.Log.Arquivo)
	}
	log, fechar, err := montarLog(cfg)
	if err != nil {
		return err
	}
	defer fechar()
	return testar(cfg, log)
}

// detectar imprime (ou grava) o que foi encontrado nesta máquina. É chamado
// pelo instalador do Windows antes da tela do banco, para os campos já virem
// preenchidos em vez de a secretaria ter que saber o nome da instância.
func detectar(saida, daInstancia string) error {
	var d instalador.Deteccao
	if daInstancia != "" {
		// Recarga: a pessoa trocou a instância no combo e quer os bancos dela.
		alvo := instalador.SepararRotulo(daInstancia)
		bancos, melhor := instalador.BancosDe(alvo)
		d = instalador.Deteccao{Instancias: []instalador.Instancia{alvo}, Bancos: bancos, Escolhida: alvo, Database: melhor}
		if len(bancos) == 0 {
			d.Aviso = "nenhum banco com dbo.Marcacao nesta instância"
		}
	} else {
		d = instalador.Detectar()
	}

	if saida != "" {
		return d.EscreverINI(saida)
	}
	fmt.Println("instâncias encontradas:")
	for _, i := range d.Instancias {
		fmt.Println("  -", i.Rotulo())
	}
	fmt.Println("bancos com dbo.Marcacao:")
	if len(d.Bancos) == 0 {
		fmt.Println("  (nenhum)")
	}
	for _, b := range d.Bancos {
		fmt.Println("  -", b)
	}
	if d.Aviso != "" {
		fmt.Println("aviso:", d.Aviso)
	}
	return nil
}

func controlarServico(s service.Service, comando string) error {
	switch comando {
	case "status":
		st, err := s.Status()
		if err != nil {
			return err
		}
		switch st {
		case service.StatusRunning:
			fmt.Println("serviço rodando")
		case service.StatusStopped:
			fmt.Println("serviço parado")
		default:
			fmt.Println("serviço não instalado")
		}
		return nil
	}
	acao := map[string]string{
		"instalar": "install", "desinstalar": "uninstall",
		"iniciar": "start", "parar": "stop",
	}[comando]
	if err := service.Control(s, acao); err != nil {
		return err
	}
	fmt.Printf("ok: %s\n", comando)
	return nil
}

// programa implementa service.Interface para o kardianos/service.
type programa struct {
	cfg    *config.Config
	log    *slog.Logger
	cancel context.CancelFunc
	pronto chan struct{}
}

func (p *programa) Start(service.Service) error {
	ctx, cancel := context.WithCancel(context.Background())
	p.cancel = cancel
	p.pronto = make(chan struct{})
	go func() {
		defer close(p.pronto)
		if err := rodar(ctx, p.cfg, p.log); err != nil && ctx.Err() == nil {
			p.log.Error("agente parou", "erro", err)
		}
	}()
	return nil
}

func (p *programa) Stop(service.Service) error {
	if p.cancel != nil {
		p.cancel()
	}
	select {
	case <-p.pronto:
	case <-time.After(15 * time.Second):
		p.log.Warn("encerramento excedeu 15s, saindo mesmo assim")
	}
	return nil
}

func rodar(ctx context.Context, cfg *config.Config, log *slog.Logger) error {
	f, err := fila.Abrir(cfg.Armazenamento.Diretorio)
	if err != nil {
		return err
	}
	defer f.Fechar()

	janela := time.Duration(cfg.Coleta.VarreduraHoras) * time.Hour
	if janela < time.Hour {
		janela = time.Hour
	}
	v, err := fila.AbrirVistos(cfg.Armazenamento.Diretorio, janela)
	if err != nil {
		return err
	}
	defer v.Fechar()

	// A conexão com o banco é tentada em laço: o SQL Server da escola pode
	// subir depois do serviço no boot da máquina.
	var repo *banco.Repo
	for {
		repo, err = banco.Abrir(ctx, cfg)
		if err == nil {
			break
		}
		log.Error("sem conexão com o SQL Server, tentando de novo em 30s", "erro", err)
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(30 * time.Second):
		}
	}
	defer repo.Fechar()

	a := agente.Novo(cfg, log, repo, f, v, api.Novo(cfg, Versao))
	return a.Rodar(ctx)
}

func descobrir(cfg *config.Config) error {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	repo, err := banco.Abrir(ctx, cfg)
	if err != nil {
		return err
	}
	defer repo.Fechar()
	fmt.Print(repo.Descobrir(ctx))
	return nil
}

func testar(cfg *config.Config, log *slog.Logger) error {
	relatorio, err := testarComRelatorio(cfg, log)
	if err != nil {
		return err
	}
	fmt.Print(relatorio)
	return nil
}

// testarComRelatorio concentra a verificação que é usada tanto pelo comando
// de suporte quanto pela central gráfica. O texto não inclui DSN, senha ou
// chave da escola.
func testarComRelatorio(cfg *config.Config, log *slog.Logger) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	var relatorio strings.Builder

	repo, err := banco.Abrir(ctx, cfg)
	if err != nil {
		return "", fmt.Errorf("banco: %w", err)
	}
	defer repo.Fechar()
	fmt.Fprintf(&relatorio, "Banco da catraca: conectado (cursor por %s)\n", repo.ModoCursor(ctx))

	linhas, err := repo.BuscarMarcacoes(ctx, "0", 3)
	if err != nil {
		return "", fmt.Errorf("consulta de marcações: %w", err)
	}
	fmt.Fprintf(&relatorio, "Marcações: consulta concluída (%d linhas de amostra)\n", len(linhas))

	if cfg.Consultas.SincronizarAlunos {
		alunos, err := repo.BuscarAlunos(ctx)
		if err != nil {
			return "", fmt.Errorf("consulta de alunos: %w", err)
		}
		fmt.Fprintf(&relatorio, "Cadastros: consulta concluída (%d registros)\n", len(alunos))
	}

	cli := api.Novo(cfg, Versao)
	if err := cli.Heartbeat(ctx, modelo.Heartbeat{BancoOK: true}); err != nil {
		return "", fmt.Errorf("Conecta Notifica: %w", err)
	}
	relatorio.WriteString("Conecta Notifica: conectado\n")
	if perfil, err := cli.Perfil(ctx); err == nil {
		if err := estado.GravarIdentidade(estado.CaminhoIdentidade(cfg.Armazenamento.Diretorio), estado.Identidade{
			EscolaID: perfil.EscolaID, EscolaNome: perfil.EscolaNome, Timezone: perfil.Timezone,
			Bloqueada: perfil.Bloqueada, WhatsAppConectado: perfil.WhatsAppConectado,
		}); err != nil {
			log.Warn("não foi possível guardar a identidade da escola", "erro", err)
		}
		statusWhatsApp := "não conectado"
		if perfil.WhatsAppConectado {
			statusWhatsApp = "conectado"
		}
		bloqueio := "não"
		if perfil.Bloqueada {
			bloqueio = "sim"
		}
		fmt.Fprintf(&relatorio, "Escola conectada: %s\nWhatsApp: %s\nEscola bloqueada: %s\n", perfil.EscolaNome, statusWhatsApp, bloqueio)
	} else if erroHTTP, ok := err.(*api.ErroHTTP); !ok || erroHTTP.Status != 404 {
		// A rota foi criada depois das versões iniciais do SaaS. Falhar nela
		// nunca invalida uma conexão que já foi comprovada pelo heartbeat.
		log.Warn("não foi possível consultar a identidade da escola", "erro", err)
	}
	relatorio.WriteString("\nTeste concluído com sucesso.")
	return relatorio.String(), nil
}

// abrirPainel é a entrada usada no duplo clique do executável. A janela só
// coordena comandos já existentes; a coleta, a fila local e o serviço seguem
// exatamente os mesmos caminhos usados pela linha de comando.
func abrirPainel(caminhoConfig string, svcCfg *service.Config) error {
	return painel.Rodar(painel.Acoes{
		Resumo: func() string { return resumoPainel(caminhoConfig) },
		Testar: func() (string, error) {
			cfg, log, fechar, err := carregarParaAcao(caminhoConfig)
			if err != nil {
				return "", err
			}
			defer fechar()
			return testarComRelatorio(cfg, log)
		},
		InstalarServico: func() error { return repararServico(caminhoConfig, svcCfg) },
		IniciarServico:  func() error { return iniciarServicoComSeguranca(caminhoConfig, svcCfg) },
		PararServico:    func() error { return controlarServicoNovo(svcCfg, "parar") },
		AbrirConfiguracao: func() error {
			if !arquivoExiste(caminhoConfig) {
				return fmt.Errorf("o agente ainda não foi configurado; execute o instalador gráfico ConectaNotifica-Agente primeiro")
			}
			return exec.Command("notepad.exe", caminhoConfig).Start()
		},
		GerarDiagnostico: func() (string, error) {
			caminho, err := diagnosticoSeguroParaArquivo(caminhoConfig)
			if err != nil {
				return "", err
			}
			return "Diagnóstico seguro salvo em " + filepath.Base(caminho) + ".", nil
		},
		AbrirPasta: func() error {
			return exec.Command("explorer.exe", filepath.Dir(caminhoConfig)).Start()
		},
	})
}

func controlarServicoNovo(svcCfg *service.Config, comando string) error {
	s, err := service.New(&programa{}, svcCfg)
	if err != nil {
		return err
	}
	return controlarServico(s, comando)
}

func iniciarServicoComSeguranca(caminhoConfig string, svcCfg *service.Config) error {
	if err := garantirSemExecucaoManual(caminhoConfig, svcCfg); err != nil {
		return err
	}
	return controlarServicoNovo(svcCfg, "iniciar")
}

// repararServico preserva o comportamento do instalador: troca uma
// instalação anterior pelo binário/configuração atuais e sobe o serviço.
func repararServico(caminhoConfig string, svcCfg *service.Config) error {
	if err := garantirSemExecucaoManual(caminhoConfig, svcCfg); err != nil {
		return err
	}
	s, err := service.New(&programa{}, svcCfg)
	if err != nil {
		return err
	}
	_ = service.Control(s, "stop")
	_ = service.Control(s, "uninstall")
	if err := service.Control(s, "install"); err != nil {
		return fmt.Errorf("instalando serviço: %w", err)
	}
	if err := service.Control(s, "start"); err != nil {
		return fmt.Errorf("iniciando serviço: %w", err)
	}
	return nil
}

// garantirSemExecucaoManual evita a disputa por dados/vistos.log. Quando há
// estado recente, mas o serviço não está em execução, há um `run` manual
// ativo (ou acabou de encerrar); nesse caso a decisão segura é não subir uma
// segunda cópia até a pessoa fechar a janela manual.
func garantirSemExecucaoManual(caminhoConfig string, svcCfg *service.Config) error {
	if s, err := service.New(&programa{}, svcCfg); err == nil {
		if st, err := s.Status(); err == nil && st == service.StatusRunning {
			return nil
		}
	}
	cfg, err := config.Carregar(caminhoConfig)
	if err != nil {
		return err
	}
	dirDados := cfg.Armazenamento.Diretorio
	if !filepath.IsAbs(dirDados) {
		dirDados = filepath.Join(filepath.Dir(caminhoConfig), dirDados)
	}
	if e, err := estado.Ler(estado.Caminho(dirDados)); err == nil && e.Fresco(time.Now(), 3*time.Minute) {
		return fmt.Errorf("há uma execução manual recente do agente; feche-a antes de iniciar o serviço para não disputar dados/vistos.log")
	}
	return nil
}

func resumoPainel(caminhoConfig string) string {
	if !arquivoExiste(caminhoConfig) {
		return "Configuração pendente — execute o instalador gráfico ConectaNotifica-Agente."
	}
	cfg, err := config.Carregar(caminhoConfig)
	if err != nil {
		return "Configuração inválida: " + err.Error()
	}
	dirDados := cfg.Armazenamento.Diretorio
	if !filepath.IsAbs(dirDados) {
		dirDados = filepath.Join(filepath.Dir(caminhoConfig), dirDados)
	}
	e, err := estado.Ler(estado.Caminho(dirDados))
	if err != nil {
		return "Ainda não há estado publicado pelo agente. Use Testar conexões para verificar a instalação."
	}
	agora := time.Now()
	if !e.Fresco(agora, 3*time.Minute) {
		return "AGENTE SEM ATUALIZAÇÃO RECENTE\n" +
			"Última comunicação: " + e.Em.In(time.Local).Format("02/01/2006 15:04:05") + "\n" +
			"Use Testar conexões ou Iniciar serviço para corrigir."
	}
	banco := "Conectado"
	if !e.BancoOK {
		banco = "Sem conexão"
	}
	saas := "Conectado"
	if !e.SaaSOK {
		saas = "Sem conexão"
	}
	ultimo := e.UltimoEvento
	if ultimo == "" {
		ultimo = "Nenhum evento enviado nesta execução"
	}
	texto := "AGENTE ATIVO\n" +
		identidadePainel(dirDados, cfg.Escola.Nome) + "\n" +
		"Banco da catraca: " + banco + "  |  Painel: " + saas + "\n" +
		fmt.Sprintf("Fila local: %d evento(s) pendente(s)  |  Enviados hoje: %d\n", e.Pendentes, e.EnviadosHoje) +
		"Último evento: " + ultimo + "\n" +
		"Atualizado: " + e.Em.In(time.Local).Format("02/01/2006 15:04:05")
	if e.UltimoErro != "" {
		texto += "\nÚltimo erro: " + textoSeguro(e.UltimoErro)
	}
	return texto
}

func identidadePainel(dirDados, nomeConfigurado string) string {
	i, err := estado.LerIdentidade(estado.CaminhoIdentidade(dirDados))
	if err == nil && i.EscolaNome != "" {
		texto := "Escola conectada: " + i.EscolaNome
		if i.Bloqueada {
			texto += " (BLOQUEADA)"
		}
		return texto
	}
	if nomeConfigurado != "" {
		return "Escola configurada: " + nomeConfigurado + " (confirme em Testar conexões)"
	}
	return "Escola: ainda não identificada"
}

// diagnosticoSeguroParaArquivo cria um relatório que a escola pode enviar ao
// suporte sem revelar senha SQL, API key, DSN ou conteúdo da fila local.
func diagnosticoSeguroParaArquivo(caminhoConfig string) (string, error) {
	cfg, err := config.Carregar(caminhoConfig)
	if err != nil {
		return "", err
	}
	dirDados := cfg.Armazenamento.Diretorio
	if !filepath.IsAbs(dirDados) {
		dirDados = filepath.Join(filepath.Dir(caminhoConfig), dirDados)
	}

	var b strings.Builder
	b.WriteString("Conecta Notifica — diagnóstico seguro\n")
	b.WriteString("Gerado em: " + time.Now().Format("02/01/2006 15:04:05") + "\n")
	b.WriteString("Versão do agente: " + Versao + "\n")
	b.WriteString("Configuração: válida\n")

	e, err := estado.Ler(estado.Caminho(dirDados))
	if err != nil {
		b.WriteString("Estado do agente: ainda não publicado\n")
	} else {
		b.WriteString("Última atualização: " + e.Em.In(time.Local).Format("02/01/2006 15:04:05") + "\n")
		b.WriteString(fmt.Sprintf("Banco da catraca: %t\nPainel: %t\nFila local: %d\nEnviados hoje: %d\n", e.BancoOK, e.SaaSOK, e.Pendentes, e.EnviadosHoje))
		if e.UltimoEvento != "" {
			b.WriteString("Último evento: " + e.UltimoEvento + "\n")
		}
		if e.UltimoErro != "" {
			b.WriteString("Último erro: " + textoSeguro(e.UltimoErro) + "\n")
		}
	}
	b.WriteString("\nEste relatório não contém credenciais, chaves, DSN ou dados da fila.\n")

	saida := filepath.Join(filepath.Dir(caminhoConfig), "diagnostico-seguro.txt")
	if err := os.WriteFile(saida, []byte(b.String()), 0o644); err != nil {
		return "", err
	}
	return saida, nil
}

func textoSeguro(s string) string {
	linha := strings.Split(strings.ReplaceAll(s, "\r", ""), "\n")[0]
	if len([]rune(linha)) > 240 {
		return string([]rune(linha)[:240]) + "…"
	}
	return linha
}

func carregarParaAcao(caminhoConfig string) (*config.Config, *slog.Logger, func(), error) {
	cfg, err := config.Carregar(caminhoConfig)
	if err != nil {
		return nil, nil, nil, err
	}
	baseDir := filepath.Dir(caminhoConfig)
	if !filepath.IsAbs(cfg.Armazenamento.Diretorio) {
		cfg.Armazenamento.Diretorio = filepath.Join(baseDir, cfg.Armazenamento.Diretorio)
	}
	if cfg.Log.Arquivo != "" && !filepath.IsAbs(cfg.Log.Arquivo) {
		cfg.Log.Arquivo = filepath.Join(baseDir, cfg.Log.Arquivo)
	}
	log, fechar, err := montarLog(cfg)
	if err != nil {
		return nil, nil, nil, err
	}
	return cfg, log, fechar, nil
}

func montarLog(cfg *config.Config) (*slog.Logger, func(), error) {
	nivel := slog.LevelInfo
	switch strings.ToLower(cfg.Log.Nivel) {
	case "debug":
		nivel = slog.LevelDebug
	case "warn":
		nivel = slog.LevelWarn
	case "error":
		nivel = slog.LevelError
	}

	var saidas []io.Writer
	fechar := func() {}
	if service.Interactive() {
		saidas = append(saidas, os.Stdout)
	}
	if cfg.Log.Arquivo != "" {
		if err := os.MkdirAll(filepath.Dir(cfg.Log.Arquivo), 0o755); err != nil {
			return nil, nil, err
		}
		f, err := os.OpenFile(cfg.Log.Arquivo, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
		if err != nil {
			return nil, nil, fmt.Errorf("abrindo log: %w", err)
		}
		saidas = append(saidas, f)
		fechar = func() { f.Close() }
	}
	if len(saidas) == 0 {
		saidas = append(saidas, os.Stdout)
	}
	h := slog.NewTextHandler(io.MultiWriter(saidas...), &slog.HandlerOptions{Level: nivel})
	return slog.New(h), fechar, nil
}

// assistente roda o instalador guiado e, se pedido, instala o serviço.
func assistente(caminhoConfig string, svcCfg *service.Config) error {
	r, err := instalador.Rodar(caminhoConfig)
	if err != nil {
		return err
	}
	if r.InstalarServico {
		s, err := service.New(&programa{}, svcCfg)
		if err != nil {
			return err
		}
		// reinstala por cima se já existia
		_ = service.Control(s, "stop")
		_ = service.Control(s, "uninstall")
		if err := service.Control(s, "install"); err != nil {
			return fmt.Errorf("instalando serviço: %w", err)
		}
		if err := service.Control(s, "start"); err != nil {
			return fmt.Errorf("iniciando serviço: %w", err)
		}
		fmt.Println("\nServiço instalado e rodando. Pode fechar esta janela.")
	} else {
		fmt.Println("\nQuando quiser instalar o serviço: opção 4 do menu.")
	}
	pausaFinal()
	return nil
}

// menu é o que abre nos dois cliques do .exe.
func menu(caminhoConfig string, svcCfg *service.Config) error {
	leitor := bufio.NewReader(os.Stdin)
	for {
		temConfig := arquivoExiste(caminhoConfig)
		fmt.Println()
		fmt.Println("================ CONECTA NOTIFICA — AGENTE ================")
		if !temConfig {
			fmt.Println("  (ainda não configurado — comece pela opção 1)")
		}
		fmt.Println("  [1] Instalar / reconfigurar (assistente)")
		fmt.Println("  [2] Testar conexões")
		fmt.Println("  [3] Rodar na tela (teste ao vivo)")
		fmt.Println("  [4] Instalar como serviço do Windows")
		fmt.Println("  [5] Situação do serviço")
		fmt.Println("  [6] Relatório do banco (descoberta.txt)")
		fmt.Println("  [0] Sair")
		fmt.Print("  escolha: ")
		linha, _ := leitor.ReadString('\n')
		var err error
		switch strings.TrimSpace(linha) {
		case "1":
			err = executar("assistente", caminhoConfig)
			return err // o assistente já encerra com pausa
		case "2":
			err = executar("testar", caminhoConfig)
		case "3":
			err = executar("run", caminhoConfig)
		case "4":
			err = executar("instalar", caminhoConfig)
			if err == nil {
				err = executar("iniciar", caminhoConfig)
			}
		case "5":
			err = executar("status", caminhoConfig)
		case "6":
			err = descobrirParaArquivo(caminhoConfig)
		case "0", "":
			return nil
		}
		if err != nil {
			fmt.Println("  erro:", err)
		}
	}
}

func descobrirParaArquivo(caminhoConfig string) error {
	cfg, err := config.Carregar(caminhoConfig)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	repo, err := banco.Abrir(ctx, cfg)
	if err != nil {
		return err
	}
	defer repo.Fechar()
	saida := filepath.Join(filepath.Dir(caminhoConfig), "descoberta.txt")
	if err := os.WriteFile(saida, []byte(repo.Descobrir(ctx)), 0o644); err != nil {
		return err
	}
	fmt.Println("  relatório gravado em", saida)
	return nil
}

func arquivoExiste(p string) bool {
	_, err := os.Stat(p)
	return err == nil
}

func pausaFinal() {
	fmt.Print("pressione Enter para sair... ")
	bufio.NewReader(os.Stdin).ReadString('\n')
}
