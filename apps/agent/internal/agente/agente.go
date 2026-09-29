// Package agente amarra as peças: lê o SQL Server, enfileira em disco, drena
// para o SaaS, sincroniza alunos e manda heartbeat.
package agente

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"sync"
	"time"

	"github.com/conecta/notifica-agent/internal/api"
	"github.com/conecta/notifica-agent/internal/banco"
	"github.com/conecta/notifica-agent/internal/config"
	"github.com/conecta/notifica-agent/internal/direcao"
	"github.com/conecta/notifica-agent/internal/estado"
	"github.com/conecta/notifica-agent/internal/fila"
	"github.com/conecta/notifica-agent/internal/modelo"
)

type Agente struct {
	cfg    *config.Config
	log    *slog.Logger
	repo   *banco.Repo
	fila   *fila.Fila
	vistos *fila.Vistos
	api    *api.Cliente
	mapa   *direcao.Mapeador

	mu           sync.Mutex
	bancoOK      bool
	saasOK       bool
	ultimoErro   string
	enviadosHoje int64
	diaContagem  string
	ultimaLeitura time.Time
	ultimoEnvio   time.Time
}

func Novo(cfg *config.Config, log *slog.Logger, repo *banco.Repo, f *fila.Fila, v *fila.Vistos, cli *api.Cliente) *Agente {
	return &Agente{
		cfg:    cfg,
		log:    log,
		repo:   repo,
		fila:   f,
		vistos: v,
		api:    cli,
		mapa:   direcao.Novo(cfg),
	}
}

// Rodar sobe os laços e só volta quando o contexto é cancelado.
func (a *Agente) Rodar(ctx context.Context) error {
	if err := a.posicionarCursor(ctx); err != nil {
		return err
	}
	modo := a.repo.ModoCursor(ctx)
	a.log.Info("agente iniciado",
		"escola", a.cfg.Escola.Nome,
		"cursor_modo", modo,
		"cursor", a.fila.Cursor(),
		"pendentes", a.fila.Pendentes())

	var wg sync.WaitGroup
	laco := func(nome string, intervalo time.Duration, fn func(context.Context) error) {
		wg.Add(1)
		go func() {
			defer wg.Done()
			t := time.NewTicker(intervalo)
			defer t.Stop()
			for {
				if err := fn(ctx); err != nil && !errors.Is(err, context.Canceled) {
					a.registrarErro(nome, err)
				}
				select {
				case <-ctx.Done():
					return
				case <-t.C:
				}
			}
		}()
	}

	laco("coleta", time.Duration(a.cfg.Coleta.IntervaloSegundos)*time.Second, a.Coletar)
	laco("envio", time.Duration(a.cfg.SaaS.EnvioSegundos)*time.Second, a.Drenar)
	laco("heartbeat", time.Duration(a.cfg.SaaS.HeartbeatSegundos)*time.Second, a.baterCoracao)

	if modo == "datahora" && a.cfg.Coleta.VarreduraMinutos > 0 {
		laco("varredura", time.Duration(a.cfg.Coleta.VarreduraMinutos)*time.Minute, a.Varrer)
	}
	if a.cfg.Consultas.SincronizarAlunos {
		laco("alunos", time.Duration(a.cfg.Consultas.IntervaloAlunosMinuto)*time.Minute, a.SincronizarAlunos)
	}

	<-ctx.Done()
	wg.Wait()
	a.log.Info("agente encerrado")
	return nil
}

// posicionarCursor define de onde começar quando não há estado salvo.
func (a *Agente) posicionarCursor(ctx context.Context) error {
	if a.fila.Cursor() != "" {
		return nil
	}
	modo := a.repo.ModoCursor(ctx)
	inicio := a.cfg.Coleta.InicioEm

	var cursor string
	switch {
	case inicio == "tudo":
		if modo == "codigo" {
			cursor = "0"
		} else {
			cursor = "000000000000"
		}
	case inicio == "agora":
		if modo == "codigo" {
			c, err := a.repo.MaiorCodigo(ctx)
			if err != nil {
				return fmt.Errorf("posicionando cursor: %w", err)
			}
			cursor = c
		} else {
			cursor = time.Now().In(a.cfg.Escola.Local()).Format(a.cfg.Coleta.FormatoDataHora)
		}
	default:
		t, err := time.ParseInLocation(time.RFC3339, inicio, a.cfg.Escola.Local())
		if err != nil {
			t, err = time.ParseInLocation("2006-01-02", inicio, a.cfg.Escola.Local())
			if err != nil {
				return fmt.Errorf("coleta.inicio_em inválido: %q", inicio)
			}
		}
		dh := t.Format(a.cfg.Coleta.FormatoDataHora)
		if modo == "codigo" {
			c, err := a.repo.CodigoDesde(ctx, dh)
			if err != nil {
				return fmt.Errorf("posicionando cursor: %w", err)
			}
			cursor = c
		} else {
			cursor = dh
		}
	}
	a.log.Info("cursor inicial definido", "modo", modo, "cursor", cursor, "inicio_em", inicio)
	return a.fila.DefinirCursor(cursor)
}

// Coletar lê as marcações novas em páginas até esvaziar a fonte.
func (a *Agente) Coletar(ctx context.Context) error {
	modo := a.repo.ModoCursor(ctx)
	limite := a.cfg.Coleta.LimitePorCiclo

	for pagina := 0; pagina < 50; pagina++ {
		cursor := a.fila.Cursor()
		linhas, err := a.repo.BuscarMarcacoes(ctx, cursor, limite)
		if err != nil {
			a.definirBanco(false, err)
			return err
		}
		a.definirBanco(true, nil)
		a.marcarLeitura()
		if len(linhas) == 0 {
			return nil
		}

		cheia := len(linhas) == limite
		if cheia && modo == "datahora" {
			// Numa página cheia, a última DataHora pode ter mais linhas além
			// do corte. Recuamos o último grupo para não pular ninguém.
			linhas = recuarUltimoGrupo(linhas)
			if len(linhas) == 0 {
				a.log.Warn("página inteira com a mesma DataHora, aumente coleta.limite_por_ciclo",
					"limite", limite)
				return nil
			}
		}

		evs := a.converter(linhas)
		novo := cursorDe(linhas[len(linhas)-1], modo)
		if err := a.fila.Enfileirar(evs, novo); err != nil {
			return err
		}
		if len(evs) > 0 {
			a.log.Info("marcações coletadas", "lidas", len(linhas), "enfileiradas", len(evs), "cursor", novo)
		}
		if !cheia {
			return nil
		}
	}
	return nil
}

// Varrer relê uma janela recente procurando marcações que entraram com
// DataHora anterior ao cursor — o caso do equipamento que ficou offline e
// descarregou depois. Só faz sentido no cursor por DataHora.
func (a *Agente) Varrer(ctx context.Context) error {
	desde := time.Now().In(a.cfg.Escola.Local()).
		Add(-time.Duration(a.cfg.Coleta.VarreduraHoras) * time.Hour).
		Format(a.cfg.Coleta.FormatoDataHora)

	cursor := desde
	atrasadas := 0
	for pagina := 0; pagina < 50; pagina++ {
		linhas, err := a.repo.BuscarMarcacoes(ctx, cursor, a.cfg.Coleta.LimitePorCiclo)
		if err != nil {
			a.definirBanco(false, err)
			return err
		}
		if len(linhas) == 0 {
			break
		}
		var novas []modelo.Marcacao
		for _, m := range linhas {
			if !a.vistos.Conhece(m.ChaveNatural()) {
				novas = append(novas, m)
			}
		}
		if len(novas) > 0 {
			evs := a.converter(novas)
			if err := a.fila.Enfileirar(evs, ""); err != nil {
				return err
			}
			atrasadas += len(evs)
		}
		cursor = linhas[len(linhas)-1].DataHora
		if len(linhas) < a.cfg.Coleta.LimitePorCiclo {
			break
		}
	}
	if atrasadas > 0 {
		a.log.Info("marcações atrasadas recuperadas na varredura", "quantidade", atrasadas)
	}
	return a.vistos.Compactar()
}

// converter aplica o mapeamento e o dedupe local.
func (a *Agente) converter(linhas []modelo.Marcacao) []modelo.Evento {
	evs := make([]modelo.Evento, 0, len(linhas))
	for _, m := range linhas {
		e, err := a.mapa.Mapear(m)
		if err != nil {
			if !errors.Is(err, direcao.ErrIgnorada) {
				a.log.Warn("marcação descartada", "chave", m.ChaveNatural(), "motivo", err)
			}
			// Marca como vista para a varredura não tentar de novo toda hora.
			a.vistos.Marcar(m.ChaveNatural())
			continue
		}
		if !a.vistos.Marcar(e.IDExterno) {
			continue
		}
		evs = append(evs, e)
	}
	return evs
}

// Drenar envia o que está na fila local, um lote por vez.
func (a *Agente) Drenar(ctx context.Context) error {
	for i := 0; i < 20; i++ {
		evs, bytes, err := a.fila.Espiar(a.cfg.SaaS.LoteMax)
		if err != nil {
			return err
		}
		if len(evs) == 0 {
			return nil
		}
		resp, err := a.api.EnviarEventos(ctx, evs)
		if err != nil {
			var he *api.ErroHTTP
			if errors.As(err, &he) {
				if he.Permanente() {
					a.log.Error("lote rejeitado em definitivo, descartando",
						"status", he.Status, "corpo", he.Corpo, "eventos", len(evs))
					return a.fila.Confirmar(bytes, len(evs))
				}
				if he.Autenticacao() {
					a.log.Error("API key rejeitada pelo SaaS, lote mantido na fila", "status", he.Status)
				}
			}
			return err
		}
		if err := a.fila.Confirmar(bytes, len(evs)); err != nil {
			return err
		}
		a.contarEnvio(int64(len(evs)))
		a.marcarEnvio()
		a.log.Info("lote enviado",
			"eventos", len(evs), "aceitos", resp.Aceitos, "duplicados", resp.Duplicados,
			"pendentes", a.fila.Pendentes())
	}
	return nil
}

func (a *Agente) SincronizarAlunos(ctx context.Context) error {
	tentativa := time.Now()
	a.gravarStatusSincronizacao(estado.Sincronizacao{TentativaEm: tentativa, Mensagem: "Sincronização em andamento."})
	alunos, err := a.repo.BuscarAlunos(ctx)
	if err != nil {
		a.definirBanco(false, err)
		a.gravarStatusSincronizacao(estado.Sincronizacao{TentativaEm: tentativa, ConcluidaEm: time.Now(), Mensagem: "Falha ao consultar cadastros."})
		return err
	}
	if len(alunos) == 0 {
		a.gravarStatusSincronizacao(estado.Sincronizacao{TentativaEm: tentativa, ConcluidaEm: time.Now(), Sucesso: true, Mensagem: "Consulta concluída; nenhum cadastro para enviar."})
		return nil
	}
	if err := a.api.SincronizarAlunos(ctx, alunos, true); err != nil {
		a.gravarStatusSincronizacao(estado.Sincronizacao{TentativaEm: tentativa, ConcluidaEm: time.Now(), Quantidade: len(alunos), Mensagem: "Falha ao enviar cadastros ao painel."})
		return err
	}
	a.gravarStatusSincronizacao(estado.Sincronizacao{TentativaEm: tentativa, ConcluidaEm: time.Now(), Quantidade: len(alunos), Sucesso: true, Mensagem: "Cadastros enviados ao painel."})
	a.log.Info("alunos sincronizados", "quantidade", len(alunos))
	return nil
}

func (a *Agente) baterCoracao(ctx context.Context) error {
	est := a.fila.Estado()
	pendentes := a.fila.Pendentes()
	a.mu.Lock()
	hb := modelo.Heartbeat{
		Cursor:       est.Cursor,
		Pendentes:    pendentes,
		BancoOK:      a.bancoOK,
		UltimoErro:   a.ultimoErro,
		EnviadosHoje: a.enviadosHoje,
	}
	a.mu.Unlock()
	if est.UltimoEvento != "" {
		if t, err := time.Parse(time.RFC3339, est.UltimoEvento); err == nil {
			hb.UltimoEventoEm = t
		}
	}

	err := a.api.Heartbeat(ctx, hb)
	a.mu.Lock()
	a.saasOK = err == nil
	a.mu.Unlock()
	// O estado é publicado depois do heartbeat porque é aqui que se sabe se o
	// SaaS respondeu. Falhar em gravá-lo nunca derruba o laço: é só a tela.
	a.publicarEstado(hb, est.UltimoEvento)
	return err
}

// publicarEstado grava o arquivo que o ícone ao lado do relógio lê.
func (a *Agente) publicarEstado(hb modelo.Heartbeat, ultimoEvento string) {
	if a.cfg.Armazenamento.Diretorio == "" {
		return
	}
	caminho := estado.Caminho(a.cfg.Armazenamento.Diretorio)
	anterior, _ := estado.Ler(caminho)
	a.mu.Lock()
	ultimaLeitura, ultimoEnvio := a.ultimaLeitura, a.ultimoEnvio
	if ultimaLeitura.IsZero() {
		ultimaLeitura = anterior.UltimaLeitura
	}
	if ultimoEnvio.IsZero() {
		ultimoEnvio = anterior.UltimoEnvio
	}
	e := estado.Estado{
		Escola:       a.cfg.Escola.Nome,
		BancoOK:      a.bancoOK,
		SaaSOK:       a.saasOK,
		Pendentes:    hb.Pendentes,
		EnviadosHoje: a.enviadosHoje,
		UltimoEvento: ultimoEvento,
		UltimoErro:   a.ultimoErro,
		UltimaLeitura: ultimaLeitura,
		UltimoEnvio: ultimoEnvio,
		SincronizacaoHabilitada: a.cfg.Consultas.SincronizarAlunos,
		ConsultaAlunosConfigurada: strings.TrimSpace(a.cfg.Consultas.Alunos) != "",
		IntervaloAlunosMinutos: a.cfg.Consultas.IntervaloAlunosMinuto,
	}
	a.mu.Unlock()
	if err := estado.Gravar(caminho, e); err != nil {
		a.log.Debug("não consegui publicar o estado", "erro", err)
	}
}

func (a *Agente) marcarLeitura() {
	a.mu.Lock()
	a.ultimaLeitura = time.Now()
	a.mu.Unlock()
}

func (a *Agente) marcarEnvio() {
	a.mu.Lock()
	a.ultimoEnvio = time.Now()
	a.mu.Unlock()
}

func (a *Agente) gravarStatusSincronizacao(s estado.Sincronizacao) {
	if a.cfg.Armazenamento.Diretorio == "" {
		return
	}
	if err := estado.GravarSincronizacao(estado.CaminhoSincronizacao(a.cfg.Armazenamento.Diretorio), s); err != nil {
		a.log.Debug("não consegui guardar o estado da sincronização de alunos", "erro", err)
	}
}

func (a *Agente) definirBanco(ok bool, err error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.bancoOK = ok
	if err != nil {
		a.ultimoErro = err.Error()
	}
}

func (a *Agente) registrarErro(laco string, err error) {
	a.log.Error("falha no laço", "laco", laco, "erro", err)
	a.mu.Lock()
	a.ultimoErro = laco + ": " + err.Error()
	a.mu.Unlock()
}

func (a *Agente) contarEnvio(n int64) {
	hoje := time.Now().In(a.cfg.Escola.Local()).Format("2006-01-02")
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.diaContagem != hoje {
		a.diaContagem = hoje
		a.enviadosHoje = 0
	}
	a.enviadosHoje += n
}

func cursorDe(m modelo.Marcacao, modo string) string {
	if modo == "codigo" {
		return m.Codigo
	}
	return m.DataHora
}

// recuarUltimoGrupo corta as linhas finais que compartilham a mesma DataHora.
func recuarUltimoGrupo(linhas []modelo.Marcacao) []modelo.Marcacao {
	ultima := linhas[len(linhas)-1].DataHora
	i := len(linhas) - 1
	for i >= 0 && linhas[i].DataHora == ultima {
		i--
	}
	return linhas[:i+1]
}
