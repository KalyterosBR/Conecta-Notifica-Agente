import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { noFuso } from '../notificacoes/template';
import { AlertasCanal } from './alertas.canal';

/**
 * Agente parado é a falha silenciosa do produto: a catraca gira, ninguém é
 * avisado e a escola só descobre pela reclamação de um pai (doc §2.5).
 *
 * Consideramos mudo quem passou de `MINUTOS_MUDO` sem heartbeat — o agente
 * bate de 60 em 60 segundos, então o limiar é folgado o bastante para
 * absorver reinício de serviço e queda breve de link.
 */
const MINUTOS_MUDO = Number(process.env.ALERTA_AGENTE_MINUTOS ?? 20);

export interface AgenteMudo {
  escola_id: string;
  escola: string;
  ultimo_sinal: Date | null;
  mudo_ha_minutos: number;
  ja_avisado: boolean;
}

@Injectable()
export class MonitoramentoService {
  private readonly log = new Logger(MonitoramentoService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly canal: AlertasCanal,
  ) {}

  /**
   * Quem está mudo agora. Usado pela varredura e pela tela do admin, para os
   * dois contarem a mesma coisa.
   */
  async agentesMudos(agora = new Date()): Promise<AgenteMudo[]> {
    const limite = new Date(agora.getTime() - MINUTOS_MUDO * 60_000);
    const chaves = await this.prisma.agentApiKey.findMany({
      where: {
        revokedAt: null,
        // Agente que nunca bateu não está mudo: está por instalar. Alertar
        // sobre ele viraria ruído em toda escola recém-criada.
        lastSeenAt: { not: null, lt: limite },
        school: { blocked: false },
      },
      select: {
        id: true,
        lastSeenAt: true,
        alertedAt: true,
        school: { select: { id: true, name: true } },
      },
    });
    return chaves.map((c) => ({
      escola_id: c.school.id,
      escola: c.school.name,
      ultimo_sinal: c.lastSeenAt,
      mudo_ha_minutos: Math.floor((agora.getTime() - c.lastSeenAt!.getTime()) / 60_000),
      ja_avisado: !!c.alertedAt,
    }));
  }

  /**
   * Varredura: avisa quem ficou mudo e quem voltou. Roda no worker, de tempos
   * em tempos.
   *
   * Só alerta dentro da janela de funcionamento da escola: agente parado às
   * 3h da manhã não é urgência, e acordar alguém por isso ensina a ignorar o
   * alerta.
   */
  async varrer(agora = new Date()): Promise<{ avisados: number; recuperados: number }> {
    const limite = new Date(agora.getTime() - MINUTOS_MUDO * 60_000);
    const chaves = await this.prisma.agentApiKey.findMany({
      where: { revokedAt: null, school: { blocked: false } },
      select: {
        id: true,
        lastSeenAt: true,
        alertedAt: true,
        school: {
          select: { id: true, name: true, timezone: true, settings: true },
        },
      },
    });

    let avisados = 0;
    let recuperados = 0;
    for (const c of chaves) {
      const mudo = !!c.lastSeenAt && c.lastSeenAt < limite;

      if (mudo && !c.alertedAt) {
        if (!this.emHorario(c.school, agora)) continue;
        const minutos = Math.floor((agora.getTime() - c.lastSeenAt!.getTime()) / 60_000);
        await this.prisma.agentApiKey.update({
          where: { id: c.id },
          data: { alertedAt: agora },
        });
        await this.canal.enviar({
          tipo: 'agente_mudo',
          escola: { id: c.school.id, nome: c.school.name },
          mensagem: `agente sem sinal há ${minutos} min — os giros da catraca não estão chegando`,
          mudo_ha_minutos: minutos,
          em: agora.toISOString(),
        });
        avisados++;
      } else if (!mudo && c.alertedAt) {
        // Voltou: limpa a marca e avisa, para ninguém ficar caçando um
        // problema que já se resolveu.
        await this.prisma.agentApiKey.update({
          where: { id: c.id },
          data: { alertedAt: null },
        });
        await this.canal.enviar({
          tipo: 'agente_voltou',
          escola: { id: c.school.id, nome: c.school.name },
          mensagem: 'agente voltou a enviar',
          em: agora.toISOString(),
        });
        recuperados++;
      }
    }
    if (avisados || recuperados) {
      this.log.log(`varredura: ${avisados} agente(s) mudo(s), ${recuperados} de volta`);
    }
    return { avisados, recuperados };
  }

  /** Mesma janela que rege o envio de avisos (doc §2.4). */
  private emHorario(
    escola: {
      timezone: string;
      settings: { windowStart: string; windowEnd: string; notifyWeekends: boolean } | null;
    },
    agora: Date,
  ): boolean {
    const { hhmm, fimDeSemana } = noFuso(agora, escola.timezone);
    const inicio = escola.settings?.windowStart ?? '06:00';
    const fim = escola.settings?.windowEnd ?? '19:30';
    if (fimDeSemana && !(escola.settings?.notifyWeekends ?? false)) return false;
    return hhmm >= inicio && hhmm <= fim;
  }
}
