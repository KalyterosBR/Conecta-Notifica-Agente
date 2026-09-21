// Renderização dos modelos de mensagem (doc §3, message_templates):
// variáveis {responsavel} {aluno} {hora} {escola}.

export const TEMPLATE_PADRAO: Record<'IN' | 'OUT', string> = {
  IN: 'Olá {responsavel}! {aluno} entrou na {escola} às {hora}.',
  OUT: 'Olá {responsavel}! {aluno} saiu da {escola} às {hora}.',
};

/** Variáveis aceitas nos modelos (doc §3, message_templates). */
export const VARIAVEIS = ['responsavel', 'aluno', 'hora', 'escola'] as const;

/**
 * Variáveis `{assim}` escritas no corpo que o sistema não sabe substituir —
 * o painel recusa o modelo em vez de mandar `{turma}` cru para o responsável.
 */
export function variaveisDesconhecidas(corpo: string): string[] {
  const usadas = corpo.match(/\{[^{}]*\}/g) ?? [];
  const validas = new Set<string>(VARIAVEIS);
  return [...new Set(usadas.filter((v) => !validas.has(v.slice(1, -1))))];
}

export function renderizar(
  corpo: string,
  vars: { responsavel: string; aluno: string; hora: string; escola: string },
): string {
  return corpo
    .replaceAll('{responsavel}', vars.responsavel)
    .replaceAll('{aluno}', vars.aluno)
    .replaceAll('{hora}', vars.hora)
    .replaceAll('{escola}', vars.escola);
}

/** Hora local e dia da semana do evento no fuso da escola. */
export function noFuso(data: Date, timezone: string): { hhmm: string; fimDeSemana: boolean } {
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    weekday: 'short',
  }).formatToParts(data);
  const pega = (t: string) => partes.find((p) => p.type === t)?.value ?? '';
  // hour12:false pode devolver "24" à meia-noite; normaliza para "00".
  const hora = pega('hour') === '24' ? '00' : pega('hour');
  const dia = pega('weekday');
  return {
    hhmm: `${hora}:${pega('minute')}`,
    fimDeSemana: dia === 'Sat' || dia === 'Sun',
  };
}
