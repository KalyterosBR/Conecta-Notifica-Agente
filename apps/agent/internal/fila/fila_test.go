package fila

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/conecta/notifica-agent/internal/modelo"
)

func TestAbrirMigraCheckpointLegado(t *testing.T) {
	dir := t.TempDir()
	legado := Estado{Cursor: "42", Offset: 17, Enfileirados: 9, Enviados: 8, UltimoEvento: "2026-09-28T10:00:00-03:00"}
	b, err := json.Marshal(legado)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "estado.json"), b, 0o600); err != nil {
		t.Fatal(err)
	}
	f, err := Abrir(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Fechar()
	if got := f.Estado(); got != legado {
		t.Fatalf("checkpoint legado não foi preservado: got %+v, want %+v", got, legado)
	}
	if _, err := os.Stat(filepath.Join(dir, "fila-estado.json")); err != nil {
		t.Fatalf("checkpoint novo não foi criado: %v", err)
	}
}

func TestNaoInterpretaEstadoDeSaudeComoCheckpoint(t *testing.T) {
	dir := t.TempDir()
	saude := `{"em":"2026-09-28T13:00:00-03:00","banco_ok":true,"saas_ok":true}`
	if err := os.WriteFile(filepath.Join(dir, "estado.json"), []byte(saude), 0o600); err != nil {
		t.Fatal(err)
	}
	f, err := Abrir(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Fechar()
	if got := f.Estado(); got.Cursor != "" || got.Offset != 0 || got.Enfileirados != 0 || got.Enviados != 0 {
		t.Fatalf("estado de saúde foi tratado como checkpoint: %+v", got)
	}
}

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
