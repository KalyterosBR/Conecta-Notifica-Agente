// Cliente da API do painel. Token fica em localStorage por enquanto —
// regras de login mais elaboradas entram depois.
export const API_URL =
  process.env.NEXT_PUBLIC_API_URL ??
  (typeof window !== 'undefined'
    ? `http://${window.location.hostname}:3001`
    : 'http://localhost:3001');

export function tokenAtual(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return localStorage.getItem('cn_token');
  } catch {
    return null;
  }
}

export function guardarSessao(token: string, nome: string, admin = false) {
  localStorage.setItem('cn_token', token);
  localStorage.setItem('cn_nome', nome);
  localStorage.setItem('cn_admin', admin ? '1' : '0');
}

/**
 * Entra no painel como uma escola guardando a sessão do admin, para o
 * "voltar ao admin" não exigir novo login.
 */
export function entrarComoEscola(token: string, escola: string) {
  const meu = localStorage.getItem('cn_token');
  if (meu) localStorage.setItem('cn_token_admin', meu);
  localStorage.setItem('cn_token', token);
  localStorage.setItem('cn_impersonando', escola);
  localStorage.setItem('cn_admin', '0');
}

/** Nome da escola sendo impersonada, ou null fora desse modo. */
export function impersonando(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return localStorage.getItem('cn_impersonando');
  } catch {
    return null;
  }
}

export function voltarAoAdmin() {
  const meu = localStorage.getItem('cn_token_admin');
  localStorage.removeItem('cn_impersonando');
  localStorage.removeItem('cn_token_admin');
  if (meu) {
    localStorage.setItem('cn_token', meu);
    localStorage.setItem('cn_admin', '1');
    window.location.href = '/admin';
  } else {
    sair();
  }
}

/** Operador interno: usuário sem escola vinculada. */
export function ehAdmin(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return localStorage.getItem('cn_admin') === '1';
  } catch {
    return false;
  }
}

export function sair() {
  localStorage.removeItem('cn_token');
  localStorage.removeItem('cn_admin');
  localStorage.removeItem('cn_impersonando');
  localStorage.removeItem('cn_token_admin');
  window.location.href = '/login';
}

export async function api<T>(caminho: string, init?: RequestInit): Promise<T> {
  let resp: Response;
  try {
    resp = await fetch(`${API_URL}${caminho}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(tokenAtual() ? { Authorization: `Bearer ${tokenAtual()}` } : {}),
        ...init?.headers,
      },
    });
  } catch {
    throw new Error(`sem conexão com a API em ${API_URL} — ela está rodando?`);
  }
  if (resp.status === 401 && typeof window !== 'undefined') {
    sair();
    throw new Error('sessão expirada');
  }
  if (!resp.ok) {
    const corpo = await resp.json().catch(() => ({}));
    throw new Error(corpo.message ?? `erro ${resp.status}`);
  }
  return resp.json();
}

export function nomeAtual(): string {
  if (typeof window === 'undefined') return '';
  try {
    return localStorage.getItem('cn_nome') ?? '';
  } catch {
    return '';
  }
}

// ---- tipos da visão geral (contrato da API) ----
export interface VisaoGeral {
  agente: {
    online: boolean;
    last_seen_at: string | null;
    status: {
      version?: string;
      cursor?: string;
      pending?: number;
      db_ok?: boolean;
      last_event_at?: string;
      sent_today?: number;
    } | null;
  };
  whatsapp: { conectado: boolean; provider: string | null };
  hoje: { eventos: number; enviadas: number; entregues: number; falhas: number };
  alunos_sem_responsavel: number;
  alunos_total: number;
  ultimos_acessos: {
    id: string;
    aluno: string;
    student_id: string;
    direction: 'in' | 'out';
    occurred_at: string;
  }[];
}

// ---- alunos ----
export interface AlunoLista {
  id: string;
  external_id: string;
  name: string;
  class_name: string | null;
  card: string | null;
  responsaveis: number;
  pendente: boolean;
  sincronizado: boolean;
}
export interface RespostaAlunos {
  total: number;
  pagina: number;
  resumo?: {
    total: number;
    sincronizados: number;
    aguardando_sincronizacao: number;
    sem_responsavel: number;
  };
  alunos: AlunoLista[];
}
export interface ResponsavelAluno {
  id: string;
  name: string;
  phone: string;
  relation: string | null;
  opt_in: boolean;
  notify_entry: boolean;
  notify_exit: boolean;
  is_primary: boolean;
}
export interface AlunoDetalhe {
  id: string;
  external_id: string;
  name: string;
  class_name: string | null;
  card: string | null;
  active: boolean;
  responsaveis: ResponsavelAluno[];
  acessos: { id: string; direction: 'in' | 'out'; occurred_at: string; avisos: number }[];
}

// ---- envios ----
export interface Envio {
  id: string;
  aluno: string;
  responsavel: string;
  phone: string;
  direction: 'in' | 'out';
  occurred_at: string;
  status: string;
  error: string | null;
  attempts: number;
  sent_at: string | null;
  delivered_at: string | null;
}
export interface RespostaEnvios {
  total: number;
  pagina: number;
  envios: Envio[];
}

// ---- configurações ----
export interface Configuracoes {
  escola: { name: string; timezone: string; plan: string };
  regras: {
    dedupe_minutes: number;
    window_start: string;
    window_end: string;
    notify_weekends: boolean;
  };
  agente: {
    chave_criada_em: string | null;
    last_seen_at: string | null;
    online: boolean;
    status: {
      version?: string;
      cursor?: string;
      pending?: number;
      db_ok?: boolean;
      last_event_at?: string;
      sent_today?: number;
    } | null;
  };
  /** Limites do plano — quem muda é o admin interno. */
  contrato: {
    max_alunos: number | null;
    alunos_cadastrados: number;
    max_chips: number;
    bloqueado: boolean;
    motivo_bloqueio: string | null;
  };
  whatsapp: {
    provider: string | null;
    conectado: boolean;
    chips: Chip[];
    /** false quando bateu o teto de chips ou a escola está bloqueada. */
    pode_adicionar: boolean;
    webhook_token: string | null;
    webhook_url: string | null;
    /** true = a API tem conta UAZAPI, então o painel mostra o QR code. */
    qr_disponivel: boolean;
  };
}

/** Um número de WhatsApp da escola. */
export interface Chip {
  id: string;
  nome: string;
  label: string | null;
  status: string;
  conectado: boolean;
  numero: string | null;
  perfil: string | null;
  conectado_em: string | null;
  ultimo_envio: string | null;
}

/** Estado da conexão do WhatsApp durante o onboarding por QR code. */
export interface ConexaoWhatsapp {
  status: 'sem_instancia' | 'disconnected' | 'connecting' | 'connected' | 'hibernated';
  conectado: boolean;
  /** O chip que está sendo conectado; ausente quando não há nenhum ainda. */
  chip?: Chip;
  /** Já vem como data URI, pronto para o src de uma <img>. */
  qrcode: string | null;
  paircode: string | null;
  numero: string | null;
  perfil: string | null;
  foto: string | null;
}

export interface Modelo {
  body: string;
  /** false = texto padrão do sistema, a escola ainda não editou. */
  personalizado: boolean;
}

export interface Modelos {
  variaveis: string[];
  padrao: { in: string; out: string };
  modelos: { in: Modelo; out: Modelo };
}

/** Responsável na tela de Responsáveis. */
export interface Responsavel {
  id: string;
  name: string;
  phone: string;
  relation: string | null;
  /** Sem opt-in o sistema não envia nada para esta pessoa (LGPD). */
  opt_in: boolean;
  opt_in_at: string | null;
  alunos: {
    id: string;
    name: string;
    class_name: string | null;
    notify_entry: boolean;
    notify_exit: boolean;
  }[];
}

export interface ListaResponsaveis {
  total: number;
  pagina: number;
  por_pagina: number;
  responsaveis: Responsavel[];
}

export interface ResultadoImportacao {
  total: number;
  criados: number;
  vinculados: number;
  erros: { linha: number; motivo: string }[];
}

/** Consolidado da tela de Relatórios. */
export interface Relatorio {
  periodo: { dias: number; desde: string; timezone: string };
  serie: {
    dia: string;
    entradas: number;
    saidas: number;
    enviadas: number;
    entregues: number;
    falhas: number;
  }[];
  turmas: { turma: string; alunos: number; acessos: number }[];
  horas: { hora: number; entradas: number; saidas: number }[];
  totais: {
    eventos: number;
    mensagens: number;
    entregues: number;
    falhas: number;
    alunos_sem_responsavel: number;
    /** null quando nada foi enviado no período — 0% mentiria. */
    taxa_entrega: number | null;
  };
}

/** Estado do onboarding — cada passo é deduzido do sistema, não de um clique. */
export interface Onboarding {
  escola: string;
  bloqueado: boolean;
  passos: { id: 'agente' | 'whatsapp' | 'responsaveis'; titulo: string; concluido: boolean; detalhe: string }[];
  concluido: boolean;
  agente: { chave_criada_em: string | null; last_seen_at: string | null; online: boolean };
  whatsapp: { chips: Chip[]; pode_adicionar: boolean };
  alunos: {
    total: number;
    sincronizados: number;
    aguardando_sincronizacao: number;
    sem_responsavel: number;
    responsaveis: number;
  };
  url_agente: string | null;
}
