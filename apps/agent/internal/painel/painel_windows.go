//go:build windows

// Package painel expõe a central local do agente. A interface usa o navegador
// já instalado no Windows, evitando uma segunda implementação frágil de loop
// gráfico dentro do executável.
package painel

import (
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"sync"
	"unsafe"

	"golang.org/x/sys/windows"
)

var (
	shell32      = windows.NewLazySystemDLL("shell32.dll")
	shellExecute = shell32.NewProc("ShellExecuteW")
)

type central struct {
	acoes   Acoes
	mu      sync.Mutex
	ocupado bool
}

type resposta struct {
	OK       bool   `json:"ok"`
	Mensagem string `json:"mensagem"`
}

// Rodar inicia um servidor restrito ao próprio computador e abre a Central no
// navegador padrão. Nenhuma porta fica exposta à rede da escola.
func Rodar(acoes Acoes) error {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return fmt.Errorf("abrindo central local: %w", err)
	}
	c := &central{acoes: acoes}
	mux := http.NewServeMux()
	mux.HandleFunc("/", c.inicio)
	mux.HandleFunc("/api/testar", c.comAcao(acoes.Testar))
	mux.HandleFunc("/api/diagnostico", c.comAcao(acoes.GerarDiagnostico))
	mux.HandleFunc("/api/iniciar", c.simples(acoes.IniciarServico, "Serviço iniciado."))
	mux.HandleFunc("/api/parar", c.simples(acoes.PararServico, "Serviço parado."))
	mux.HandleFunc("/api/reparar", c.simples(acoes.InstalarServico, "Serviço instalado e iniciado."))
	mux.HandleFunc("/api/configuracao", c.simples(acoes.AbrirConfiguracao, "Configuração aberta."))
	mux.HandleFunc("/api/pasta", c.simples(acoes.AbrirPasta, "Pasta do agente aberta."))

	url := "http://" + listener.Addr().String()
	if err := abrirURL(url); err != nil {
		_ = listener.Close()
		return err
	}
	return http.Serve(listener, mux)
}

func (c *central) inicio(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	_, _ = w.Write([]byte(pagina))
}

func (c *central) simples(acao func() error, sucesso string) http.HandlerFunc {
	return c.comAcao(func() (string, error) {
		if acao == nil {
			return "", fmt.Errorf("ação indisponível")
		}
		if err := acao(); err != nil {
			return "", err
		}
		return sucesso, nil
	})
}

func (c *central) comAcao(acao func() (string, error)) http.HandlerFunc {
	return func(w http.ResponseWriter, _ *http.Request) {
		c.mu.Lock()
		if c.ocupado {
			c.mu.Unlock()
			c.enviar(w, false, "Já existe uma ação em andamento. Aguarde a conclusão.")
			return
		}
		c.ocupado = true
		c.mu.Unlock()
		defer func() {
			c.mu.Lock()
			c.ocupado = false
			c.mu.Unlock()
		}()
		if acao == nil {
			c.enviar(w, false, "Ação indisponível.")
			return
		}
		texto, err := acao()
		if err != nil {
			c.enviar(w, false, err.Error())
			return
		}
		c.enviar(w, true, texto)
	}
}

func (c *central) enviar(w http.ResponseWriter, ok bool, texto string) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	_ = json.NewEncoder(w).Encode(resposta{OK: ok, Mensagem: texto})
}

func abrirURL(url string) error {
	alvo, err := windows.UTF16PtrFromString(url)
	if err != nil {
		return err
	}
	operacao, _ := windows.UTF16PtrFromString("open")
	ret, _, chamadaErr := shellExecute.Call(0, uintptr(unsafe.Pointer(operacao)), uintptr(unsafe.Pointer(alvo)), 0, 0, 1)
	if ret <= 32 {
		if chamadaErr != nil && chamadaErr != windows.ERROR_SUCCESS {
			return chamadaErr
		}
		return fmt.Errorf("o Windows não conseguiu abrir a Central do Agente (código %d)", ret)
	}
	return nil
}

const pagina = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Conecta Notifica — Agente</title><style>body{margin:0;background:#f4f7fb;color:#122033;font:16px Segoe UI,Arial,sans-serif}.box{max-width:880px;margin:42px auto;padding:0 24px}h1{margin:0;font-size:28px}h2{font-size:14px;margin:28px 0 10px;color:#496079;letter-spacing:.06em}.sub{color:#60738a;margin-top:7px}.status{min-height:105px;white-space:pre-wrap;line-height:1.45;background:#fff;border:1px solid #dce4ef;border-radius:10px;padding:18px;box-shadow:0 2px 8px #17253a0d}.acoes{display:flex;gap:10px;flex-wrap:wrap}button{font:inherit;background:#0b67c2;color:#fff;border:0;border-radius:8px;padding:12px 16px;cursor:pointer}button.sec{background:#536579}button:hover{filter:brightness(.94)}button:disabled{opacity:.58;cursor:wait}.rodape{margin-top:34px;color:#60738a;font-size:13px}</style></head><body><main class="box"><h1>Conecta Notifica — Agente</h1><p class="sub">Integração da catraca com o painel da escola</p><h2>STATUS</h2><div id="status" class="status">Pronto. Escolha uma ação abaixo.</div><h2>OPERAÇÃO</h2><div class="acoes"><button data-api="testar">Testar conexões</button><button data-api="iniciar" class="sec">Iniciar serviço</button><button data-api="parar" class="sec">Parar serviço</button><button data-api="reparar" class="sec">Instalar/Reparar serviço</button></div><h2>CONFIGURAÇÃO E SUPORTE</h2><div class="acoes"><button data-api="configuracao" class="sec">Abrir configuração</button><button data-api="diagnostico" class="sec">Gerar diagnóstico seguro</button><button data-api="pasta" class="sec">Abrir pasta do agente</button></div><p class="rodape">Esta central é local e só funciona neste computador. Fechar esta aba não interrompe o serviço do agente.</p></main><script>const s=document.querySelector('#status'),bs=[...document.querySelectorAll('button')];for(const b of bs)b.onclick=async()=>{bs.forEach(x=>x.disabled=true);s.textContent='Executando '+b.textContent+'…';try{const r=await fetch('/api/'+b.dataset.api,{method:'POST'}),j=await r.json();s.textContent=(j.ok?'CONCLUÍDO\n':'NÃO CONCLUÍDO\n')+j.mensagem}catch(e){s.textContent='NÃO CONCLUÍDO\nNão foi possível falar com a central local: '+e}finally{bs.forEach(x=>x.disabled=false)}};</script></body></html>`
