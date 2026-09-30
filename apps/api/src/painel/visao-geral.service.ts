import { Injectable } from '@nestjs/common';
import { MessageStatus } from '@prisma/client';
import { ContextoUsuario } from '../auth/painel.guard';
import { agenteEstaOnline, statusAgenteParaPainel } from '../agente/status';
import { PrismaService } from '../prisma/prisma.service';
import { InstanciasService } from '../provedores/instancias.service';
import { inicioDoDia } from './util';

@Injectable()
export class VisaoGeralService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly instancias: InstanciasService,
  ) {}

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
    const [eventosHoje, enviadasHoje, entreguesHoje, falhasHoje, semResponsavel, totalAlunos, ultimos, chips] =
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
        this.prisma.student.count({ where: { schoolId: u.schoolId, active: true } }),
        this.prisma.accessEvent.findMany({
          where: { schoolId: u.schoolId },
          orderBy: { occurredAt: 'desc' },
          take: 10,
          include: { student: { select: { id: true, name: true } } },
        }),
        this.instancias.listar(u.schoolId),
      ]);

    return {
      agente: {
        online: agenteEstaOnline(chave?.lastSeenAt),
        last_seen_at: chave?.lastSeenAt ?? null,
        status: statusAgenteParaPainel(chave?.lastStatus),
      },
      whatsapp: {
        conectado: chips.some((c) => c.conectado),
        provider: chips.some((c) => c.conectado) ? 'uazapi' : null,
      },
      hoje: {
        eventos: eventosHoje,
        enviadas: enviadasHoje,
        entregues: entreguesHoje,
        falhas: falhasHoje,
      },
      alunos_sem_responsavel: semResponsavel,
      alunos_total: totalAlunos,
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
