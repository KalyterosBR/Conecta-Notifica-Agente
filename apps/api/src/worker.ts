// Worker de envio (doc §2.2): consome a fila `notificacoes` e dispara o
// WhatsApp. Processo separado da API: npm run worker:dev
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Worker } from 'bullmq';
import 'reflect-metadata';
import { AppModule } from './app.module';
import { FILA_NOTIFICACOES, TrabalhoNotificacao } from './filas/notificacoes.queue';
import { MonitoramentoService } from './monitoramento/monitoramento.service';
import { NotificadorService } from './notificacoes/notificador.service';

async function bootstrap() {
  const log = new Logger('Worker');
  const url = process.env.REDIS_URL;
  if (!url) {
    log.error('REDIS_URL é obrigatório para o worker');
    process.exit(1);
  }

  const app = await NestFactory.createApplicationContext(AppModule);
  const notificador = app.get(NotificadorService);

  const u = new URL(url);
  const worker = new Worker<TrabalhoNotificacao>(
    FILA_NOTIFICACOES,
    async (job) => {
      const r = await notificador.processar(job.data.accessEventId);
      log.log(`evento ${job.data.accessEventId}: ${r.status} (${r.enviadas} enviadas)`);
      return r;
    },
    {
      connection: {
        host: u.hostname,
        port: Number(u.port || 6379),
        password: u.password || undefined,
      },
      concurrency: 1,
      // Rate limit conservador (risco de banimento, doc §2.5). Padrão:
      // 20 mensagens por minuto; ajuste por env se necessário.
      limiter: {
        max: Number(process.env.WORKER_MAX_POR_JANELA ?? 20),
        duration: Number(process.env.WORKER_JANELA_MS ?? 60_000),
      },
    },
  );

  worker.on('failed', (job, err) => {
    log.warn(`job ${job?.id} falhou (tentativa ${job?.attemptsMade}): ${err.message}`);
  });

  // Varredura de agentes mudos. Fica no worker porque a API pode rodar em
  // várias réplicas e duplicaria o alerta; o worker é um só.
  const monitoramento = app.get(MonitoramentoService);
  const intervalo = Number(process.env.ALERTA_INTERVALO_MS ?? 300_000);
  const varrerAgora = () =>
    monitoramento
      .varrer()
      .catch((e) => log.warn(`varredura de agentes falhou: ${e?.message ?? e}`));
  // Uma varredura no start: reiniciar o worker não pode custar uma janela
  // inteira de cegueira. Repetir não gera alerta duplicado (alerted_at).
  void varrerAgora();
  const varredura = setInterval(varrerAgora, intervalo);
  // Não segura o processo se for a única coisa pendente.
  varredura.unref?.();

  const encerrar = async () => {
    clearInterval(varredura);
    await worker.close();
    await app.close();
    process.exit(0);
  };
  process.on('SIGINT', encerrar);
  process.on('SIGTERM', encerrar);
  log.log(`worker ouvindo a fila "${FILA_NOTIFICACOES}"`);
  log.log(`varredura de agentes a cada ${Math.round(intervalo / 1000)}s`);
}
bootstrap();
