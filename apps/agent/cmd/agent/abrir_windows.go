//go:build windows

package main

import (
	"fmt"
	"unsafe"

	"golang.org/x/sys/windows"
)

var (
	shell32Principal = windows.NewLazySystemDLL("shell32.dll")
	shellExecute     = shell32Principal.NewProc("ShellExecuteW")
)

// abrirAlvo delega diretórios e arquivos ao Shell do Windows. Ao contrário de
// criar explorer.exe/notepad.exe como filhos do agente, ele usa a associação
// padrão da máquina e retorna assim que o Explorer recebe a solicitação.
func abrirAlvo(caminho string) error {
	alvo, err := windows.UTF16PtrFromString(caminho)
	if err != nil {
		return err
	}
	operacao, _ := windows.UTF16PtrFromString("open")
	ret, _, chamadaErr := shellExecute.Call(0, uintptr(unsafe.Pointer(operacao)), uintptr(unsafe.Pointer(alvo)), 0, 0, 1)
	if ret <= 32 {
		if chamadaErr != nil && chamadaErr != windows.ERROR_SUCCESS {
			return chamadaErr
		}
		return fmt.Errorf("o Windows não conseguiu abrir o item (código %d)", ret)
	}
	return nil
}
