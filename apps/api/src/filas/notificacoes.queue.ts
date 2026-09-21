import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';

export const FILA_NOTIFICACOES = 'notificacoes';

/**
 * Trabalho enfileirado para cada access_event aceito. O worker (próxima
 * etapa) resolve aluno -> responsáveis, aplica as regras de negócio (dedupe,
 * janela de horário, opt-in) e dispara via MessageProvider.
 */
export interface TrabalhoNotificacao {
  accessEventId: string;
  schoolId: string;
}

/**
 * Producer da fila. Sem REDIS_URL configurado vira no-op com log — os eventos
 * continuam gravados em access_events e podem ser reprocessados depois.
 */
@Injectable()
export class NotificacoesQueue implements OnModuleDestroy {
  private readonly log = new Logger(NotificacoesQueue.name);
  private fila?: Queue<TrabalhoNotificacao>;

  constructor() {
    const url = process.env.REDIS_URL;
    if (!url) {
      this.log.warn('REDIS_URL ausente: notificações não serão enfileiradas');
      return;
    }
    const u = new URL(url);
    this.fila = new Queue<TrabalhoNotificacao>(FILA_NOTIFICACOES, {
      connection: {
        host: u.hostname,
        port: Number(u.port || 6379),
        password: u.password || undefined,
      },
      defaultJobOptions: {
        attempts: 5,
        backoff: { type: 'exponential', delay: 5_000 },
        removeOnComplete: 1000,
        removeOnFail: 5000,
      },
    });
  }

  async enfileirar(trabalhos: TrabalhoNotificacao[]): Promise<void> {
    if (!this.fila || trabalhos.length === 0) return;
    await this.fila.addBulk(
      trabalhos.map((t) => ({
        name: 'notificar',
        data: t,
        // Um job por evento: reprocessar a fila nunca duplica notificação.
        opts: { jobId: t.accessEventId },
      })),
    );
  }

  /**
   * Reenvio manual (tela Envios): jobId novo, porque o job original
   * (jobId = accessEventId) já existiu. O worker pula quem está SENT, então
   * só as mensagens resetadas para QUEUED saem de novo.
   */
  async reenfileirar(t: TrabalhoNotificacao): Promise<boolean> {
    if (!this.fila) {
      this.log.warn('reenvio sem REDIS_URL: job não enfileirado');
      return false;
    }
    await this.fila.add('notificar', t, {
      jobId: `${t.accessEventId}:r:${Date.now()}`,
    });
    return true;
  }

  async onModuleDestroy() {
    await this.fila?.close();
  }
}
