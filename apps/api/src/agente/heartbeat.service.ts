import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ContextoAgente } from './chave-api.guard';
import { HeartbeatDto } from './dto';

@Injectable()
export class HeartbeatService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Alimenta agent_api_keys.last_seen_at (alerta de agente offline no painel)
   * e guarda o status completo para a tela de visão geral.
   */
  async registrar(ag: ContextoAgente, hb: HeartbeatDto): Promise<void> {
    await this.prisma.agentApiKey.update({
      where: { id: ag.apiKeyId },
      data: {
        lastSeenAt: new Date(),
        lastStatus: {
          version: hb.version,
          cursor: hb.cursor,
          pending: hb.pending,
          db_ok: hb.db_ok,
          last_error: hb.last_error,
          last_event_at: hb.last_event_at,
          sent_today: hb.sent_today,
        },
      },
    });
  }
}
