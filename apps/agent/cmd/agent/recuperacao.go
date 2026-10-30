package main

import (
	"context"
	"log/slog"
	"time"
)

// Reinicia apenas o trabalho interno; parar o serviço cancela a recuperação.
// executar deve fechar seus recursos antes de retornar, como faz rodar.
func supervisionar(ctx context.Context, log *slog.Logger, executar func(context.Context) error, esperar func(context.Context, time.Duration) bool) {
	atraso := 5 * time.Second
	for ctx.Err() == nil {
		inicio := time.Now()
		err := executar(ctx)
		if ctx.Err() != nil {
			return
		}
		if time.Since(inicio) >= time.Minute {
			atraso = 5 * time.Second
		}
		log.Warn("operação do agente interrompida; recuperação automática agendada", "erro", err, "em", atraso)
		if !esperar(ctx, atraso) {
			return
		}
		log.Info("reiniciando operação do agente automaticamente")
		atraso *= 2
		if atraso > 30*time.Second {
			atraso = 30 * time.Second
		}
	}
}

func esperarRecuperacao(ctx context.Context, atraso time.Duration) bool {
	timer := time.NewTimer(atraso)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return false
	case <-timer.C:
		return ctx.Err() == nil
	}
}
