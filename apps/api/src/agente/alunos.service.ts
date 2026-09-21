import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ContextoAgente } from './chave-api.guard';
import { SyncAlunosDto } from './dto';

@Injectable()
export class AlunosService {
  private readonly log = new Logger(AlunosService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Sincroniza o cadastro vindo da catraca. Upsert por (school_id,
   * external_id); num sync completo, quem sumiu do cadastro vira inativo —
   * nunca é apagado, para preservar o histórico de eventos e mensagens.
   */
  async sincronizar(
    ag: ContextoAgente,
    dto: SyncAlunosDto,
  ): Promise<{ upserted: number; ignorados: number; limite: number | null }> {
    const agora = new Date();
    const escola = await this.prisma.school.findUnique({
      where: { id: ag.schoolId },
      select: { maxStudents: true },
    });
    const limite = escola?.maxStudents ?? null;
    // Aluno que já existe sempre é atualizado; o teto do plano só barra
    // cadastro novo, para uma escola que cresceu não perder quem já estava.
    const jaCadastrados = new Set(
      (
        await this.prisma.student.findMany({
          where: { schoolId: ag.schoolId },
          select: { externalId: true },
        })
      ).map((a) => a.externalId),
    );
    let cabem = limite === null ? Infinity : limite - jaCadastrados.size;
    let ignorados = 0;

    for (const a of dto.students) {
      if (!jaCadastrados.has(a.external_id)) {
        if (cabem <= 0) {
          ignorados++;
          continue;
        }
        cabem--;
      }
      await this.prisma.student.upsert({
        where: {
          schoolId_externalId: { schoolId: ag.schoolId, externalId: a.external_id },
        },
        create: {
          schoolId: ag.schoolId,
          externalId: a.external_id,
          name: a.name,
          className: a.class_name,
          card: a.card,
          active: a.active,
          syncedAt: agora,
        },
        update: {
          name: a.name,
          className: a.class_name,
          card: a.card,
          active: a.active,
          syncedAt: agora,
        },
      });
    }

    if (dto.full) {
      // Pendências "cartao:" não vêm do cadastro da catraca; um sync completo
      // não pode escondê-las desativando.
      await this.prisma.student.updateMany({
        where: {
          schoolId: ag.schoolId,
          active: true,
          externalId: { notIn: dto.students.map((a) => a.external_id) },
          NOT: { externalId: { startsWith: 'cartao:' } },
        },
        data: { active: false },
      });
    }

    if (ignorados > 0) {
      this.log.warn(
        `sync da escola ${ag.schoolId}: ${ignorados} aluno(s) fora do teto de ${limite}`,
      );
    }
    const upserted = dto.students.length - ignorados;
    this.log.log(`sync da escola ${ag.schoolId}: ${upserted} alunos`);
    return { upserted, ignorados, limite };
  }
}
