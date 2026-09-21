import { AlunosService } from './alunos.service';
import { EventoDto } from './dto';
import { EventosService } from './eventos.service';
import { FakeFila, FakePrisma } from './fake-prisma.spec-util';

const AG = { schoolId: 'esc-1', apiKeyId: 'chave-1' };

function evento(sobrescrever: Partial<EventoDto> = {}): EventoDto {
  return {
    external_event_id: '3|1|0000000000012345|260825073015',
    external_student_id: '77',
    student_name: 'Ana Souza',
    direction: 'in',
    occurred_at: '2026-08-25T07:30:15-03:00',
    card: '0000000000012345',
    device_id: '3',
    location_id: '1',
    ...sobrescrever,
  };
}

function montar() {
  const prisma = new FakePrisma();
  const fila = new FakeFila();
  const service = new EventosService(prisma as any, fila as any);
  return { prisma, fila, service };
}

describe('EventosService', () => {
  it('aceita lote, cria aluno desconhecido e enfileira notificação', async () => {
    const { prisma, fila, service } = montar();

    const r = await service.receberLote(AG, { events: [evento()] });

    expect(r).toEqual({ accepted: 1, duplicates: 0 });
    expect(prisma.alunos).toHaveLength(1);
    expect(prisma.alunos[0]).toMatchObject({
      schoolId: 'esc-1',
      externalId: '77',
      name: 'Ana Souza',
    });
    expect(prisma.eventos[0]).toMatchObject({
      externalEventId: '3|1|0000000000012345|260825073015',
      direction: 'IN',
    });
    expect(fila.enfileirados).toHaveLength(1);
    expect(fila.enfileirados[0].accessEventId).toBe(prisma.eventos[0].id);
  });

  it('reenvio do mesmo lote conta como duplicado e não notifica de novo', async () => {
    const { fila, service } = montar();
    await service.receberLote(AG, { events: [evento()] });

    const r = await service.receberLote(AG, { events: [evento()] });

    expect(r).toEqual({ accepted: 0, duplicates: 1 });
    expect(fila.enfileirados).toHaveLength(1);
  });

  it('mesmo external_event_id em outra escola não é duplicado', async () => {
    const { service } = montar();
    await service.receberLote(AG, { events: [evento()] });

    const r = await service.receberLote(
      { schoolId: 'esc-2', apiKeyId: 'k2' },
      { events: [evento()] },
    );
    expect(r).toEqual({ accepted: 1, duplicates: 0 });
  });

  it('cartão sem pessoa vira aluno pendente, evento nunca é descartado', async () => {
    const { prisma, service } = montar();

    const r = await service.receberLote(AG, {
      events: [
        evento({
          external_student_id: 'cartao:9999',
          student_name: undefined,
          card: '9999',
          external_event_id: 'x|0|9999|260825080000',
        }),
      ],
    });

    expect(r.accepted).toBe(1);
    expect(prisma.alunos[0]).toMatchObject({
      externalId: 'cartao:9999',
      name: 'Cartão 9999 (não vinculado)',
    });
  });

  it('lote misto: aceitos e duplicados no mesmo POST', async () => {
    const { service, fila } = montar();
    await service.receberLote(AG, { events: [evento()] });

    const r = await service.receberLote(AG, {
      events: [
        evento(),
        evento({ external_event_id: 'novo|1|123|260825090000', direction: 'out' }),
      ],
    });

    expect(r).toEqual({ accepted: 1, duplicates: 1 });
    expect(fila.enfileirados).toHaveLength(2);
  });
});

describe('AlunosService', () => {
  it('teto de alunos do contrato barra cadastro novo, nunca o já existente', async () => {
    const prisma = new FakePrisma();
    prisma.maxStudents = 2;
    const alunos = new AlunosService(prisma as any);
    const AG = { schoolId: 'esc-1', apiKeyId: 'k1' };

    const primeira = await alunos.sincronizar(AG, {
      full: false,
      students: [
        { external_id: '1', name: 'Ana', active: true },
        { external_id: '2', name: 'Bia', active: true },
        { external_id: '3', name: 'Caio', active: true },
      ],
    } as any);
    expect(primeira).toEqual({ upserted: 2, ignorados: 1, limite: 2 });
    expect(prisma.alunos.map((a) => a.name)).toEqual(['Ana', 'Bia']);

    // Quem já está dentro continua sendo atualizado mesmo no teto.
    const segunda = await alunos.sincronizar(AG, {
      full: false,
      students: [{ external_id: '1', name: 'Ana Maria', active: true }],
    } as any);
    expect(segunda.ignorados).toBe(0);
    expect(prisma.alunos.find((a) => a.externalId === '1')!.name).toBe('Ana Maria');
  });

  it('sem teto no contrato, sincroniza todo mundo', async () => {
    const prisma = new FakePrisma();
    const alunos = new AlunosService(prisma as any);
    const r = await alunos.sincronizar({ schoolId: 'esc-1', apiKeyId: 'k1' }, {
      full: false,
      students: Array.from({ length: 5 }, (_, i) => ({ external_id: `${i}`, name: `A${i}`, active: true })),
    } as any);
    expect(r).toEqual({ upserted: 5, ignorados: 0, limite: null });
  });

  it('sync completo desativa quem sumiu, mas preserva pendências de cartão', async () => {
    const prisma = new FakePrisma();
    const alunos = new AlunosService(prisma as any);
    const eventos = new EventosService(prisma as any, new FakeFila() as any);

    // Estado inicial: dois alunos sincronizados + um pendente vindo de evento.
    await alunos.sincronizar(AG, {
      full: true,
      students: [
        { external_id: '77', name: 'Ana', active: true },
        { external_id: '88', name: 'Bia', active: true },
      ],
    });
    await eventos.receberLote(AG, {
      events: [
        {
          external_event_id: 'e1',
          external_student_id: 'cartao:555',
          direction: 'in',
          occurred_at: '2026-08-25T08:00:00-03:00',
          card: '555',
        },
      ],
    });

    // Novo sync completo sem a Bia.
    await alunos.sincronizar(AG, {
      full: true,
      students: [{ external_id: '77', name: 'Ana Souza', class_name: '5A', active: true }],
    });

    const por = (ext: string) => prisma.alunos.find((s) => s.externalId === ext)!;
    expect(por('77')).toMatchObject({ name: 'Ana Souza', className: '5A', active: true });
    expect(por('88').active).toBe(false); // saiu do cadastro -> inativo, não apagado
    expect(por('cartao:555').active).toBe(true); // pendência continua visível
    expect(prisma.alunos).toHaveLength(3);
  });
});
