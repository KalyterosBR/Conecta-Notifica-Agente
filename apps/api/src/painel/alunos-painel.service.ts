import { Injectable, NotFoundException } from '@nestjs/common';
import { ContextoUsuario } from '../auth/painel.guard';
import { PrismaService } from '../prisma/prisma.service';
import { FiltroAlunosDto } from './dto';

const POR_PAGINA = 50;

@Injectable()
export class AlunosPainelService {
  constructor(private readonly prisma: PrismaService) {}

  async listar(u: ContextoUsuario, f: FiltroAlunosDto) {
    const where = {
      schoolId: u.schoolId,
      active: true,
      ...(f.busca
        ? { name: { contains: f.busca, mode: 'insensitive' as const } }
        : {}),
      ...(f.sem_responsavel ? { guardians: { none: {} } } : {}),
    };
    const pagina = f.pagina ?? 1;
    const [total, alunos] = await Promise.all([
      this.prisma.student.count({ where }),
      this.prisma.student.findMany({
        where,
        orderBy: { name: 'asc' },
        skip: (pagina - 1) * POR_PAGINA,
        take: POR_PAGINA,
        include: { guardians: { select: { guardianId: true } } },
      }),
    ]);
    return {
      total,
      pagina,
      alunos: alunos.map((a) => ({
        id: a.id,
        external_id: a.externalId,
        name: a.name,
        class_name: a.className,
        card: a.card,
        responsaveis: a.guardians.length,
        pendente: a.guardians.length === 0,
      })),
    };
  }

  async detalhe(u: ContextoUsuario, id: string) {
    const aluno = await this.prisma.student.findFirst({
      where: { id, schoolId: u.schoolId },
      include: {
        guardians: { include: { guardian: true } },
        events: {
          orderBy: { occurredAt: 'desc' },
          take: 30,
          include: { messages: { select: { status: true } } },
        },
      },
    });
    if (!aluno) throw new NotFoundException();
    return {
      id: aluno.id,
      external_id: aluno.externalId,
      name: aluno.name,
      class_name: aluno.className,
      card: aluno.card,
      active: aluno.active,
      responsaveis: aluno.guardians.map((v) => ({
        id: v.guardian.id,
        name: v.guardian.name,
        phone: v.guardian.phoneE164,
        relation: v.guardian.relation,
        opt_in: !!v.guardian.optInAt && !v.guardian.optOutAt,
        notify_entry: v.notifyEntry,
        notify_exit: v.notifyExit,
        is_primary: v.isPrimary,
      })),
      acessos: aluno.events.map((e) => ({
        id: e.id,
        direction: e.direction === 'IN' ? 'in' : 'out',
        occurred_at: e.occurredAt,
        avisos: e.messages.length,
      })),
    };
  }
}
