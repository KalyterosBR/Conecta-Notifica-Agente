import { BadRequestException, NotFoundException } from '@nestjs/common';
import { hashChave } from '../agente/chave-api.guard';
import { InstanciasService } from '../provedores/instancias.service';
import { UazapiAdminService } from '../provedores/uazapi.admin';
import { ConfiguracoesService } from './configuracoes.service';
import { EnviosService } from './envios.service';
import { ModelosService } from './modelos.service';
import { TEMPLATE_PADRAO, variaveisDesconhecidas } from '../notificacoes/template';
import { ResponsaveisService } from './responsaveis.service';
import { inicioDoDia } from './util';

const U = { id: 'u1', schoolId: 'esc-1', role: 'school' };

describe('inicioDoDia', () => {
  it('meia-noite de São Paulo em UTC', () => {
    // 25/08/2026 10:30Z = 07:30 em SP; meia-noite local = 03:00Z.
    const r = inicioDoDia('America/Sao_Paulo', new Date('2026-08-25T10:30:00Z'));
    expect(r.toISOString()).toBe('2026-08-25T03:00:00.000Z');
  });

  it('virada de dia no fuso: 01:00Z ainda é o dia anterior em SP', () => {
    const r = inicioDoDia('America/Sao_Paulo', new Date('2026-08-25T01:00:00Z'));
    expect(r.toISOString()).toBe('2026-08-24T03:00:00.000Z');
  });
});

describe('EnviosService.reenviar', () => {
  function montar(status: string) {
    const msg: any = {
      id: 'm1',
      status,
      error: 'uazapi 500',
      accessEvent: { id: 'ev-1', schoolId: 'esc-1' },
    };
    const prisma = {
      message: {
        findFirst: async ({ where }: any) =>
          where.id === 'm1' && where.accessEvent.schoolId === 'esc-1' ? msg : null,
        update: async ({ data }: any) => Object.assign(msg, data),
      },
    };
    const fila = { reenfileirados: [] as any[], reenfileirar: async (t: any) => (fila.reenfileirados.push(t), true) };
    return { msg, fila, service: new EnviosService(prisma as any, fila as any) };
  }

  it('mensagem FAILED volta para QUEUED e re-enfileira o evento', async () => {
    const { msg, fila, service } = montar('FAILED');
    await service.reenviar(U, 'm1');
    expect(msg).toMatchObject({ status: 'QUEUED', error: null });
    expect(fila.reenfileirados).toEqual([{ accessEventId: 'ev-1', schoolId: 'esc-1' }]);
  });

  it('mensagem já enviada não pode ser reenviada', async () => {
    const { service } = montar('SENT');
    await expect(service.reenviar(U, 'm1')).rejects.toThrow(BadRequestException);
  });

  it('mensagem de outra escola é 404', async () => {
    const { service } = montar('FAILED');
    await expect(
      service.reenviar({ ...U, schoolId: 'esc-2' }, 'm1'),
    ).rejects.toThrow(NotFoundException);
  });
});

describe('ConfiguracoesService', () => {
  function montar() {
    const escola: any = {
      id: 'esc-1',
      name: 'Demo',
      timezone: 'America/Sao_Paulo',
      plan: 'basico',
      providerConfig: { provider: 'uazapi', webhook_token: 'tok-original' },
      settings: null,
    };
    const chaves: any[] = [{ id: 'k1', schoolId: 'esc-1', revokedAt: null, createdAt: new Date(0), keyHash: 'antigo' }];
    const chips: any[] = [];
    const prisma = {
      school: {
        findUnique: async () => ({ ...escola }),
        update: async ({ data }: any) => Object.assign(escola, data),
      },
      agentApiKey: {
        findFirst: async () => chaves.filter((k) => !k.revokedAt).at(-1) ?? null,
        updateMany: async ({ data }: any) => {
          chaves.forEach((k) => !k.revokedAt && Object.assign(k, data));
          return { count: 1 };
        },
        create: async ({ data }: any) => {
          chaves.push({ id: `k${chaves.length + 1}`, createdAt: new Date(), revokedAt: null, ...data });
        },
      },
      schoolSettings: {
        upsert: async ({ create }: any) => (escola.settings = { ...escola.settings, ...create }),
      },
      student: { count: async () => 0 },
      whatsappInstance: {
        findMany: async () => chips,
        findUnique: async ({ where }: any) => chips.find((c) => c.id === where.id) ?? null,
        upsert: async ({ create, update }: any) => {
          const existente = chips.find((c) => c.name === create.name);
          if (existente) return Object.assign(existente, update);
          const novo = { id: `chip-${chips.length + 1}`, createdAt: new Date(), ...create };
          chips.push(novo);
          return novo;
        },
      },
    };
    // A conexão do WhatsApp tem suíte própria (provedores/instancias.spec.ts);
    // aqui só interessam as regras e a chave do agente.
    const uazapi = new UazapiAdminService();
    const instancias = new InstanciasService(prisma as any, uazapi);
    return { escola, chaves, chips, service: new ConfiguracoesService(prisma as any, uazapi, instancias) };
  }

  it('regenerar chave revoga a antiga e a nova bate com o hash guardado', async () => {
    const { chaves, service } = montar();
    const { api_key } = await service.regenerarChaveAgente(U);

    expect(api_key.startsWith('cn_')).toBe(true);
    expect(chaves[0].revokedAt).toBeInstanceOf(Date);
    expect(chaves[1].keyHash).toBe(hashChave(api_key));
  });

  it('cadastro manual vira um chip e preserva o webhook_token existente', async () => {
    const { chips, service } = montar();
    const r = await service.conectarWhatsapp(U, {
      base_url: 'https://x.uazapi.com',
      token: 'tok-instancia',
    });
    expect(r.webhook_token).toBe('tok-original');
    expect(chips).toHaveLength(1);
    expect(chips[0]).toMatchObject({
      name: 'manual-1',
      baseUrl: 'https://x.uazapi.com',
      token: 'tok-instancia',
      status: 'connected',
    });
  });

  it('token da instância nunca volta no GET de configurações', async () => {
    const { service } = montar();
    await service.conectarWhatsapp(U, { base_url: 'https://x', token: 'segredo' });
    const cfg = await service.obter(U);
    expect(JSON.stringify(cfg)).not.toContain('segredo');
    expect(cfg.whatsapp.conectado).toBe(true);
  });
});

describe('ResponsaveisService', () => {
  function montar() {
    const guardians: any[] = [];
    const vinculos: any[] = [];
    const prisma = {
      student: {
        findMany: async ({ where }: any) =>
          [{ id: 'alu-1', schoolId: 'esc-1' }].filter(
            (s) => where.id.in.includes(s.id) && s.schoolId === where.schoolId,
          ),
        findFirst: async () => ({ id: 'alu-1' }),
      },
      guardian: {
        create: async ({ data }: any) => {
          const g = { id: 'g1', ...data };
          guardians.push(g);
          return g;
        },
        findFirst: async ({ where }: any) => guardians.find((g) => g.id === where.id) ?? null,
        update: async ({ where, data }: any) => {
          const g = guardians.find((x) => x.id === where.id);
          for (const [k, v] of Object.entries(data)) if (v !== undefined) g[k] = v;
          return g;
        },
      },
      studentGuardian: {
        create: async ({ data }: any) => (vinculos.push(data), data),
      },
    };
    return { guardians, vinculos, service: new ResponsaveisService(prisma as any) };
  }

  it('cria responsável com opt-in datado e vincula ao aluno', async () => {
    const { guardians, vinculos, service } = montar();
    await service.criar(U, {
      name: 'Maria',
      phone: '+5511999990000',
      opt_in: true,
      student_ids: ['alu-1'],
      notify_exit: false,
    });
    expect(guardians[0].optInAt).toBeInstanceOf(Date);
    expect(vinculos[0]).toMatchObject({ studentId: 'alu-1', notifyEntry: true, notifyExit: false });
  });

  it('sem opt-in fica sem data (worker não envia)', async () => {
    const { guardians, service } = montar();
    await service.criar(U, {
      name: 'José',
      phone: '+5511888880000',
      opt_in: false,
      student_ids: ['alu-1'],
    });
    expect(guardians[0].optInAt).toBeNull();
  });

  it('aluno de outra escola é rejeitado', async () => {
    const { service } = montar();
    await expect(
      service.criar(U, {
        name: 'X',
        phone: '+5511777770000',
        opt_in: true,
        student_ids: ['alu-de-outra-escola'],
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('opt-out registra a data e para os envios', async () => {
    const { guardians, service } = montar();
    await service.criar(U, {
      name: 'Maria',
      phone: '+5511999990000',
      opt_in: true,
      student_ids: ['alu-1'],
    });
    await service.atualizar(U, 'g1', { opt_in: false });
    expect(guardians[0].optOutAt).toBeInstanceOf(Date);
  });
});

describe('ModelosService', () => {
  function montar(linhas: { eventType: string; body: string }[] = []) {
    const prisma = {
      messageTemplate: {
        findMany: async ({ where }: any) =>
          linhas.filter(() => where.schoolId === 'esc-1').map((l) => ({ ...l })),
        upsert: async ({ where, create, update }: any) => {
          const { schoolId, eventType } = where.schoolId_eventType;
          const atual = linhas.find((l) => l.eventType === eventType && schoolId === 'esc-1');
          if (atual) return Object.assign(atual, update);
          const novo = { ...create };
          linhas.push(novo);
          return novo;
        },
        deleteMany: async ({ where }: any) => {
          for (let i = linhas.length - 1; i >= 0; i--) {
            if (where.schoolId === 'esc-1' && linhas[i].eventType === where.eventType) {
              linhas.splice(i, 1);
            }
          }
          return { count: 0 };
        },
      },
    };
    return { linhas, service: new ModelosService(prisma as any) };
  }

  it('sem linha na tabela devolve o padrão do sistema', async () => {
    const { service } = montar();
    const r = await service.listar(U);
    expect(r.modelos.in).toEqual({ body: TEMPLATE_PADRAO.IN, personalizado: false });
    expect(r.modelos.out.personalizado).toBe(false);
    expect(r.variaveis).toContain('{aluno}');
  });

  it('salvar grava o corpo sem espaços nas pontas e marca personalizado', async () => {
    const { linhas, service } = montar();
    const r = await service.salvar(U, 'in', { body: '  Oi {responsavel}, {aluno} chegou.  ' });
    expect(r).toEqual({ ok: true, body: 'Oi {responsavel}, {aluno} chegou.', personalizado: true });
    expect(linhas).toEqual([
      { schoolId: 'esc-1', eventType: 'IN', body: 'Oi {responsavel}, {aluno} chegou.' },
    ]);
    expect((await service.listar(U)).modelos.in.personalizado).toBe(true);
  });

  it('salvar de novo atualiza a linha existente', async () => {
    const { linhas, service } = montar([{ eventType: 'IN', body: 'antigo {aluno}' }]);
    await service.salvar(U, 'in', { body: 'novo {aluno}' });
    expect(linhas).toEqual([{ eventType: 'IN', body: 'novo {aluno}' }]);
  });

  it('variável inexistente é recusada antes de virar mensagem torta', async () => {
    const { service } = montar();
    await expect(service.salvar(U, 'in', { body: '{aluno} da {turma} chegou' })).rejects.toThrow(
      /\{turma\}/,
    );
  });

  it('tipo fora de in/out é 400', async () => {
    const { service } = montar();
    await expect(service.salvar(U, 'optin', { body: 'oi {aluno}' })).rejects.toThrow(
      BadRequestException,
    );
  });

  it('restaurar apaga a linha e o envio volta ao padrão', async () => {
    const { linhas, service } = montar([{ eventType: 'OUT', body: 'personalizado {aluno}' }]);
    const r = await service.restaurar(U, 'out');
    expect(r).toEqual({ ok: true, body: TEMPLATE_PADRAO.OUT, personalizado: false });
    expect(linhas).toEqual([]);
  });
});

describe('variaveisDesconhecidas', () => {
  it('aceita as quatro variáveis do doc', () => {
    expect(
      variaveisDesconhecidas('{responsavel} {aluno} {hora} {escola}'),
    ).toEqual([]);
  });

  it('lista cada desconhecida uma vez só', () => {
    expect(variaveisDesconhecidas('{turma} e {turma} e {rg}')).toEqual(['{turma}', '{rg}']);
  });

  it('emoji e chave solta não viram variável', () => {
    expect(variaveisDesconhecidas('✅ {aluno} entrou } {')).toEqual([]);
  });
});
