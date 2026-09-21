// Contratos do back-office interno (/v1/admin).

export interface EscolaAdmin {
  id: string;
  nome: string;
  cnpj: string | null;
  plano: string;
  bloqueado: boolean;
  motivo_bloqueio: string | null;
  bloqueado_em: string | null;
  contrato: { max_alunos: number | null; max_chips: number };
  uso: {
    alunos: number;
    chips: number;
    chips_conectados: number;
    mensagens_mes: number;
    falhas_mes: number;
    alunos_acima_do_teto: boolean;
  };
  agente: { online: boolean; last_seen_at: string | null };
  cobranca: {
    status: 'em_dia' | 'pendente' | 'atrasado' | 'isento';
    nota_emitida: boolean;
    data_nota: string | null;
    atualizado_em: string | null;
  };
  saudavel: boolean;
}

export interface EscolaDetalhe extends EscolaAdmin {
  observacoes: string | null;
  conta_azul_id: string | null;
  criada_em: string;
  usuarios: { id: string; name: string; email: string; role: string }[];
  chips: {
    id: string;
    nome: string;
    label: string | null;
    status: string;
    numero: string | null;
    perfil: string | null;
    conectado_em: string | null;
    ultimo_envio: string | null;
  }[];
  ultimas_mensagens: { status: string; createdAt: string; error: string | null }[];
}

export interface ResumoAdmin {
  escolas: number;
  bloqueadas: number;
  inadimplentes: number;
  sem_nota: number;
  mensagens_mes: number;
  /** Agentes que pararam de dar sinal — a falha silenciosa do produto. */
  agentes_mudos: number;
}

export interface AgenteMudo {
  escola_id: string;
  escola: string;
  ultimo_sinal: string | null;
  mudo_ha_minutos: number;
  /** true = o alerta já saiu pelo webhook. */
  ja_avisado: boolean;
}

/** 90 -> "1h30"; 45 -> "45 min" */
export function duracaoCurta(minutos: number): string {
  if (minutos < 60) return `${minutos} min`;
  const h = Math.floor(minutos / 60);
  const m = minutos % 60;
  return m ? `${h}h${String(m).padStart(2, '0')}` : `${h}h`;
}

export const ROTULO_COBRANCA: Record<EscolaAdmin['cobranca']['status'], string> = {
  em_dia: 'Em dia',
  pendente: 'Pendente',
  atrasado: 'Atrasado',
  isento: 'Isento',
};

export const PILL_COBRANCA: Record<EscolaAdmin['cobranca']['status'], string> = {
  em_dia: 'p-mint',
  pendente: 'p-sun',
  atrasado: 'p-coral',
  isento: 'p-grey',
};

/** 12345678000199 -> 12.345.678/0001-99 */
export function formatarCnpj(v: string | null): string {
  if (!v) return '—';
  const d = v.replace(/\D/g, '');
  if (d.length !== 14) return v;
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}
