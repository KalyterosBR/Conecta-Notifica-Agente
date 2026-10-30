//go:build windows

package bandeja

import (
	"bytes"
	_ "embed"
	"encoding/binary"
	"unsafe"

	"golang.org/x/sys/windows"
)

// Ícones preparados com suavização em cada tamanho, sem reduzir outro HICON.
//
//go:embed assets/conectado.ico
var iconeConectado []byte

//go:embed assets/desconectado.ico
var iconeDesconectado []byte

func imagemICO(dados []byte, tamanho int) []byte {
	if len(dados) < 6 || binary.LittleEndian.Uint16(dados[:2]) != 0 || binary.LittleEndian.Uint16(dados[2:4]) != 1 {
		return nil
	}
	quantidade := int(binary.LittleEndian.Uint16(dados[4:6]))
	if quantidade == 0 || quantidade > (len(dados)-6)/16 {
		return nil
	}
	melhor, distancia := -1, int(^uint(0)>>1)
	for i := 0; i < quantidade; i++ {
		e := dados[6+16*i : 6+16*(i+1)]
		largura := int(e[0])
		if largura == 0 {
			largura = 256
		}
		altura := int(e[1])
		if altura == 0 {
			altura = 256
		}
		if largura != altura {
			continue
		}
		d := largura - tamanho
		if d < 0 {
			d = -d * 2
		} // Preferir reduzir uma imagem maior a ampliar uma menor.
		if d < distancia {
			melhor, distancia = i, d
		}
	}
	if melhor < 0 {
		return nil
	}
	e := dados[6+16*melhor : 6+16*(melhor+1)]
	offset := uint64(binary.LittleEndian.Uint32(e[12:16]))
	quantidadeBytes := uint64(binary.LittleEndian.Uint32(e[8:12]))
	if offset < uint64(6+16*quantidade) || quantidadeBytes == 0 || offset+quantidadeBytes > uint64(len(dados)) {
		return nil
	}
	imagem := dados[offset : offset+quantidadeBytes]
	if !bytes.HasPrefix(imagem, []byte{137, 80, 78, 71, 13, 10, 26, 10}) {
		return nil
	}
	return imagem
}

func carregarIconeStatus(dados []byte, tamanho int) windows.Handle {
	imagem := imagemICO(dados, tamanho)
	if len(imagem) == 0 {
		return 0
	}
	h, _, _ := user32.NewProc("CreateIconFromResourceEx").Call(uintptr(unsafe.Pointer(&imagem[0])), uintptr(len(imagem)), 1, 0x30000, uintptr(tamanho), uintptr(tamanho), 0)
	return windows.Handle(h)
}

func tamanhoIconeBandeja() int {
	dpi := uintptr(96)
	classeBarra, _ := windows.UTF16PtrFromString("Shell_TrayWnd")
	barra, _, _ := procFindWindow.Call(uintptr(unsafe.Pointer(classeBarra)), 0)
	obterDPI := user32.NewProc("GetDpiForWindow")
	if barra != 0 && obterDPI.Find() == nil {
		if valor, _, _ := obterDPI.Call(barra); valor != 0 {
			dpi = valor
		}
	}
	metricas := user32.NewProc("GetSystemMetricsForDpi")
	if metricas.Find() == nil {
		if valor, _, _ := metricas.Call(49, dpi); valor >= 16 && valor <= 256 {
			return int(valor)
		}
	}
	valor, _, _ := user32.NewProc("GetSystemMetrics").Call(49)
	if valor >= 16 && valor <= 256 {
		return int(valor)
	}
	return 16
}

func (t *bandeja) atualizarIcones(tamanho int) bool {
	if tamanho == t.tamanhoIcone {
		return false
	}
	conectado := carregarIconeStatus(iconeConectado, tamanho)
	desconectado := carregarIconeStatus(iconeDesconectado, tamanho)
	if conectado == 0 || desconectado == 0 {
		if conectado != 0 {
			user32.NewProc("DestroyIcon").Call(uintptr(conectado))
		}
		if desconectado != 0 {
			user32.NewProc("DestroyIcon").Call(uintptr(desconectado))
		}
		return false
	}
	t.liberarIcones()
	t.iconeOK, t.iconeErr, t.tamanhoIcone = conectado, desconectado, tamanho
	return true
}

func (t *bandeja) liberarIcones() {
	if t.tamanhoIcone == 0 {
		return
	} // Fallbacks compartilhados do Windows.
	user32.NewProc("DestroyIcon").Call(uintptr(t.iconeOK))
	user32.NewProc("DestroyIcon").Call(uintptr(t.iconeErr))
	t.tamanhoIcone = 0
}
