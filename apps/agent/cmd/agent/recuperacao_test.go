package main

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"testing"
	"time"
)

func TestSupervisionarRecuperaAteCancelar(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	var atrasos []time.Duration
	chamadas := 0
	supervisionar(ctx, slog.New(slog.NewTextHandler(io.Discard, nil)), func(context.Context) error {
		chamadas++
		return errors.New("queda temporária")
	}, func(_ context.Context, atraso time.Duration) bool {
		atrasos = append(atrasos, atraso)
		if len(atrasos) == 5 {
			cancel()
			return false
		}
		return true
	})
	esperados := []time.Duration{5 * time.Second, 10 * time.Second, 20 * time.Second, 30 * time.Second, 30 * time.Second}
	if chamadas != len(esperados) {
		t.Fatalf("chamadas: %d", chamadas)
	}
	for i, esperado := range esperados {
		if atrasos[i] != esperado {
			t.Fatalf("atraso %d: %v", i, atrasos[i])
		}
	}
}

func TestEsperaRecuperacaoCancelada(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if esperarRecuperacao(ctx, time.Hour) {
		t.Fatal("não deve repetir após parada")
	}
}
