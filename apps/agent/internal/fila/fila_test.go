package fila

import (
	"testing"
	"time"

	"github.com/conecta/notifica-agent/internal/modelo"
)

func ev(id string) modelo.Evento {
	return modelo.Evento{IDExterno: id, Direcao: "in", OcorridoEm: time.Now().Truncate(time.Second)}
}

func TestFilaEntregaNaOrdemEConfirma(t *testing.T) {
	dir := t.TempDir()
	f, err := Abrir(dir)
	if err != nil {
		t.Fatal(err)
	}
	if err := f.Enfileirar([]modelo.Evento{ev("a"), ev("b"), ev("c")}, "100"); err != nil {
		t.Fatal(err)
	}
	if f.Pendentes() != 3 {
		t.Fatalf("pendentes = %d", f.Pendentes())
	}

	evs, bytes, err := f.Espiar(2)
	if err != nil {
		t.Fatal(err)
	}
	if len(evs) != 2 || evs[0].IDExterno != "a" || evs[1].IDExterno != "b" {
		t.Fatalf("espiar devolveu %+v", evs)
	}
	// Espiar sem confirmar não consome: um envio que falhou tem que voltar.
	novo, _, _ := f.Espiar(2)
	if novo[0].IDExterno != "a" {
		t.Fatalf("espiar consumiu sem confirmar")
	}
	if err := f.Confirmar(bytes, len(evs)); err != nil {
		t.Fatal(err)
	}
	if f.Pendentes() != 1 {
		t.Fatalf("pendentes depois de confirmar = %d", f.Pendentes())
	}

	resto, _, _ := f.Espiar(10)
	if len(resto) != 1 || resto[0].IDExterno != "c" {
		t.Fatalf("resto = %+v", resto)
	}
	f.Fechar()
}

func TestFilaSobreviveARestart(t *testing.T) {
	dir := t.TempDir()
	f, err := Abrir(dir)
	if err != nil {
		t.Fatal(err)
	}
	f.Enfileirar([]modelo.Evento{ev("a"), ev("b")}, "42")
	evs, bytes, _ := f.Espiar(1)
	f.Confirmar(bytes, len(evs))
	f.Fechar()

	f2, err := Abrir(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer f2.Fechar()
	if f2.Cursor() != "42" {
		t.Fatalf("cursor = %q", f2.Cursor())
	}
	restantes, _, _ := f2.Espiar(10)
	if len(restantes) != 1 || restantes[0].IDExterno != "b" {
		t.Fatalf("restantes = %+v", restantes)
	}
}

func TestVistosDeduplicaEPersiste(t *testing.T) {
	dir := t.TempDir()
	v, err := AbrirVistos(dir, time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	if !v.Marcar("x") {
		t.Fatal("primeira marcação deveria ser nova")
	}
	if v.Marcar("x") {
		t.Fatal("segunda marcação deveria ser conhecida")
	}
	v.Fechar()

	v2, err := AbrirVistos(dir, time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	defer v2.Fechar()
	if !v2.Conhece("x") {
		t.Fatal("cache de vistos não sobreviveu ao restart")
	}
}
