import { montarSerie } from './relatorios.service';

const TZ = 'America/Sao_Paulo';

/** Data de N dias atrás, já no formato YYYY-MM-DD do fuso da escola. */
function diaAtras(n: number): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(Date.now() - n * 86_400_000));
}

describe('montarSerie', () => {
  it('devolve um ponto por dia, mesmo sem movimento', () => {
    const s = montarSerie(7, TZ, [], []);
    expect(s).toHaveLength(7);
    expect(s.every((d) => d.entradas === 0 && d.saidas === 0)).toBe(true);
    // Em ordem cronológica, terminando hoje.
    expect(s.at(-1)!.dia).toBe(diaAtras(0));
    expect(s[0].dia).toBe(diaAtras(6));
  });

  it('encaixa entradas e saídas no dia certo', () => {
    const ontem = diaAtras(1);
    const s = montarSerie(3, TZ, [
      { dia: ontem, direction: 'in', total: 12n },
      { dia: ontem, direction: 'out', total: 9n },
    ], []);
    const alvo = s.find((d) => d.dia === ontem)!;
    expect(alvo).toMatchObject({ entradas: 12, saidas: 9 });
    // Os outros dias continuam zerados, não herdam nada.
    expect(s.filter((d) => d.entradas > 0)).toHaveLength(1);
  });

  it('entregue e lida contam como entregue e como enviada', () => {
    const hoje = diaAtras(0);
    const s = montarSerie(1, TZ, [], [
      { dia: hoje, status: 'sent', total: 3n },
      { dia: hoje, status: 'delivered', total: 5n },
      { dia: hoje, status: 'read', total: 2n },
      { dia: hoje, status: 'failed', total: 1n },
    ]);
    // 3 enviadas + 5 entregues + 2 lidas = 10 que saíram; 7 chegaram.
    expect(s[0]).toMatchObject({ enviadas: 10, entregues: 7, falhas: 1 });
  });

  it('dia fora da janela é ignorado em vez de estourar a série', () => {
    const s = montarSerie(2, TZ, [{ dia: '2020-01-01', direction: 'in', total: 99n }], []);
    expect(s).toHaveLength(2);
    expect(s.every((d) => d.entradas === 0)).toBe(true);
  });

  it('fila (queued) não conta como enviada — ainda não saiu', () => {
    const hoje = diaAtras(0);
    const s = montarSerie(1, TZ, [], [{ dia: hoje, status: 'queued', total: 4n }]);
    expect(s[0]).toMatchObject({ enviadas: 0, entregues: 0, falhas: 0 });
  });
});
