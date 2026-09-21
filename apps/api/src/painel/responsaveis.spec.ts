import { NotFoundException } from '@nestjs/common';
import { ContextoUsuario } from '../auth/painel.guard';
import { ResponsaveisService } from './responsaveis.service';

const U: ContextoUsuario = { id: 'u1', schoolId: 'esc-1', role: 'school' };

/** Prisma de mentira com alunos, responsáveis e vínculos em memória. */
function montar() {
  const alunos: any[] = [
    { id: 'alu-1', schoolId: 'esc-1', externalId: '1001', name: 'Ana', className: '5A' },
    { id: 'alu-2', schoolId: 'esc-1', externalId: '1002', name: 'Bruno', className: '5A' },
    { id: 'alu-x', schoolId: 'esc-2', externalId: '9999', name: 'De outra escola', className: null },
  ];
  const guardians: any[] = [];
  const vinculos: any[] = [];

  const prisma = {
    student: {
      findMany: async ({ where }: any) =>
        alunos.filter(
          (a) =>
            a.schoolId === where.schoolId &&
            (!where.externalId || where.externalId.in.includes(a.externalId)) &&
            (!where.id || where.id.in.includes(a.id)),
        ),
      findFirst: async ({ where }: any) =>
        alunos.find((a) => a.id === where.id && a.schoolId === where.schoolId) ?? null,
    },
    guardian: {
      count: async () => guardians.length,
      findMany: async () =>
        guardians.map((g) => ({
          ...g,
          students: vinculos
            .filter((v) => v.guardianId === g.id)
            .map((v) => ({ ...v, student: alunos.find((a) => a.id === v.studentId) })),
        })),
      findFirst: async ({ where }: any) =>
        guardians.find(
          (g) =>
            g.schoolId === where.schoolId &&
            (where.phoneE164 ? g.phoneE164 === where.phoneE164 : g.id === where.id),
        ) ?? null,
      create: async ({ data }: any) => {
        const g = { id: `g${guardians.length + 1}`, optOutAt: null, ...data };
        guardians.push(g);
        return g;
      },
    },
    studentGuardian: {
      findUnique: async ({ where }: any) =>
        vinculos.find(
          (v) =>
            v.studentId === where.studentId_guardianId.studentId &&
            v.guardianId === where.studentId_guardianId.guardianId,
        ) ?? null,
      create: async ({ data }: any) => {
        const v = { notifyEntry: true, notifyExit: true, ...data };
        vinculos.push(v);
        return v;
      },
      upsert: async ({ where, create }: any) => {
        const existente = vinculos.find(
          (v) =>
            v.studentId === where.studentId_guardianId.studentId &&
            v.guardianId === where.studentId_guardianId.guardianId,
        );
        if (existente) return existente;
        const v = { notifyEntry: true, notifyExit: true, ...create };
        vinculos.push(v);
        return v;
      },
      deleteMany: async ({ where }: any) => {
        const antes = vinculos.length;
        for (let i = vinculos.length - 1; i >= 0; i--) {
          if (vinculos[i].guardianId === where.guardianId && vinculos[i].studentId === where.studentId) {
            vinculos.splice(i, 1);
          }
        }
        return { count: antes - vinculos.length };
      },
    },
  };
  return { alunos, guardians, vinculos, service: new ResponsaveisService(prisma as any) };
}

describe('ResponsaveisService — importação por planilha', () => {
  it('cria responsável, normaliza o telefone e vincula pelo ID da catraca', async () => {
    const { guardians, vinculos, service } = montar();
    const r = await service.importar(U, {
      opt_in: true,
      linhas: [
        { aluno_external_id: '1001', nome: 'Maria', telefone: '(81) 99999-0000', parentesco: 'mãe' },
      ],
    });

    expect(r).toMatchObject({ criados: 1, vinculados: 1, total: 1, erros: [] });
    expect(guardians[0].phoneE164).toBe('+5581999990000');
    expect(guardians[0].optInAt).toBeInstanceOf(Date);
    expect(vinculos[0]).toMatchObject({ studentId: 'alu-1', guardianId: 'g1' });
  });

  it('mesmo telefone em dois filhos vira um responsável com dois vínculos', async () => {
    const { guardians, vinculos, service } = montar();
    const r = await service.importar(U, {
      linhas: [
        { aluno_external_id: '1001', nome: 'Maria', telefone: '81999990000' },
        { aluno_external_id: '1002', nome: 'Maria Silva', telefone: '(81) 99999-0000' },
      ],
    });

    expect(r).toMatchObject({ criados: 1, vinculados: 2 });
    expect(guardians).toHaveLength(1);
    expect(vinculos.map((v) => v.studentId).sort()).toEqual(['alu-1', 'alu-2']);
  });

  it('linha com aluno inexistente ou telefone inválido volta com o motivo', async () => {
    const { guardians, service } = montar();
    const r = await service.importar(U, {
      linhas: [
        { aluno_external_id: '0000', nome: 'Fantasma', telefone: '81999990000' },
        { aluno_external_id: '1001', nome: 'Sem telefone', telefone: 'não informou' },
        { aluno_external_id: '1001', nome: 'Boa', telefone: '81988880000' },
      ],
    });

    expect(r.criados).toBe(1);
    expect(r.erros).toEqual([
      { linha: 1, motivo: 'aluno 0000 não existe no cadastro' },
      { linha: 2, motivo: 'telefone inválido: não informou' },
    ]);
    // A linha boa entrou mesmo com as outras falhando.
    expect(guardians).toHaveLength(1);
  });

  it('reimportar a mesma planilha não duplica nada', async () => {
    const { guardians, vinculos, service } = montar();
    const linhas = [{ aluno_external_id: '1001', nome: 'Maria', telefone: '81999990000' }];
    await service.importar(U, { linhas });
    const segunda = await service.importar(U, { linhas });

    expect(segunda).toMatchObject({ criados: 0, vinculados: 0 });
    expect(guardians).toHaveLength(1);
    expect(vinculos).toHaveLength(1);
  });

  it('aluno de outra escola não é alcançado pela planilha', async () => {
    const { service } = montar();
    const r = await service.importar(U, {
      linhas: [{ aluno_external_id: '9999', nome: 'X', telefone: '81999990000' }],
    });
    expect(r.criados).toBe(0);
    expect(r.erros[0].motivo).toMatch(/não existe/);
  });
});

describe('ResponsaveisService — vínculos', () => {
  it('vincular e desvincular um aluno mantém o responsável', async () => {
    const { guardians, vinculos, service } = montar();
    await service.criar(U, {
      name: 'Maria',
      phone: '+5581999990000',
      student_ids: ['alu-1'],
    } as any);

    await service.vincular(U, guardians[0].id, { student_id: 'alu-2' });
    expect(vinculos).toHaveLength(2);

    await service.desvincular(U, guardians[0].id, 'alu-2');
    expect(vinculos).toHaveLength(1);
    expect(guardians).toHaveLength(1);
  });

  it('vincular aluno de outra escola é 404', async () => {
    const { guardians, service } = montar();
    await service.criar(U, { name: 'M', phone: '+55819', student_ids: ['alu-1'] } as any);
    await expect(
      service.vincular(U, guardians[0].id, { student_id: 'alu-x' }),
    ).rejects.toThrow(NotFoundException);
  });
});
