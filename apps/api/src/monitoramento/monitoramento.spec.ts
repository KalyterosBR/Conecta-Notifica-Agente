import { Alerta, AlertasCanal } from './alertas.canal';
import { MonitoramentoService } from './monitoramento.service';

const MINUTO = 60_000;
// Terça-feira, 10h em São Paulo (13h UTC) — dentro da janela padrão.
const EXPEDIENTE = new Date('2026-09-01T13:00:00Z');
// Mesma terça, 3h da manhã em São Paulo (6h UTC) — fora da janela.
const MADRUGADA = new Date('2026-09-01T06:00:00Z');
// Domingo, 10h.
const DOMINGO = new Date('2026-08-30T13:00:00Z');

class CanalFake extends AlertasCanal {
  enviados: Alerta[] = [];
  override async enviar(a: Alerta) {
    this.enviados.push(a);
  }
}

function montar(
  chaves: { lastSeenAt: Date | null; alertedAt?: Date | null; blocked?: boolean }[],
) {
  const linhas = chaves.map((c, i) => ({
    id: `k${i}`,
    lastSeenAt: c.lastSeenAt,
    alertedAt: c.alertedAt ?? null,
    _blocked: c.blocked ?? false,
    school: {
      id: `esc-${i}`,
      name: `Escola ${i}`,
      timezone: 'America/Sao_Paulo',
      settings: { windowStart: '06:00', windowEnd: '19:30', notifyWeekends: false },
    },
  }));
  const prisma = {
    agentApiKey: {
      findMany: async ({ where }: any) => {
        let l = linhas.filter((x) => !x._blocked);
        // Reproduz o filtro de "nunca bateu não conta" da consulta enxuta.
        if (where.lastSeenAt?.lt) {
          l = l.filter((x) => x.lastSeenAt && x.lastSeenAt < where.lastSeenAt.lt);
        }
        return l;
      },
      update: async ({ where, data }: any) => {
        const alvo = linhas.find((x) => x.id === where.id)!;
        Object.assign(alvo, data);
        return alvo;
      },
    },
  };
  const canal = new CanalFake();
  return { linhas, canal, service: new MonitoramentoService(prisma as any, canal) };
}

describe('MonitoramentoService — agente mudo', () => {
  it('avisa quem passou do limiar, uma vez só', async () => {
    const { canal, service, linhas } = montar([
      { lastSeenAt: new Date(EXPEDIENTE.getTime() - 40 * MINUTO) },
    ]);

    const r = await service.varrer(EXPEDIENTE);
    expect(r.avisados).toBe(1);
    expect(canal.enviados[0]).toMatchObject({ tipo: 'agente_mudo', mudo_ha_minutos: 40 });
    expect(linhas[0].alertedAt).toBeInstanceOf(Date);

    // Segunda varredura com o agente ainda mudo não repete o aviso.
    const r2 = await service.varrer(EXPEDIENTE);
    expect(r2.avisados).toBe(0);
    expect(canal.enviados).toHaveLength(1);
  });

  it('agente dentro do limiar não vira alerta', async () => {
    const { canal, service } = montar([
      { lastSeenAt: new Date(EXPEDIENTE.getTime() - 5 * MINUTO) },
    ]);
    expect(await service.varrer(EXPEDIENTE)).toEqual({ avisados: 0, recuperados: 0 });
    expect(canal.enviados).toHaveLength(0);
  });

  it('agente que nunca bateu está por instalar, não mudo', async () => {
    const { canal, service } = montar([{ lastSeenAt: null }]);
    expect(await service.varrer(EXPEDIENTE)).toEqual({ avisados: 0, recuperados: 0 });
    expect(canal.enviados).toHaveLength(0);
  });

  it('não alerta de madrugada nem no domingo', async () => {
    const mudoHa = (base: Date) => new Date(base.getTime() - 60 * MINUTO);

    const noite = montar([{ lastSeenAt: mudoHa(MADRUGADA) }]);
    expect((await noite.service.varrer(MADRUGADA)).avisados).toBe(0);

    const domingo = montar([{ lastSeenAt: mudoHa(DOMINGO) }]);
    expect((await domingo.service.varrer(DOMINGO)).avisados).toBe(0);

    // E o mesmo agente, em horário de aula, é avisado.
    const util = montar([{ lastSeenAt: mudoHa(EXPEDIENTE) }]);
    expect((await util.service.varrer(EXPEDIENTE)).avisados).toBe(1);
  });

  it('quando volta, limpa a marca e avisa a recuperação', async () => {
    const { canal, service, linhas } = montar([
      { lastSeenAt: new Date(EXPEDIENTE.getTime() - MINUTO), alertedAt: new Date(0) },
    ]);

    const r = await service.varrer(EXPEDIENTE);
    expect(r.recuperados).toBe(1);
    expect(linhas[0].alertedAt).toBeNull();
    expect(canal.enviados[0]).toMatchObject({ tipo: 'agente_voltou' });
  });

  it('escola bloqueada não gera alerta — o agente parado ali é esperado', async () => {
    const { canal, service } = montar([
      { lastSeenAt: new Date(EXPEDIENTE.getTime() - 60 * MINUTO), blocked: true },
    ]);
    expect((await service.varrer(EXPEDIENTE)).avisados).toBe(0);
    expect(canal.enviados).toHaveLength(0);
  });

  it('agentesMudos lista para a tela do admin, com quanto tempo faz', async () => {
    const { service } = montar([
      { lastSeenAt: new Date(EXPEDIENTE.getTime() - 90 * MINUTO) },
      { lastSeenAt: new Date(EXPEDIENTE.getTime() - MINUTO) },
      { lastSeenAt: null },
    ]);
    const lista = await service.agentesMudos(EXPEDIENTE);
    expect(lista).toHaveLength(1);
    expect(lista[0]).toMatchObject({ escola: 'Escola 0', mudo_ha_minutos: 90, ja_avisado: false });
  });
});

describe('AlertasCanal', () => {
  it('sem ALERTAS_WEBHOOK_URL não tenta rede, mas não quebra', async () => {
    const anterior = process.env.ALERTAS_WEBHOOK_URL;
    delete process.env.ALERTAS_WEBHOOK_URL;
    const canal = new AlertasCanal();
    expect(canal.configurado).toBe(false);
    await expect(
      canal.enviar({
        tipo: 'agente_mudo',
        escola: { id: 'e1', nome: 'X' },
        mensagem: 'teste',
        em: new Date().toISOString(),
      }),
    ).resolves.toBeUndefined();
    if (anterior) process.env.ALERTAS_WEBHOOK_URL = anterior;
  });
});
