import {
  CenarioVinculo,
  FakePrismaNotificacao,
  FakeProvedor,
} from '../agente/fake-prisma.spec-util';
import { NotificadorService } from './notificador.service';

// Terça-feira 25/08/2026 07:30 em São Paulo (10:30Z).
const MANHA_DE_TERCA = new Date('2026-08-25T10:30:00Z');
const SABADO = new Date('2026-08-29T13:00:00Z'); // sábado 10:00 em SP
const MADRUGADA = new Date('2026-08-25T06:10:00Z'); // terça 03:10 em SP

function vinculo(sobre: Partial<CenarioVinculo['guardian']> = {}, extras: Partial<CenarioVinculo> = {}): CenarioVinculo {
  return {
    guardian: {
      id: sobre.id ?? 'resp-1',
      name: 'Maria',
      phoneE164: '+5511999990000',
      optInAt: new Date('2026-01-10'),
      optOutAt: null,
      ...sobre,
    },
    ...extras,
  };
}

function montar() {
  const prisma = new FakePrismaNotificacao();
  const provedor = new FakeProvedor();
  // Chips da escola: `semChip` simula o WhatsApp ainda não conectado.
  const usos: string[] = [];
  const instancias = {
    paraEnvio: async (schoolId: string) => {
      const escola = prisma.escolas.find((e: any) => e.id === schoolId);
      return escola?.semChip ? null : { id: 'chip-1', provedor: provedor as any };
    },
    registrarUso: async (id: string) => void usos.push(id),
  };
  const service = new NotificadorService(prisma as any, instancias as any);

  prisma.escolas.push({
    id: 'esc-1',
    name: 'Escola Demo',
    timezone: 'America/Sao_Paulo',
    providerConfig: { provider: 'uazapi' },
  });
  prisma.alunos.push({
    id: 'alu-1',
    schoolId: 'esc-1',
    externalId: '77',
    name: 'Ana Souza',
    active: true,
    syncedAt: new Date(),
  });

  const evento = (id: string, quando: Date, direction = 'IN') => {
    prisma.eventos.push({
      id,
      schoolId: 'esc-1',
      studentId: 'alu-1',
      externalEventId: `ext-${id}`,
      direction,
      occurredAt: quando,
    });
  };
  return { prisma, provedor, service, evento, usos };
}

describe('NotificadorService — regras antes do envio (doc §2.4)', () => {
  it('caminho feliz: renderiza o template e marca SENT', async () => {
    const { prisma, provedor, service, evento } = montar();
    prisma.vinculos.set('alu-1', [vinculo()]);
    prisma.escolas[0].templates = [
      { eventType: 'IN', body: '{responsavel}, {aluno} chegou na {escola} às {hora}!' },
    ];
    evento('ev-1', MANHA_DE_TERCA);

    const r = await service.processar('ev-1');

    expect(r).toEqual({ status: 'enviado', enviadas: 1 });
    expect(provedor.enviados[0]).toEqual({
      telefone: '+5511999990000',
      texto: 'Maria, Ana Souza chegou na Escola Demo às 07:30!',
    });
    expect(prisma.mensagens[0]).toMatchObject({
      status: 'SENT',
      providerMessageId: 'prov-1',
      attempts: 1,
    });
  });

  it('dedupe: segundo giro do mesmo aluno na mesma direção em N minutos não notifica', async () => {
    const { prisma, provedor, service, evento } = montar();
    prisma.vinculos.set('alu-1', [vinculo()]);
    evento('ev-1', MANHA_DE_TERCA);
    evento('ev-2', new Date(MANHA_DE_TERCA.getTime() + 60_000)); // +1 min

    await service.processar('ev-1');
    const r = await service.processar('ev-2');

    expect(r.status).toBe('pulado_dedupe');
    expect(provedor.enviados).toHaveLength(1);
  });

  it('direção diferente dentro da janela de dedupe notifica normalmente', async () => {
    const { prisma, service, evento } = montar();
    prisma.vinculos.set('alu-1', [vinculo()]);
    evento('ev-1', MANHA_DE_TERCA, 'IN');
    evento('ev-2', new Date(MANHA_DE_TERCA.getTime() + 60_000), 'OUT');

    await service.processar('ev-1');
    const r = await service.processar('ev-2');
    expect(r.status).toBe('enviado');
  });

  it('fora da janela de horário não notifica', async () => {
    const { provedor, service, evento, prisma } = montar();
    prisma.vinculos.set('alu-1', [vinculo()]);
    evento('ev-1', MADRUGADA);

    const r = await service.processar('ev-1');
    expect(r.status).toBe('pulado_janela');
    expect(provedor.enviados).toHaveLength(0);
  });

  it('fim de semana só notifica com notify_weekends ligado', async () => {
    const { prisma, service, evento } = montar();
    prisma.vinculos.set('alu-1', [vinculo()]);
    evento('ev-1', SABADO);

    expect((await service.processar('ev-1')).status).toBe('pulado_fim_de_semana');

    prisma.escolas[0].settings = { notifyWeekends: true };
    prisma.eventos.push({ ...(prisma.eventos[0] as any), id: 'ev-2', externalEventId: 'x2' });
    expect((await service.processar('ev-2')).status).toBe('enviado');
  });

  it('sem opt-in não envia (LGPD); opt-out também bloqueia', async () => {
    const { prisma, provedor, service, evento } = montar();
    prisma.vinculos.set('alu-1', [
      vinculo({ id: 'r1', optInAt: null }),
      vinculo({ id: 'r2', optOutAt: new Date() }),
    ]);
    evento('ev-1', MANHA_DE_TERCA);

    const r = await service.processar('ev-1');
    expect(r.status).toBe('sem_responsavel');
    expect(provedor.enviados).toHaveLength(0);
  });

  it('toggle notify_entry/notify_exit do vínculo é respeitado', async () => {
    const { prisma, provedor, service, evento } = montar();
    prisma.vinculos.set('alu-1', [
      vinculo({ id: 'r1', phoneE164: '+5511911111111' }, { notifyEntry: false }),
      vinculo({ id: 'r2', phoneE164: '+5511922222222' }, { notifyEntry: true }),
    ]);
    evento('ev-1', MANHA_DE_TERCA, 'IN');

    const r = await service.processar('ev-1');
    expect(r.enviadas).toBe(1);
    expect(provedor.enviados[0].telefone).toBe('+5511922222222');
  });

  it('nenhum chip conectado marca FAILED para reenvio pós-onboarding', async () => {
    const { prisma, service, evento } = montar();
    prisma.escolas[0].semChip = true;
    prisma.vinculos.set('alu-1', [vinculo()]);
    evento('ev-1', MANHA_DE_TERCA);

    const r = await service.processar('ev-1');
    expect(r.status).toBe('sem_provedor');
    expect(prisma.mensagens[0]).toMatchObject({
      status: 'FAILED',
      error: 'provedor não configurado',
    });
  });

  it('escola bloqueada não notifica, e o evento continua gravado', async () => {
    const { prisma, provedor, service, evento } = montar();
    prisma.escolas[0].blocked = true;
    prisma.escolas[0].blockedReason = 'mensalidade em atraso';
    prisma.vinculos.set('alu-1', [vinculo()]);
    evento('ev-1', MANHA_DE_TERCA);

    const r = await service.processar('ev-1');
    expect(r).toMatchObject({ status: 'bloqueado', enviadas: 0, detalhe: 'mensalidade em atraso' });
    expect(provedor.enviados).toHaveLength(0);
    // Nada de mensagem FAILED: bloqueio não é falha de envio para reprocessar.
    expect(prisma.mensagens).toHaveLength(0);
  });

  it('o chip usado é marcado para o rodízio', async () => {
    const { prisma, service, evento, usos } = montar();
    prisma.vinculos.set('alu-1', [vinculo()]);
    evento('ev-1', MANHA_DE_TERCA);

    await service.processar('ev-1');
    expect(usos).toEqual(['chip-1']);
  });

  it('falha parcial: lança para retry, e o retry não reenvia quem já recebeu', async () => {
    const { prisma, provedor, service, evento } = montar();
    prisma.vinculos.set('alu-1', [
      vinculo({ id: 'r1', phoneE164: '+5511911111111' }),
      vinculo({ id: 'r2', phoneE164: '+5511922222222' }),
    ]);
    evento('ev-1', MANHA_DE_TERCA);
    provedor.falharPara.add('+5511922222222');

    await expect(service.processar('ev-1')).rejects.toThrow('falha em 1 envio');
    expect(provedor.enviados).toHaveLength(1);
    expect(prisma.mensagens.find((m) => m.guardianId === 'r2')).toMatchObject({
      status: 'FAILED',
      attempts: 1,
    });

    // Provedor se recupera; retry do job:
    provedor.falharPara.clear();
    const r = await service.processar('ev-1');
    expect(r).toEqual({ status: 'enviado', enviadas: 1 }); // só o r2
    expect(provedor.enviados.map((e) => e.telefone)).toEqual([
      '+5511911111111',
      '+5511922222222',
    ]);
    expect(prisma.mensagens.find((m) => m.guardianId === 'r2')).toMatchObject({
      status: 'SENT',
      attempts: 2,
      error: null,
    });
  });
});
