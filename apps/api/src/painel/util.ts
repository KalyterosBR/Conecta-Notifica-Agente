/**
 * Meia-noite de hoje no fuso da escola, como instante UTC — base das
 * "métricas do dia" da visão geral.
 */
export function inicioDoDia(timezone: string, agora = new Date()): Date {
  const ymd = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(agora); // YYYY-MM-DD
  // Descobre o offset do fuso nesse dia comparando o mesmo instante nas duas
  // representações.
  const suposto = new Date(`${ymd}T00:00:00Z`);
  const local = new Date(suposto.toLocaleString('en-US', { timeZone: timezone }));
  const utc = new Date(suposto.toLocaleString('en-US', { timeZone: 'UTC' }));
  return new Date(suposto.getTime() + (utc.getTime() - local.getTime()));
}

/**
 * Telefone da planilha da escola para E.164. Aceita o que gente digita:
 * "(81) 99999-0000", "81999990000", "+55 81 99999 0000". Sem DDI, assume o
 * Brasil — é o único público do produto hoje.
 *
 * Devolve null quando não dá para confiar no número, e nesse caso a linha da
 * importação falha em vez de cadastrar um telefone que nunca vai receber.
 */
export function normalizarTelefone(bruto: string): string | null {
  const d = (bruto ?? '').replace(/\D/g, '');
  if (!d) return null;

  // Já veio com DDI do Brasil.
  if (d.length === 13 && d.startsWith('55')) return `+${d}`;
  // DDI + fixo (8 dígitos) ou celular antigo sem o nono dígito.
  if (d.length === 12 && d.startsWith('55')) return `+${d}`;
  // Sem DDI: DDD + 9 dígitos (celular) ou DDD + 8 (fixo).
  if (d.length === 11 || d.length === 10) return `+55${d}`;
  // Outro país, já em formato internacional plausível.
  if (d.length >= 11 && d.length <= 15 && bruto.trim().startsWith('+')) return `+${d}`;
  return null;
}
