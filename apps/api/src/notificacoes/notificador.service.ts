import { Injectable, Logger } from '@nestjs/common';
import { Direction, MessageStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { InstanciasService } from '../provedores/instancias.service';
import { renderizar, noFuso, TEMPLATE_PADRAO } from './template';

/** Resultado de um job, para log e para os testes. */
export interface ResultadoNotificacao {
  status:
    | 'enviado'
    | 'pulado_dedupe'
    | 'pulado_janela'
    | 'pulado_fim_de_semana'
    | 'sem_responsavel'
    | 'sem_provedor'
    | 'bloqueado'
    | 'falha_parcial';
  enviadas: number;
  detalhe?: string;
}

const PADROES = {
  dedupeMinutes: 3,
  windowStart: '06:00',
  windowEnd: '19:30',
  notifyWeekends: false,
};

/**
 * Consome um access_event e decide quem avisar (doc §2.4). O evento em si já
 * está gravado — pular a notificação nunca apaga o registro de acesso.
 */
@Injectable()
export class NotificadorService {
  private readonly log = new Logger(NotificadorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly instancias: InstanciasService,
  ) {}

  async processar(accessEventId: string): Promise<ResultadoNotificacao> {
    const ev = await this.prisma.accessEvent.findUnique({
      where: { id: accessEventId },
      include: {
        student: { include: { guardians: { include: { guardian: true } } } },
        school: { include: { settings: true, templates: true } },
      },
    });
    if (!ev) {
      // Evento sumiu (nunca deveria): não há o que reprocessar.
      this.log.warn(`access_event ${accessEventId} não encontrado`);
      return { status: 'sem_responsavel', enviadas: 0, detalhe: 'evento inexistente' };
    }

    // Bloqueio comercial (inadimplência, contrato suspenso): o evento fica
    // gravado, só o aviso não sai. Religar o cliente volta a notificar sem
    // precisar de nada retroativo.
    if (ev.school.blocked) {
      return {
        status: 'bloqueado',
        enviadas: 0,
        detalhe: ev.school.blockedReason ?? 'escola bloqueada',
      };
    }

    const cfg = { ...PADROES, ...(ev.school.settings ?? {}) };
    const { hhmm, fimDeSemana } = noFuso(ev.occurredAt, ev.school.timezone);

    // Fim de semana / feriado configurável.
    if (fimDeSemana && !cfg.notifyWeekends) {
      return { status: 'pulado_fim_de_semana', enviadas: 0 };
    }
    // Janela de horário da escola.
    if (hhmm < cfg.windowStart || hhmm > cfg.windowEnd) {
      return { status: 'pulado_janela', enviadas: 0, detalhe: hhmm };
    }
    // Dedupe: mesmo aluno, mesma direção, dentro de N minutos.
    if (cfg.dedupeMinutes > 0) {
      const desde = new Date(ev.occurredAt.getTime() - cfg.dedupeMinutes * 60_000);
      const anterior = await this.prisma.accessEvent.findFirst({
        where: {
          schoolId: ev.schoolId,
          studentId: ev.studentId,
          direction: ev.direction,
          occurredAt: { gte: desde, lt: ev.occurredAt },
          NOT: { id: ev.id },
        },
        select: { id: true },
      });
      if (anterior) {
        return { status: 'pulado_dedupe', enviadas: 0, detalhe: anterior.id };
      }
    }

    // Opt-in obrigatório (LGPD) + toggle entrada/saída do vínculo.
    const elegiveis = ev.student.guardians.filter((v) => {
      const g = v.guardian;
      if (!g.optInAt || g.optOutAt) return false;
      return ev.direction === Direction.IN ? v.notifyEntry : v.notifyExit;
    });
    if (elegiveis.length === 0) {
      // Aluno sem responsável: o evento fica como pendência no painel.
      return { status: 'sem_responsavel', enviadas: 0 };
    }

    // Rodízio entre os chips conectados da escola.
    const chip = await this.instancias.paraEnvio(ev.schoolId);
    const provedor = chip?.provedor;
    if (!provedor) {
      // WhatsApp ainda não conectado: marca FAILED para aparecer em Envios
      // com "reenviar" depois do onboarding terminar.
      for (const v of elegiveis) {
        await this.registrarFalha(ev.id, v.guardianId, 'nenhum', 'provedor não configurado');
      }
      return { status: 'sem_provedor', enviadas: 0 };
    }

    const modelo =
      ev.school.templates.find((t) => t.eventType === ev.direction)?.body ??
      TEMPLATE_PADRAO[ev.direction];

    let enviadas = 0;
    let falhas = 0;
    let ultimoErro = '';
    for (const v of elegiveis) {
      const g = v.guardian;
      // Uma linha por (evento, responsável); num retry do job, quem já foi
      // enviado é pulado aqui.
      const msg = await this.prisma.message.upsert({
        where: { accessEventId_guardianId: { accessEventId: ev.id, guardianId: g.id } },
        create: {
          accessEventId: ev.id,
          guardianId: g.id,
          provider: provedor.nome,
          status: MessageStatus.QUEUED,
        },
        update: {},
      });
      if (
        msg.status === MessageStatus.SENT ||
        msg.status === MessageStatus.DELIVERED ||
        msg.status === MessageStatus.READ
      ) {
        continue;
      }

      const texto = renderizar(modelo, {
        responsavel: g.name,
        aluno: ev.student.name,
        hora: hhmm,
        escola: ev.school.name,
      });
      try {
        const r = await provedor.enviarTexto(g.phoneE164, texto);
        await this.prisma.message.update({
          where: { id: msg.id },
          data: {
            status: MessageStatus.SENT,
            provider: provedor.nome,
            providerMessageId: r.id,
            attempts: { increment: 1 },
            sentAt: new Date(),
            error: null,
          },
        });
        enviadas++;
      } catch (e) {
        falhas++;
        ultimoErro = e instanceof Error ? e.message : String(e);
        await this.registrarFalha(ev.id, g.id, provedor.nome, ultimoErro);
      }
    }

    if (enviadas > 0 && chip) {
      await this.instancias.registrarUso(chip.id);
    }

    if (falhas > 0) {
      // Lança para o BullMQ reprocessar: os SENT são pulados, só as falhas
      // voltam a tentar.
      this.log.warn(`evento ${ev.id}: ${falhas} falha(s) de envio — ${ultimoErro}`);
      const err = new Error(`falha em ${falhas} envio(s): ${ultimoErro}`);
      (err as any).resultado = { status: 'falha_parcial', enviadas } satisfies ResultadoNotificacao;
      throw err;
    }
    return { status: 'enviado', enviadas };
  }

  private async registrarFalha(
    accessEventId: string,
    guardianId: string,
    provider: string,
    erro: string,
  ): Promise<void> {
    await this.prisma.message.upsert({
      where: { accessEventId_guardianId: { accessEventId, guardianId } },
      create: {
        accessEventId,
        guardianId,
        provider,
        status: MessageStatus.FAILED,
        attempts: 1,
        error: erro.slice(0, 500),
      },
      update: {
        status: MessageStatus.FAILED,
        attempts: { increment: 1 },
        error: erro.slice(0, 500),
      },
    });
  }
}
