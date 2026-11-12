package banco

import "testing"

func TestJpegDeCadastro(t *testing.T) {
	if !JpegDeCadastro([]byte{0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10}) {
		t.Fatal("JFIF deveria ser aceito")
	}
	if JpegDeCadastro([]byte{0x89, 0x50, 0x4E, 0x47}) {
		t.Fatal("PNG não é foto de cadastro")
	}
	if JpegDeCadastro([]byte{0xFF, 0xD8}) {
		t.Fatal("assinatura incompleta")
	}
	grande := make([]byte, FotoMaxBytes+1)
	grande[0], grande[1], grande[2] = 0xFF, 0xD8, 0xFF
	if JpegDeCadastro(grande) {
		t.Fatal("acima do teto")
	}
}
