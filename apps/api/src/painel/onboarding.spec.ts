import { ContextoUsuario } from '../auth/painel.guard';
import { OnboardingService } from './onboarding.service';

const U: ContextoUsuario = { id: 'u1', schoolId: 'esc-1', role: 'school' };

function montar(cenario: {
  lastSeenAt?: Date | null;
  chips?: { conectado: boolean }[];
  alunos?: number;
  semResponsavel?: number;
  responsaveis?: number;
}) {
  const prisma = {
    school: {
      findUnique: async () => ({ name: 'Escola X', maxInstances: 2, blocked: false }),
    },
    agentApiKey: {
      findFirst: async () =>
        cenario.lastSeenAt === undefined
          ? null
          : { createdAt: new Date(0), lastSeenAt: cenario.lastSeenAt },
    },
    student: {
      count: async ({ where }: any) =>
        where.guardians ? (cenario.semResponsavel ?? 0) : (cenario.alunos ?? 0),
    },
    guardian: { count: async () => cenario.responsaveis ?? 0 },
  };
  const instancias = { listar: async () => cenario.chips ?? [] };
  return new OnboardingService(prisma as any, instancias as any);
}

const passo = (r: any, id: string) => r.passos.find((p: any) => p.id === id);

describe('OnboardingService', () => {
  it('escola nova tem os três passos abertos', async () => {
    const r = await montar({}).estado(U);
    expect(r.concluido).toBe(false);
    expect(r.passos.map((p) => p.concluido)).toEqual([false, false, false]);
    expect(passo(r, 'agente').detalhe).toMatch(/nenhum sinal/);
  });

  it('agente que já falou fecha o passo mesmo estando offline agora', async () => {
    // Reinício de serviço não pode reabrir um passo já vencido.
    const r = await montar({ lastSeenAt: new Date(Date.now() - 3 * 3600_000) }).estado(U);
    expect(passo(r, 'agente').concluido).toBe(true);
    expect(r.agente.online).toBe(false);
  });

  it('chip conectado fecha o passo do WhatsApp', async () => {
    const r = await montar({ chips: [{ conectado: false }, { conectado: true }] }).estado(U);
    expect(passo(r, 'whatsapp').concluido).toBe(true);
  });

  it('sem aluno sincronizado, o passo dos responsáveis não fecha sozinho', async () => {
    // 0 alunos e 0 sem responsável não é "tudo pronto" — é "nada chegou".
    const r = await montar({ alunos: 0, semResponsavel: 0 }).estado(U);
    expect(passo(r, 'responsaveis').concluido).toBe(false);
    expect(passo(r, 'responsaveis').detalhe).toMatch(/Aguardando/);
  });

  it('conta quantos alunos faltam vincular', async () => {
    const r = await montar({ alunos: 10, semResponsavel: 3 }).estado(U);
    expect(passo(r, 'responsaveis').concluido).toBe(false);
    expect(passo(r, 'responsaveis').detalhe).toBe('3 de 10 alunos ainda sem responsável');
  });

  it('tudo de pé marca o onboarding como concluído', async () => {
    const r = await montar({
      lastSeenAt: new Date(),
      chips: [{ conectado: true }],
      alunos: 10,
      semResponsavel: 0,
      responsaveis: 8,
    }).estado(U);
    expect(r.concluido).toBe(true);
    expect(r.agente.online).toBe(true);
  });

  it('respeita o teto de chips do contrato ao oferecer mais um número', async () => {
    const cheio = await montar({ chips: [{ conectado: true }, { conectado: true }] }).estado(U);
    expect(cheio.whatsapp.pode_adicionar).toBe(false);

    const sobrando = await montar({ chips: [{ conectado: true }] }).estado(U);
    expect(sobrando.whatsapp.pode_adicionar).toBe(true);
  });
});
