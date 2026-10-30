//go:build windows

package bandeja

import (
	"bytes"
	"encoding/binary"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"os"
	"testing"
	"unsafe"

	"golang.org/x/sys/windows"
)

func TestIndicadorPreservaLogo(t *testing.T) {
	for _, caso := range []struct {
		nome  string
		cor   uint32
		dados []byte
	}{{"verde", 0xFF2E8B57, iconeConectado}, {"vermelho", 0xFFB22222, iconeDesconectado}} {
		for _, tamanho := range []int{16, 20, 24, 32, 40, 48, 64} {
			t.Run(fmt.Sprintf("%s/%d", caso.nome, tamanho), func(t *testing.T) { verificarIndicador(t, caso.cor, caso.dados, tamanho) })
		}
	}
}

func verificarIndicador(t *testing.T, indicador uint32, dados []byte, tamanho int) {
	icone := carregarIconeStatus(dados, tamanho)
	if icone == 0 {
		t.Fatal("ícone não carregado")
	}
	defer user32.NewProc("DestroyIcon").Call(uintptr(icone))
	info := struct {
		Icon               int32
		XHotspot, YHotspot uint32
		Mask, Color        uintptr
	}{}
	if ok, _, _ := user32.NewProc("GetIconInfo").Call(uintptr(icone), uintptr(unsafe.Pointer(&info))); ok == 0 {
		t.Fatal("não foi possível ler o ícone")
	}
	gdi := windows.NewLazySystemDLL("gdi32.dll")
	defer gdi.NewProc("DeleteObject").Call(info.Mask)
	defer gdi.NewProc("DeleteObject").Call(info.Color)
	dc, _, _ := gdi.NewProc("CreateCompatibleDC").Call(0)
	defer gdi.NewProc("DeleteDC").Call(dc)
	bitmapInfo := struct {
		Size                   uint32
		Width, Height          int32
		Planes, BitCount       uint16
		Compression, SizeImage uint32
		XPels, YPels           int32
		ClrUsed, ClrImportant  uint32
	}{Size: 40, Width: int32(tamanho), Height: -int32(tamanho), Planes: 1, BitCount: 32}
	pixels := make([]uint32, tamanho*tamanho)
	linhas, _, _ := gdi.NewProc("GetDIBits").Call(dc, info.Color, 0, uintptr(tamanho), uintptr(unsafe.Pointer(&pixels[0])), uintptr(unsafe.Pointer(&bitmapInfo)), 0)
	if linhas != uintptr(tamanho) {
		t.Fatal("não foi possível ler os pixels")
	}
	centro := pixels[int(float64(tamanho)*.78)*tamanho+int(float64(tamanho)*.79)]
	for _, deslocamento := range []uint{0, 8, 16, 24} {
		diferenca := int(uint8(centro>>deslocamento)) - int(uint8(indicador>>deslocamento))
		if diferenca < -12 || diferenca > 12 {
			t.Fatalf("cor do indicador incorreta: %08x, esperado %08x", centro, indicador)
		}
	}
	visiveis := 0
	for y := 0; y < tamanho/2; y++ {
		for x := 0; x < tamanho; x++ {
			if pixels[y*tamanho+x]>>24 != 0 {
				visiveis++
			}
		}
	}
	if visiveis < tamanho {
		t.Fatal("logo desapareceu ao acrescentar o indicador")
	}
	if destino := os.Getenv("NOTIFICA_ICON_PREVIEW"); destino != "" {
		destino += fmt.Sprintf(".%d.png", tamanho)
		if indicador == 0xFFB22222 {
			destino += ".red.png"
		}
		im := image.NewNRGBA(image.Rect(0, 0, tamanho, tamanho))
		for y := 0; y < tamanho; y++ {
			for x := 0; x < tamanho; x++ {
				p := pixels[y*tamanho+x]
				im.SetNRGBA(x, y, color.NRGBA{R: uint8(p >> 16), G: uint8(p >> 8), B: uint8(p), A: uint8(p >> 24)})
			}
		}
		f, err := os.Create(destino)
		if err != nil {
			t.Fatal(err)
		}
		defer f.Close()
		if err := png.Encode(f, im); err != nil {
			t.Fatal(err)
		}
	}
}

func TestFramesICO(t *testing.T) {
	for _, dados := range [][]byte{iconeConectado, iconeDesconectado} {
		for _, tamanho := range []int{16, 20, 24, 32, 40, 48, 64, 96, 128, 256} {
			frame := imagemICO(dados, tamanho)
			im, err := png.Decode(bytes.NewReader(frame))
			if err != nil {
				t.Fatal(err)
			}
			if im.Bounds().Dx() != tamanho || im.Bounds().Dy() != tamanho {
				t.Fatalf("frame errado para %d", tamanho)
			}
			suavizados := 0
			for y := 0; y < tamanho; y++ {
				for x := 0; x < tamanho; x++ {
					_, _, _, a := im.At(x, y).RGBA()
					if a > 0 && a < 65535 {
						suavizados++
					}
				}
			}
			if suavizados == 0 {
				t.Fatalf("bordas sem suavização em %d", tamanho)
			}
		}
	}
}

func TestICOInvalido(t *testing.T) {
	for _, dados := range [][]byte{nil, iconeConectado[:5], iconeConectado[:20]} {
		if imagemICO(dados, 16) != nil {
			t.Fatal("aceitou ICO truncado")
		}
	}
	corrompido := append([]byte(nil), iconeConectado...)
	binary.LittleEndian.PutUint32(corrompido[18:22], 0xFFFFFFFF)
	if imagemICO(corrompido, 16) != nil {
		t.Fatal("aceitou offset fora do arquivo")
	}
}
