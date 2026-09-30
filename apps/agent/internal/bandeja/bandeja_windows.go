//go:build windows

// Package bandeja mostra o ícone de status ao lado do relógio do Windows.
//
// Roda na sessão do usuário, separado do serviço: o serviço vive na sessão 0
// e não pode desenhar nada na área de notificação. A ponte entre os dois é o
// arquivo de estado que o serviço publica a cada heartbeat.
package bandeja

import (
	"syscall"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"

	"github.com/conecta/notifica-agent/internal/estado"
)

const (
	classe = "ConectaNotificaBandeja"
	titulo = "Conecta Notifica"

	// Estado mais velho que isto significa serviço parado.
	limiteFrescor = 3 * time.Minute
	// De quanto em quanto relemos o arquivo.
	intervalo = 5 * time.Second

	wmApp        = 0x8000
	wmIconeMsg   = wmApp + 1
	wmDestroy    = 0x0002
	wmCommand    = 0x0111
	wmTimer      = 0x0113
	wmRButtonUp  = 0x0205
	wmLButtonDbl = 0x0203

	nimAdd    = 0x00000000
	nimModify = 0x00000001
	nimDelete = 0x00000002

	nifMessage = 0x00000001
	nifIcon    = 0x00000002
	nifTip     = 0x00000004
	nifInfo    = 0x00000010

	imageIcon      = 1
	lrDefaultSize  = 0x00000040
	lrShared       = 0x00008000
	idiApplication = 32512
	idiWarning     = 32515

	mfString = 0x00000000
	tpmRight = 0x0080

	idPainel = 1001
	idAbrir  = 1002
	idTestar = 1003
	idSair   = 1004
	idTimer  = 1
)

var (
	user32   = windows.NewLazySystemDLL("user32.dll")
	shell32  = windows.NewLazySystemDLL("shell32.dll")
	kernel32 = windows.NewLazySystemDLL("kernel32.dll")

	procRegisterClassEx = user32.NewProc("RegisterClassExW")
	procCreateWindowEx  = user32.NewProc("CreateWindowExW")
	procDefWindowProc   = user32.NewProc("DefWindowProcW")
	procGetMessage      = user32.NewProc("GetMessageW")
	procTranslateMsg    = user32.NewProc("TranslateMessage")
	procDispatchMessage = user32.NewProc("DispatchMessageW")
	procPostQuitMessage = user32.NewProc("PostQuitMessage")
	procDestroyWindow   = user32.NewProc("DestroyWindow")
	procLoadIcon        = user32.NewProc("LoadIconW")
	procLoadImage       = user32.NewProc("LoadImageW")
	procCreatePopupMenu = user32.NewProc("CreatePopupMenu")
	procAppendMenu      = user32.NewProc("AppendMenuW")
	procTrackPopupMenu  = user32.NewProc("TrackPopupMenu")
	procDestroyMenu     = user32.NewProc("DestroyMenu")
	procGetCursorPos    = user32.NewProc("GetCursorPos")
	procSetForeground   = user32.NewProc("SetForegroundWindow")
	procSetTimer        = user32.NewProc("SetTimer")
	procPostMessage     = user32.NewProc("PostMessageW")

	procShellNotifyIcon = shell32.NewProc("Shell_NotifyIconW")
	procShellExecute    = shell32.NewProc("ShellExecuteW")

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

type notifyIconData struct {
	CbSize           uint32
	HWnd             windows.HWND
	UID              uint32
	UFlags           uint32
	UCallbackMessage uint32
	HIcon            windows.Handle
	SzTip            [128]uint16
	DwState          uint32
	DwStateMask      uint32
	SzInfo           [256]uint16
	UVersion         uint32
	SzInfoTitle      [64]uint16
	DwInfoFlags      uint32
	GuidItem         windows.GUID
	HBalloonIcon     windows.Handle
}

type bandeja struct {
	hwnd     windows.HWND
	dados    string
	exe      string
	central  string
	iconeOK  windows.Handle
	iconeErr windows.Handle
	// último resumo mostrado, para não reescrever o tooltip a cada tique
	ultimo string
	ok     bool
}

var b *bandeja

// Rodar mostra o ícone e só volta quando o usuário escolhe Sair.
func Rodar(dirDados, exe, central string) error {
	b = &bandeja{dados: estado.Caminho(dirDados), exe: exe, central: central}

	instancia, _, _ := procGetModuleHandle.Call(0)
	b.iconeOK = carregarIconeDoExe(windows.Handle(instancia))
	b.iconeErr = carregarIconeSistema(idiWarning)
	if b.iconeOK == 0 {
		b.iconeOK = carregarIconeSistema(idiApplication)
	}

	nomeClasse, err := windows.UTF16PtrFromString(classe)
	if err != nil {
		return err
	}
	wc := wndClassEx{
		Style:     0,
		WndProc:   syscall.NewCallback(wndProc),
		Instance:  windows.Handle(instancia),
		ClassName: nomeClasse,
	}
	wc.Size = uint32(unsafe.Sizeof(wc))
	if ret, _, err := procRegisterClassEx.Call(uintptr(unsafe.Pointer(&wc))); ret == 0 {
		return err
	}

	nomeJanela, _ := windows.UTF16PtrFromString(titulo)
	hwnd, _, err := procCreateWindowEx.Call(
		0,
		uintptr(unsafe.Pointer(nomeClasse)),
		uintptr(unsafe.Pointer(nomeJanela)),
		0, 0, 0, 0, 0, 0, 0,
		instancia, 0,
	)
	if hwnd == 0 {
		return err
	}
	b.hwnd = windows.HWND(hwnd)

	if err := b.adicionarIcone(); err != nil {
		return err
	}
	defer b.removerIcone()

	b.atualizar()
	procSetTimer.Call(uintptr(b.hwnd), idTimer, uintptr(intervalo/time.Millisecond), 0)

	var msg mensagem
	for {
		ret, _, _ := procGetMessage.Call(uintptr(unsafe.Pointer(&msg)), 0, 0, 0)
		if int32(ret) <= 0 { // 0 = WM_QUIT, -1 = erro
			return nil
		}
		procTranslateMsg.Call(uintptr(unsafe.Pointer(&msg)))
		procDispatchMessage.Call(uintptr(unsafe.Pointer(&msg)))
	}
}

// Todos os parâmetros são uintptr: é o que syscall.NewCallback aceita sem
// depender de como cada tipo menor é empacotado na pilha.
func wndProc(hwnd, msg, wparam, lparam uintptr) uintptr {
	switch uint32(msg) {
	case wmTimer:
		b.atualizar()
		return 0
	case wmIconeMsg:
		switch uint32(lparam) {
		case wmRButtonUp:
			b.abrirMenu()
		case wmLButtonDbl:
			b.abrirPainel()
		}
		return 0
	case wmCommand:
		switch uint32(wparam) & 0xFFFF {
		case idAbrir:
			b.abrirPasta()
		case idPainel:
			b.abrirPainel()
		case idTestar:
			b.testar()
		case idSair:
			procDestroyWindow.Call(hwnd)
		}
		return 0
	case wmDestroy:
		procPostQuitMessage.Call(0)
		return 0
	}
	ret, _, _ := procDefWindowProc.Call(hwnd, msg, wparam, lparam)
	return ret
}

func (t *bandeja) dadosIcone(flags uint32) notifyIconData {
	d := notifyIconData{
		HWnd:             t.hwnd,
		UID:              1,
		UFlags:           flags,
		UCallbackMessage: wmIconeMsg,
		HIcon:            t.icone(),
	}
	d.CbSize = uint32(unsafe.Sizeof(d))
	copiarUTF16(d.SzTip[:], t.tooltip())
	return d
}

func (t *bandeja) adicionarIcone() error {
	d := t.dadosIcone(nifMessage | nifIcon | nifTip)
	ret, _, err := procShellNotifyIcon.Call(nimAdd, uintptr(unsafe.Pointer(&d)))
	if ret == 0 {
		return err
	}
	return nil
}

func (t *bandeja) removerIcone() {
	d := notifyIconData{HWnd: t.hwnd, UID: 1}
	d.CbSize = uint32(unsafe.Sizeof(d))
	procShellNotifyIcon.Call(nimDelete, uintptr(unsafe.Pointer(&d)))
}

// atualizar relê o arquivo de estado e mexe no ícone só quando mudou.
func (t *bandeja) atualizar() {
	e, err := estado.Ler(t.dados)
	var resumo string
	var ok bool
	if err != nil {
		resumo, ok = "Serviço parado — os giros não estão sendo enviados", false
	} else {
		resumo, ok = e.Resumo(time.Now(), limiteFrescor)
	}
	if resumo == t.ultimo && ok == t.ok {
		return
	}
	t.ultimo, t.ok = resumo, ok
	d := t.dadosIcone(nifIcon | nifTip)
	procShellNotifyIcon.Call(nimModify, uintptr(unsafe.Pointer(&d)))
}

func (t *bandeja) tooltip() string {
	// O tooltip do Windows corta em 127 caracteres.
	s := titulo + "\n" + t.ultimo
	if len([]rune(s)) > 120 {
		s = string([]rune(s)[:120])
	}
	return s
}

func (t *bandeja) icone() windows.Handle {
	if t.ok {
		return t.iconeOK
	}
	return t.iconeErr
}

func (t *bandeja) mostrarBalao() {
	d := t.dadosIcone(nifInfo | nifIcon | nifTip)
	copiarUTF16(d.SzInfoTitle[:], titulo)
	copiarUTF16(d.SzInfo[:], t.ultimo)
	procShellNotifyIcon.Call(nimModify, uintptr(unsafe.Pointer(&d)))
}

func (t *bandeja) abrirMenu() {
	menu, _, _ := procCreatePopupMenu.Call()
	if menu == 0 {
		return
	}
	defer procDestroyMenu.Call(menu)

	adicionar := func(id uintptr, texto string) {
		p, _ := windows.UTF16PtrFromString(texto)
		procAppendMenu.Call(menu, mfString, id, uintptr(unsafe.Pointer(p)))
	}
	adicionar(0, t.ultimo) // a primeira linha é o status, só para ler
	adicionar(idPainel, "Abrir central do agente")
	adicionar(idAbrir, "Abrir a pasta do agente")
	adicionar(idTestar, "Testar conexões")
	adicionar(idSair, "Sair")

	var p ponto
	procGetCursorPos.Call(uintptr(unsafe.Pointer(&p)))
	// Sem SetForegroundWindow o menu fica preso na tela até o próximo clique.
	procSetForeground.Call(uintptr(t.hwnd))
	procTrackPopupMenu.Call(menu, tpmRight, uintptr(p.X), uintptr(p.Y), 0, uintptr(t.hwnd), 0)
	procPostMessage.Call(uintptr(t.hwnd), 0, 0, 0)
}

func (t *bandeja) abrirPasta() {
	abrir("explorer", diretorioDe(t.dados))
}

func (t *bandeja) abrirPainel() {
	if t.central != "" {
		abrir(t.central, "")
		return
	}
	abrir(t.exe, "painel")
}

func (t *bandeja) testar() {
	// Abre numa janela de console para a pessoa ler o resultado.
	abrir(t.exe, "testar")
}

func abrir(programa, argumentos string) {
	op, _ := windows.UTF16PtrFromString("open")
	pr, _ := windows.UTF16PtrFromString(programa)
	ar, _ := windows.UTF16PtrFromString(argumentos)
	procShellExecute.Call(0, uintptr(unsafe.Pointer(op)), uintptr(unsafe.Pointer(pr)),
		uintptr(unsafe.Pointer(ar)), 0, 1 /* SW_SHOWNORMAL */)
}

func carregarIconeDoExe(instancia windows.Handle) windows.Handle {
	// O ícone do executável é o recurso 1 (versioninfo.json).
	h, _, _ := procLoadImage.Call(uintptr(instancia), 1, imageIcon, 0, 0, lrDefaultSize|lrShared)
	return windows.Handle(h)
}

func carregarIconeSistema(id uintptr) windows.Handle {
	h, _, _ := procLoadIcon.Call(0, id)
	return windows.Handle(h)
}

func copiarUTF16(destino []uint16, s string) {
	u, err := windows.UTF16FromString(s)
	if err != nil {
		// String com NUL no meio: mostra o que der, sem derrubar o ícone.
		u = []uint16{0}
	}
	if len(u) > len(destino) {
		u = u[:len(destino)]
		u[len(u)-1] = 0
	}
	copy(destino, u)
}

func diretorioDe(caminho string) string {
	for i := len(caminho) - 1; i >= 0; i-- {
		if caminho[i] == '\\' || caminho[i] == '/' {
			return caminho[:i]
		}
	}
	return "."
}
