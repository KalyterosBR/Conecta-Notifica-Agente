//go:build windows

// Package painel contém uma central Win32 pequena, sem CGO e sem dependências
// visuais externas. O agente continua sendo um único executável para facilitar
// a instalação em máquinas de escola.
package painel

import (
	"sync"
	"syscall"
	"unsafe"

	"golang.org/x/sys/windows"
)

const (
	classeJanela = "ConectaNotificaPainel"
	titulo       = "Conecta Notifica — Agente"

	wsOverlappedWindow = 0x00CF0000
	wsVisible          = 0x10000000
	wsChild            = 0x40000000
	wsTabStop          = 0x00010000
	wsBorder           = 0x00800000
	ssLeft             = 0x00000000
	ssNotify           = 0x00000100
	bsPushButton       = 0x00000000

	wmDestroy = 0x0002
	wmCommand = 0x0111
	wmTimer   = 0x0113

	mbOK              = 0x00000000
	mbIconInformation = 0x00000040
	mbIconError       = 0x00000010

	idTestar      = 1001
	idIniciar     = 1002
	idParar       = 1003
	idInstalar    = 1004
	idConfig      = 1005
	idDiagnostico = 1006
	idPasta       = 1007
	idTimer       = 1
)

var (
	user32   = windows.NewLazySystemDLL("user32.dll")
	kernel32 = windows.NewLazySystemDLL("kernel32.dll")

	procRegisterClassEx = user32.NewProc("RegisterClassExW")
	procCreateWindowEx  = user32.NewProc("CreateWindowExW")
	procDefWindowProc   = user32.NewProc("DefWindowProcW")
	procGetMessage      = user32.NewProc("GetMessageW")
	procTranslateMsg    = user32.NewProc("TranslateMessage")
	procDispatchMessage = user32.NewProc("DispatchMessageW")
	procPostQuitMessage = user32.NewProc("PostQuitMessage")
	procSetWindowText   = user32.NewProc("SetWindowTextW")
	procMessageBox      = user32.NewProc("MessageBoxW")
	procSetTimer        = user32.NewProc("SetTimer")
	procGetDpiForSystem = user32.NewProc("GetDpiForSystem")

	procGetModuleHandle = kernel32.NewProc("GetModuleHandleW")
)

type ponto struct{ X, Y int32 }

type mensagem struct {
	Hwnd    windows.HWND
	Message uint32
	WParam  uintptr
	LParam  uintptr
	Time    uint32
	Pt      ponto
}

type wndClassEx struct {
	Size       uint32
	Style      uint32
	WndProc    uintptr
	ClsExtra   int32
	WndExtra   int32
	Instance   windows.Handle
	Icon       windows.Handle
	Cursor     windows.Handle
	Background windows.Handle
	MenuName   *uint16
	ClassName  *uint16
	IconSm     windows.Handle
}

type janela struct {
	hwnd   windows.HWND
	status windows.HWND
	acoes  Acoes
	dpi    int

	mu        sync.Mutex
	ocupado   bool
	tituloJob string
	resultado string
	erro      error
	concluido bool
}

var atual *janela

// Rodar abre a central de operação. Nenhuma ação é disparada automaticamente:
// iniciar, parar, testar e abrir arquivos sempre exigem um clique explícito.
func Rodar(acoes Acoes) error {
	atual = &janela{acoes: acoes, dpi: dpiSistema()}
	instancia, _, _ := procGetModuleHandle.Call(0)
	nomeClasse, err := windows.UTF16PtrFromString(classeJanela)
	if err != nil {
		return err
	}
	wc := wndClassEx{
		Size: uint32(unsafe.Sizeof(wndClassEx{})), WndProc: syscall.NewCallback(wndProc),
		Instance: windows.Handle(instancia), ClassName: nomeClasse,
	}
	if ret, _, err := procRegisterClassEx.Call(uintptr(unsafe.Pointer(&wc))); ret == 0 {
		return err
	}
	nome, _ := windows.UTF16PtrFromString(titulo)
	hwnd, _, err := procCreateWindowEx.Call(0, uintptr(unsafe.Pointer(nomeClasse)), uintptr(unsafe.Pointer(nome)),
		wsOverlappedWindow|wsVisible, 0x80000000, 0x80000000, uintptr(atual.px(860)), uintptr(atual.px(585)), 0, 0, instancia, 0)
	if hwnd == 0 {
		return err
	}
	atual.hwnd = windows.HWND(hwnd)
	atual.criarControles()
	atual.atualizar()
	procSetTimer.Call(hwnd, idTimer, 5000, 0)

	var msg mensagem
	for {
		ret, _, _ := procGetMessage.Call(uintptr(unsafe.Pointer(&msg)), 0, 0, 0)
		if int32(ret) <= 0 {
			return nil
		}
		procTranslateMsg.Call(uintptr(unsafe.Pointer(&msg)))
		procDispatchMessage.Call(uintptr(unsafe.Pointer(&msg)))
	}
}

func (j *janela) criarControles() {
	j.texto("STATIC", "Conecta Notifica — Agente", 32, 26, 760, 30, ssLeft)
	j.texto("STATIC", "Integração da catraca com o painel da escola", 32, 61, 760, 24, ssLeft)
	j.texto("STATIC", "STATUS DO AGENTE", 32, 108, 760, 20, ssLeft)
	j.status = j.texto("STATIC", "Carregando…", 32, 136, 760, 108, ssLeft|ssNotify|wsBorder)
	j.botao("Testar conexões", idTestar, 32, 270, 220, 38)
	j.botao("Iniciar serviço", idIniciar, 270, 270, 150, 38)
	j.botao("Parar", idParar, 436, 270, 100, 38)
	j.botao("Instalar/Reparar serviço", idInstalar, 552, 270, 240, 38)
	j.texto("STATIC", "CONFIGURAÇÃO E SUPORTE", 32, 342, 760, 20, ssLeft)
	j.botao("Abrir configuração", idConfig, 32, 370, 220, 38)
	j.botao("Gerar diagnóstico seguro", idDiagnostico, 270, 370, 220, 38)
	j.botao("Abrir pasta do agente", idPasta, 508, 370, 284, 38)
	j.texto("STATIC", "O agente continua enviando normalmente mesmo quando esta janela está fechada.", 32, 476, 760, 20, ssLeft)
}

func (j *janela) texto(classe, texto string, x, y, largura, altura int, estilo uintptr) windows.HWND {
	return j.controle(classe, texto, estilo, x, y, largura, altura, 0)
}

func (j *janela) botao(texto string, id, x, y, largura, altura int) {
	j.controle("BUTTON", texto, bsPushButton|wsTabStop, x, y, largura, altura, uintptr(id))
}

func (j *janela) controle(classe, texto string, estilo uintptr, x, y, largura, altura int, id uintptr) windows.HWND {
	c, _ := windows.UTF16PtrFromString(classe)
	t, _ := windows.UTF16PtrFromString(texto)
	h, _, _ := procCreateWindowEx.Call(0, uintptr(unsafe.Pointer(c)), uintptr(unsafe.Pointer(t)),
		wsChild|wsVisible|estilo, uintptr(j.px(x)), uintptr(j.px(y)), uintptr(j.px(largura)), uintptr(j.px(altura)), uintptr(j.hwnd), id, 0, 0)
	return windows.HWND(h)
}

func dpiSistema() int {
	dpi, _, _ := procGetDpiForSystem.Call()
	if dpi == 0 {
		return 96
	}
	return int(dpi)
}

func (j *janela) px(valor int) int {
	return (valor*j.dpi + 48) / 96
}

func wndProc(hwnd, msg, wparam, lparam uintptr) uintptr {
	if atual == nil {
		ret, _, _ := procDefWindowProc.Call(hwnd, msg, wparam, lparam)
		return ret
	}
	switch uint32(msg) {
	case wmTimer:
		atual.atualizar()
		return 0
	case wmCommand:
		switch uint16(wparam) {
		case idTestar:
			atual.executar("Teste de conexões", atual.acoes.Testar)
		case idIniciar:
			atual.executarSimples("Serviço iniciado", atual.acoes.IniciarServico)
		case idParar:
			atual.executarSimples("Serviço parado", atual.acoes.PararServico)
		case idInstalar:
			atual.executarSimples("Serviço instalado e iniciado", atual.acoes.InstalarServico)
		case idConfig:
			atual.executarSimples("Configuração aberta", atual.acoes.AbrirConfiguracao)
		case idDiagnostico:
			atual.executar("Diagnóstico", atual.acoes.GerarDiagnostico)
		case idPasta:
			atual.executarSimples("Pasta do agente aberta", atual.acoes.AbrirPasta)
		}
		return 0
	case wmDestroy:
		procPostQuitMessage.Call(0)
		return 0
	}
	ret, _, _ := procDefWindowProc.Call(hwnd, msg, wparam, lparam)
	return ret
}

func (j *janela) atualizar() {
	j.mostrarConclusao()
	if titulo, ocupado := j.jobEmAndamento(); ocupado {
		j.definirStatus("Executando " + titulo + "… Aguarde; a janela continuará disponível.")
		return
	}
	resumo := "Não foi possível ler o estado do agente. Use Testar conexões para o detalhe."
	if j.acoes.Resumo != nil {
		resumo = j.acoes.Resumo()
	}
	j.definirStatus(resumo)
}

func (j *janela) executar(titulo string, acao func() (string, error)) {
	if acao == nil {
		return
	}
	if !j.iniciarJob(titulo) {
		j.alerta("Ação em andamento", "Aguarde a conclusão de "+j.tituloAtual()+" antes de iniciar outra ação.", false)
		return
	}
	j.definirStatus("Executando " + titulo + "… Aguarde; a janela continuará disponível.")
	go func() {
		mensagem, err := acao()
		j.finalizarJob(mensagem, err)
	}()
}

func (j *janela) executarSimples(sucesso string, acao func() error) {
	if acao == nil {
		return
	}
	j.executar(sucesso, func() (string, error) {
		return sucesso, acao()
	})
}

func (j *janela) iniciarJob(titulo string) bool {
	j.mu.Lock()
	defer j.mu.Unlock()
	if j.ocupado {
		return false
	}
	j.ocupado = true
	j.tituloJob = titulo
	j.resultado = ""
	j.erro = nil
	j.concluido = false
	return true
}

func (j *janela) finalizarJob(resultado string, err error) {
	j.mu.Lock()
	defer j.mu.Unlock()
	j.resultado = resultado
	j.erro = err
	j.concluido = true
}

func (j *janela) jobEmAndamento() (string, bool) {
	j.mu.Lock()
	defer j.mu.Unlock()
	return j.tituloJob, j.ocupado
}

func (j *janela) tituloAtual() string {
	j.mu.Lock()
	defer j.mu.Unlock()
	return j.tituloJob
}

// mostrarConclusao é chamado pela thread da janela através do timer. A
// goroutine da operação nunca chama APIs visuais, evitando congelamento e
// problemas de afinidade de thread no Win32.
func (j *janela) mostrarConclusao() bool {
	j.mu.Lock()
	if !j.concluido {
		j.mu.Unlock()
		return false
	}
	titulo, resultado, err := j.tituloJob, j.resultado, j.erro
	j.ocupado = false
	j.concluido = false
	j.mu.Unlock()

	if err != nil {
		j.alerta(titulo, "Não foi possível concluir:\n\n"+err.Error(), true)
	} else {
		j.alerta(titulo, resultado, false)
	}
	return true
}

func (j *janela) definirStatus(texto string) {
	p, err := windows.UTF16PtrFromString(texto)
	if err == nil {
		procSetWindowText.Call(uintptr(j.status), uintptr(unsafe.Pointer(p)))
	}
}

func (j *janela) alerta(cabecalho, texto string, erro bool) {
	t, _ := windows.UTF16PtrFromString(texto)
	c, _ := windows.UTF16PtrFromString(cabecalho)
	icone := uintptr(mbIconInformation)
	if erro {
		icone = mbIconError
	}
	procMessageBox.Call(uintptr(j.hwnd), uintptr(unsafe.Pointer(t)), uintptr(unsafe.Pointer(c)), mbOK|icone)
}
