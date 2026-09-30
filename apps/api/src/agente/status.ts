/** A tela considera online um agente com heartbeat recente. O alerta operacional
 * tem um limite próprio mais folgado e continua sendo controlado pelo monitoramento. */
export const LIMITE_STATUS_AGENTE_MS = 5 * 60_000;

export interface StatusAgentePainel {
  version?: string;
  cursor?: string;
  pending?: number;
  db_ok?: boolean;
  last_event_at?: string;
  sent_today?: number;
}

export function agenteEstaOnline(lastSeenAt: Date | null | undefined, agora = Date.now()): boolean {
  return !!lastSeenAt && agora - lastSeenAt.getTime() < LIMITE_STATUS_AGENTE_MS;
}

/** Retorna só metadados operacionais seguros; não inclui texto de erro bruto. */
export function statusAgenteParaPainel(valor: unknown): StatusAgentePainel | null {
  if (!valor || typeof valor !== 'object' || Array.isArray(valor)) return null;
  const v = valor as Record<string, unknown>;
  return {
    ...(typeof v.version === 'string' ? { version: v.version } : {}),
    ...(typeof v.cursor === 'string' ? { cursor: v.cursor } : {}),
    ...(typeof v.pending === 'number' ? { pending: v.pending } : {}),
    ...(typeof v.db_ok === 'boolean' ? { db_ok: v.db_ok } : {}),
    ...(typeof v.last_event_at === 'string' ? { last_event_at: v.last_event_at } : {}),
    ...(typeof v.sent_today === 'number' ? { sent_today: v.sent_today } : {}),
  };
}
