import { Injectable } from '@nestjs/common';
import { MessageStatus } from '@prisma/client';
import { ContextoUsuario } from '../auth/painel.guard';
import { PrismaService } from '../prisma/prisma.service';
import { ProviderConfig } from '../provedores/provedor.interface';
import { inicioDoDia } from './util';

/** Agente sem heartbeat há mais de 5 min conta como offline (doc §2.5). */
const LIMITE_OFFLINE_MS = 5 * 60_000;

@Injectable()
export class VisaoGeralService {
  constructor(private readonly prisma: PrismaService) {}

  async resumo(u: ContextoUsuario) {
    const escola = await this.prisma.school.findUnique({
      where: { id: u.schoolId },
      include: { settings: true },
    });
    const chave = await this.prisma.agentApiKey.findFirst({
      where: { schoolId: u.schoolId, revokedAt: null },
      orderBy: { createdAt: 'desc' },
    });

    const hoje = inicioDoDia(escola!.timezone);
    const naEscola = { accessEvent: { schoolId: u.schoolId } };
    const [eventosHoje, enviadasHoje, entreguesHoje, falhasHoje, semResponsavel, ultimos] =
      await Promise.all([
        this.prisma.accessEvent.count({
          where: { schoolId: u.schoolId, occurredAt: { gte: hoje } },
        }),
        this.prisma.message.count({
          where: {
            ...naEscola,
            createdAt: { gte: hoje },
            status: { in: [MessageStatus.SENT, MessageStatus.DELIVERED, MessageStatus.READ] },
          },
        }),
        this.prisma.message.count({
          where: {
            ...naEscola,
            createdAt: { gte: hoje },
            status: { in: [MessageStatus.DELIVERED, MessageStatus.READ] },
          },
        }),
        this.prisma.message.count({
          where: { ...naEscola, createdAt: { gte: hoje }, status: MessageStatus.FAILED },
        }),
        this.prisma.student.count({
          where: { schoolId: u.schoolId, active: true, guardians: { none: {} } },
        }),
        this.prisma.accessEvent.findMany({
          where: { schoolId: u.schoolId },
          orderBy: { occurredAt: 'desc' },
          take: 10,
          include: { student: { select: { id: true, name: true } } },
        }),
      ]);

    const cfg = (escola!.providerConfig ?? {}) as ProviderConfig;
    return {
      agente: {
        online:
          !!chave?.lastSeenAt &&
          Date.now() - chave.lastSeenAt.getTime() < LIMITE_OFFLINE_MS,
        last_seen_at: chave?.lastSeenAt ?? null,
        status: chave?.lastStatus ?? null,
      },
      whatsapp: {
        conectado: cfg.provider === 'uazapi' && !!cfg.uazapi?.token,
        provider: cfg.provider ?? null,
      },
      hoje: {
        eventos: eventosHoje,
        enviadas: enviadasHoje,
        entregues: entreguesHoje,
        falhas: falhasHoje,
      },
      alunos_sem_responsavel: semResponsavel,
      ultimos_acessos: ultimos.map((e) => ({
        id: e.id,
        aluno: e.student.name,
        student_id: e.student.id,
        direction: e.direction === 'IN' ? 'in' : 'out',
        occurred_at: e.occurredAt,
      })),
    };
  }
}
