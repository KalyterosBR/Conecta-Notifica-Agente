import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ContextoUsuario } from '../auth/painel.guard';
import { PrismaService } from '../prisma/prisma.service';
import {
  AtualizarResponsavelDto,
  AtualizarVinculoDto,
  CriarResponsavelDto,
  FiltroResponsaveisDto,
  ImportarResponsaveisDto,
  VincularDto,
} from './dto';
import { normalizarTelefone } from './util';

/** Página da listagem — mesma paginação das outras telas do painel. */
const POR_PAGINA = 30;

@Injectable()
export class ResponsaveisService {
  constructor(private readonly prisma: PrismaService) {}

  /** Lista da tela de Responsáveis, com busca por nome ou telefone. */
  async listar(u: ContextoUsuario, f: FiltroResponsaveisDto) {
    const busca = f.busca?.trim();
    const digitos = busca?.replace(/\D/g, '');
    const where = {
      schoolId: u.schoolId,
      ...(busca
        ? {
            OR: [
              { name: { contains: busca, mode: 'insensitive' as const } },
              ...(digitos ? [{ phoneE164: { contains: digitos } }] : []),
            ],
          }
        : {}),
      ...(f.sem_opt_in ? { optInAt: null } : {}),
    };
    const pagina = f.pagina ?? 1;
    const [total, responsaveis] = await Promise.all([
      this.prisma.guardian.count({ where }),
      this.prisma.guardian.findMany({
        where,
        orderBy: { name: 'asc' },
        skip: (pagina - 1) * POR_PAGINA,
        take: POR_PAGINA,
        include: {
          students: { include: { student: { select: { id: true, name: true, className: true } } } },
        },
      }),
    ]);
    return {
      total,
      pagina,
      por_pagina: POR_PAGINA,
      responsaveis: responsaveis.map((g) => ({
        id: g.id,
        name: g.name,
        phone: g.phoneE164,
        relation: g.relation,
        // Sem opt-in o worker não envia (doc §2.4) — a tela precisa gritar isso.
        opt_in: !!g.optInAt && !g.optOutAt,
        opt_in_at: g.optInAt,
        alunos: g.students.map((v) => ({
          id: v.student.id,
          name: v.student.name,
          class_name: v.student.className,
          notify_entry: v.notifyEntry,
          notify_exit: v.notifyExit,
        })),
      })),
    };
  }

  /** Vincula um responsável que já existe a mais um aluno. */
  async vincular(u: ContextoUsuario, id: string, dto: VincularDto) {
    const [responsavel, aluno] = await Promise.all([
      this.prisma.guardian.findFirst({ where: { id, schoolId: u.schoolId }, select: { id: true } }),
      this.prisma.student.findFirst({
        where: { id: dto.student_id, schoolId: u.schoolId },
        select: { id: true },
      }),
    ]);
    if (!responsavel || !aluno) throw new NotFoundException('responsável ou aluno não encontrado');
    await this.prisma.studentGuardian.upsert({
      where: { studentId_guardianId: { studentId: aluno.id, guardianId: id } },
      create: {
        studentId: aluno.id,
        guardianId: id,
        notifyEntry: dto.notify_entry ?? true,
        notifyExit: dto.notify_exit ?? true,
      },
      update: {},
    });
    return { ok: true };
  }

  /** Desfaz o vínculo. O responsável continua existindo. */
  async desvincular(u: ContextoUsuario, id: string, alunoId: string) {
    const aluno = await this.prisma.student.findFirst({
      where: { id: alunoId, schoolId: u.schoolId },
      select: { id: true },
    });
    if (!aluno) throw new NotFoundException();
    await this.prisma.studentGuardian.deleteMany({
      where: { guardianId: id, studentId: alunoId },
    });
    return { ok: true };
  }

  /**
   * Importação em lote (doc §4). O casamento é pelo `external_id` do aluno —
   * o mesmo da catraca —, então a escola exporta a planilha do sistema de
   * matrícula e só acrescenta as colunas de responsável.
   *
   * Nada é criado pela metade: cada linha vira um resultado, e as que falham
   * voltam com o motivo para a escola corrigir na planilha.
   */
  async importar(u: ContextoUsuario, dto: ImportarResponsaveisDto) {
    const externos = [...new Set(dto.linhas.map((l) => l.aluno_external_id))];
    const alunos = await this.prisma.student.findMany({
      where: { schoolId: u.schoolId, externalId: { in: externos } },
      select: { id: true, externalId: true },
    });
    const porExterno = new Map(alunos.map((a) => [a.externalId, a.id]));

    let criados = 0;
    let vinculados = 0;
    const erros: { linha: number; motivo: string }[] = [];

    for (const [i, l] of dto.linhas.entries()) {
      const alunoId = porExterno.get(l.aluno_external_id);
      if (!alunoId) {
        erros.push({ linha: i + 1, motivo: `aluno ${l.aluno_external_id} não existe no cadastro` });
        continue;
      }
      const telefone = normalizarTelefone(l.telefone);
      if (!telefone) {
        erros.push({ linha: i + 1, motivo: `telefone inválido: ${l.telefone}` });
        continue;
      }

      // Mesmo telefone na escola = mesma pessoa; um responsável costuma ter
      // mais de um filho, e duplicar mandaria a mensagem duas vezes.
      let responsavel = await this.prisma.guardian.findFirst({
        where: { schoolId: u.schoolId, phoneE164: telefone },
        select: { id: true },
      });
      if (!responsavel) {
        responsavel = await this.prisma.guardian.create({
          data: {
            schoolId: u.schoolId,
            name: l.nome,
            phoneE164: telefone,
            relation: l.parentesco ?? null,
            optInAt: dto.opt_in ? new Date() : null,
          },
          select: { id: true },
        });
        criados++;
      }
      const vinculo = await this.prisma.studentGuardian.findUnique({
        where: { studentId_guardianId: { studentId: alunoId, guardianId: responsavel.id } },
      });
      if (!vinculo) {
        await this.prisma.studentGuardian.create({
          data: { studentId: alunoId, guardianId: responsavel.id },
        });
        vinculados++;
      }
    }
    return { criados, vinculados, erros, total: dto.linhas.length };
  }

  async criar(u: ContextoUsuario, dto: CriarResponsavelDto) {
    // Todos os alunos precisam ser da escola do usuário.
    const alunos = await this.prisma.student.findMany({
      where: { id: { in: dto.student_ids }, schoolId: u.schoolId },
      select: { id: true },
    });
    if (alunos.length !== dto.student_ids.length) {
      throw new BadRequestException('aluno inexistente ou de outra escola');
    }

    const responsavel = await this.prisma.guardian.create({
      data: {
        schoolId: u.schoolId,
        name: dto.name,
        phoneE164: dto.phone,
        relation: dto.relation,
        // Opt-in LGPD com data (doc §2.5); sem opt-in o worker não envia.
        optInAt: dto.opt_in ? new Date() : null,
      },
    });
    for (const a of alunos) {
      await this.prisma.studentGuardian.create({
        data: {
          studentId: a.id,
          guardianId: responsavel.id,
          notifyEntry: dto.notify_entry ?? true,
          notifyExit: dto.notify_exit ?? true,
        },
      });
    }
    return { id: responsavel.id };
  }

  async atualizar(u: ContextoUsuario, id: string, dto: AtualizarResponsavelDto) {
    const atual = await this.prisma.guardian.findFirst({
      where: { id, schoolId: u.schoolId },
    });
    if (!atual) throw new NotFoundException();

    await this.prisma.guardian.update({
      where: { id },
      data: {
        name: dto.name,
        phoneE164: dto.phone,
        relation: dto.relation,
        ...(dto.opt_in === true ? { optInAt: new Date(), optOutAt: null } : {}),
        ...(dto.opt_in === false ? { optOutAt: new Date() } : {}),
      },
    });
    return { ok: true };
  }

  async atualizarVinculo(
    u: ContextoUsuario,
    alunoId: string,
    responsavelId: string,
    dto: AtualizarVinculoDto,
  ) {
    const aluno = await this.prisma.student.findFirst({
      where: { id: alunoId, schoolId: u.schoolId },
      select: { id: true },
    });
    if (!aluno) throw new NotFoundException();
    await this.prisma.studentGuardian.update({
      where: {
        studentId_guardianId: { studentId: alunoId, guardianId: responsavelId },
      },
      data: { notifyEntry: dto.notify_entry, notifyExit: dto.notify_exit },
    });
    return { ok: true };
  }
}
