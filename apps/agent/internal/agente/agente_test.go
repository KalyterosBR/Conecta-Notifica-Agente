package agente

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"github.com/conecta/notifica-agent/internal/api"
	"github.com/conecta/notifica-agent/internal/config"
	"github.com/conecta/notifica-agent/internal/fila"
	"github.com/conecta/notifica-agent/internal/modelo"
)

// montar cria um agente sem banco (só o caminho de envio) apontando para um
// SaaS falso.
func montar(t *testing.T, srv *httptest.Server) (*Agente, *fila.Fila) {
	t.Helper()
	dir := t.TempDir()
	yaml := `
escola: {nome: Teste, timezone: America/Sao_Paulo}
banco: {servidor: x, database: y, usuario: z}
saas: {base_url: "` + srv.URL + `", api_key: chave, lote_max: 2}
direcao: {modo: fixo, padrao: in}
`
	cfgFn := dir + "/config.yaml"
	if err := os.WriteFile(cfgFn, []byte(yaml), 0o644); err != nil {
		t.Fatal(err)
	}
	cfg, err := config.Carregar(cfgFn)
	if err != nil {
		t.Fatal(err)
	}
	f, err := fila.Abrir(dir + "/dados")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { f.Fechar() })
	v, err := fila.AbrirVistos(dir+"/dados", time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { v.Fechar() })

	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	return Novo(cfg, log, nil, f, v, api.Novo(cfg, "teste")), f
}

func evento(id string) modelo.Evento {
	return modelo.Evento{IDExterno: id, Direcao: "in", OcorridoEm: time.Now()}
}

func TestDrenarEnviaEmLotesEEsvaziaFila(t *testing.T) {
	var lotes [][]string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := r.Header.Get("Authorization"); got != "Bearer chave" {
			t.Errorf("Authorization = %q", got)
		}
		if r.Header.Get("Idempotency-Key") == "" {
			t.Error("faltou Idempotency-Key")
		}
		var corpo struct {
			Eventos []modelo.Evento `json:"events"`
		}
		json.NewDecoder(r.Body).Decode(&corpo)
		ids := make([]string, len(corpo.Eventos))
		for i, e := range corpo.Eventos {
			ids[i] = e.IDExterno
		}
		lotes = append(lotes, ids)
		json.NewEncoder(w).Encode(modelo.RespostaLote{Aceitos: len(ids)})
	}))
	defer srv.Close()

	a, f := montar(t, srv)
	f.Enfileirar([]modelo.Evento{evento("a"), evento("b"), evento("c")}, "10")

	if err := a.Drenar(context.Background()); err != nil {
		t.Fatal(err)
	}
	if len(lotes) != 2 {
		t.Fatalf("lotes = %v", lotes)
	}
	if len(lotes[0]) != 2 || len(lotes[1]) != 1 {
		t.Fatalf("tamanho dos lotes = %v", lotes)
	}
	if f.Pendentes() != 0 {
		t.Fatalf("pendentes = %d", f.Pendentes())
	}
}

func TestDrenarMantemNaFilaQuandoSaaSCai(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadGateway)
	}))
	defer srv.Close()

	a, f := montar(t, srv)
	f.Enfileirar([]modelo.Evento{evento("a")}, "10")

	if err := a.Drenar(context.Background()); err == nil {
		t.Fatal("queria erro no 502")
	}
	if f.Pendentes() != 1 {
		t.Fatalf("evento sumiu da fila: pendentes = %d", f.Pendentes())
	}
}

func TestDrenarDescartaLoteRejeitadoEmDefinitivo(t *testing.T) {
	chamadas := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		chamadas++
		w.WriteHeader(http.StatusUnprocessableEntity)
	}))
	defer srv.Close()

	a, f := montar(t, srv)
	f.Enfileirar([]modelo.Evento{evento("ruim")}, "10")

	if err := a.Drenar(context.Background()); err != nil {
		t.Fatal(err)
	}
	if f.Pendentes() != 0 {
		t.Fatalf("lote envenenado travou a fila: pendentes = %d", f.Pendentes())
	}
	if chamadas != 1 {
		t.Fatalf("chamadas = %d", chamadas)
	}
}

func TestConverterDeduplicaMarcacaoRepetida(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
	defer srv.Close()
	a, _ := montar(t, srv)

	m := modelo.Marcacao{
		Inners: "1", Complemento: "0", Cartao: "123",
		DataHora: time.Now().Format("060102150405"), CodigoPessoa: "9", CodigoLocal: "1",
	}
	if got := a.converter([]modelo.Marcacao{m, m}); len(got) != 1 {
		t.Fatalf("converteu %d eventos, queria 1", len(got))
	}
	if got := a.converter([]modelo.Marcacao{m}); len(got) != 0 {
		t.Fatalf("reconverteu marcação já vista")
	}
}
