import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { AdminService } from './admin.service';

/** Prisma de mentira: só o que o admin toca, com contadores previsíveis. */
function montar(escolaInicial: any = {}) {
  const escola = {
    id: 'esc-1',
    name: 'Escola Demo',
    cnpj: null,
    plan: 'basico',
    maxStudents: null,
    maxInstances: 1,
    blocked: false,
    blockedReason: null,
    blockedAt: null,
    billingStatus: 'EM_DIA',
    invoiceIssued: false,
    lastInvoiceAt: null,
    billingSyncedAt: null,
    notes: null,
    contaAzulId: null,
    createdAt: new Date(0),
    ...escolaInicial,
  };
  const contagens = { alunos: 3, chips: 1, conectados: 1, mensagens: 12, falhas: 0 };
  const chave = { lastSeenAt: new Date() };
  const criadas: any[] = [];

  const prisma = {
    school: {
      count: async () => 1,
      findMany: async () => [escola],
      findUnique: async ({ where }: any) =>
        where.cnpj ? (escola.cnpj === where.cnpj ? escola : null) : where.id === escola.id ? escola : null,
      update: async ({ data }: any) => Object.assign(escola, limpar(data)),
      create: async ({ data }: any) => {
        const nova = { ...escola, id: 'esc-2', name: data.name, cnpj: data.cnpj ?? null };
        criadas.push(data);
        return nova;
      },
    },
    user: {
      // Por e-mail = checagem de duplicado (nunca há); por id = o operador.
      findUnique: async ({ where }: any) => (where.email ? null : { name: 'Operador' }),
    },
    student: { count: async () => contagens.alunos },
    whatsappInstance: {
      count: async ({ where }: any) => (where.status ? contagens.conectados : contagens.chips),
    },
    agentApiKey: { findFirst: async () => chave },
    message: {
      count: async ({ where }: any) => (where?.status ? contagens.falhas : contagens.mensagens),
      findMany: async () => [],
    },
  };
  // O monitoramento tem suíte própria; aqui só precisa devolver uma lista.
  const monitoramento = { agentesMudos: async () => [] };
  const assinados: any[] = [];
  const jwt = {
    signAsync: async (payload: any, opts: any) => {
      assinados.push({ payload, opts });
      return 'token-fake';
    },
  };
  return {
    escola,
    chave,
    contagens,
    criadas,
    assinados,
    service: new AdminService(prisma as any, monitoramento as any, jwt as any),
  };
}

function limpar(o: any) {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
}

describe('AdminService — contratos e bloqueio', () => {
  it('cria escola com CNPJ limpo e devolve senha e API key uma única vez', async () => {
    const { criadas, service } = montar();
    const r = await service.criar({
      nome: 'Escola Nova',
      email: 'direcao@nova.com.br',
      cnpj: '12.345.678/0001-99',
      max_alunos: 200,
      max_chips: 2,
    });

    expect(criadas[0].cnpj).toBe('12345678000199');
    expect(criadas[0].maxStudents).toBe(200);
    expect(criadas[0].maxInstances).toBe(2);
    expect(r.senha).toHaveLength(8);
    expect(r.api_key.startsWith('cn_')).toBe(true);
  });

  it('CNPJ com menos de 14 dígitos é recusado', async () => {
    const { service } = montar();
    await expect(
      service.criar({ nome: 'X', email: 'a@b.com', cnpj: '123.456/00-1' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('CNPJ já usado por outra escola dá conflito', async () => {
    const { service } = montar({ cnpj: '12345678000199' });
    await expect(
      service.criar({ nome: 'X', email: 'a@b.com', cnpj: '12.345.678/0001-99' }),
    ).rejects.toThrow(ConflictException);
  });

  it('max_alunos = 0 significa sem teto', async () => {
    const { escola, service } = montar({ maxStudents: 500 });
    await service.atualizar('esc-1', { max_alunos: 0 });
    expect(escola.maxStudents).toBeNull();
  });

  it('bloquear guarda motivo e data; desbloquear limpa os dois', async () => {
    const { escola, service } = montar();
    await service.bloquear('esc-1', { bloqueado: true, motivo: 'mensalidade em atraso' });
    expect(escola.blocked).toBe(true);
    expect(escola.blockedReason).toBe('mensalidade em atraso');
    expect(escola.blockedAt).toBeInstanceOf(Date);

    await service.bloquear('esc-1', { bloqueado: false });
    expect(escola.blocked).toBe(false);
    expect(escola.blockedReason).toBeNull();
    expect(escola.blockedAt).toBeNull();
  });

  it('bloqueio sem motivo ainda registra um motivo legível', async () => {
    const { escola, service } = montar();
    await service.bloquear('esc-1', { bloqueado: true });
    expect(escola.blockedReason).toBe('bloqueio administrativo');
  });

  it('cobrança marca quando foi atualizada — é o gancho do Conta Azul', async () => {
    const { escola, service } = montar();
    await service.cobranca('esc-1', { status: 'atrasado', nota_emitida: true });
    expect(escola.billingStatus).toBe('ATRASADO');
    expect(escola.invoiceIssued).toBe(true);
    expect(escola.lastInvoiceAt).toBeInstanceOf(Date);
    expect(escola.billingSyncedAt).toBeInstanceOf(Date);
  });

  it('escola some da saúde quando falta qualquer peça', async () => {
    const cenario = montar();
    const ok = (await cenario.service.listar()).escolas[0];
    expect(ok.saudavel).toBe(true);
    expect(ok.uso).toMatchObject({ alunos: 3, chips_conectados: 1, mensagens_mes: 12 });

    // Agente mudo há dez minutos derruba a saúde.
    cenario.chave.lastSeenAt = new Date(Date.now() - 600_000);
    expect((await cenario.service.listar()).escolas[0].saudavel).toBe(false);
  });

  it('aponta quando o cadastro passou do teto contratado', async () => {
    const { service } = montar({ maxStudents: 2 });
    const e = (await service.listar()).escolas[0];
    expect(e.uso.alunos_acima_do_teto).toBe(true);
  });

  it('impersonar emite token curto, marcado, e mantém o sub do operador', async () => {
    const { assinados, service } = montar();
    const r = await service.impersonar('adm-1', 'esc-1');

    expect(r).toMatchObject({ token: 'token-fake', escola: 'Escola Demo', expira_em_minutos: 30 });
    expect(assinados[0].payload).toMatchObject({
      sub: 'adm-1',
      schoolId: 'esc-1',
      impersonando: true,
    });
    expect(assinados[0].opts).toEqual({ expiresIn: '30m' });
  });

  it('escola inexistente é 404, não 500', async () => {
    const { service } = montar();
    await expect(service.detalhe('nao-existe')).rejects.toThrow(NotFoundException);
    await expect(service.bloquear('nao-existe', { bloqueado: true })).rejects.toThrow(NotFoundException);
    await expect(service.impersonar('adm-1', 'nao-existe')).rejects.toThrow(NotFoundException);
  });
});
