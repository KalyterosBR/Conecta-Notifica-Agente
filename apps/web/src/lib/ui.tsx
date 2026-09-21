'use client';
// Peças visuais compartilhadas do painel — seguem o entrou-mockup.html.
import { useCallback, useRef, useState } from 'react';

/** Ícone Tabler (webfont carregada no layout raiz). */
export function Ic({ nome, className, style, title, onClick }: {
  nome: string;
  className?: string;
  style?: React.CSSProperties;
  title?: string;
  onClick?: React.MouseEventHandler;
}) {
  return (
    <i
      className={`ti ti-${nome}${className ? ` ${className}` : ''}`}
      style={style}
      title={title}
      onClick={onClick}
    />
  );
}

/** Marca do Conecta Notifica (balão + capelo), cor configurável. */
export function LogoMarca({ cor = '#fff', tamanho = 42 }: { cor?: string; tamanho?: number }) {
  return (
    <svg viewBox="0 0 100 100" width={tamanho} height={tamanho} aria-label="Conecta Notifica">
      <path d="M12.8 65.3 A41 41 0 1 1 30.8 84.2 L8 92 Z" fill="none" stroke={cor} strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M50 28 L78 41 L50 54 L22 41 Z" fill="none" stroke={cor} strokeWidth="5" strokeLinejoin="round" />
      <path d="M36 49 V59 C36 64 42 68 50 68 C58 68 64 64 64 59 V49" fill="none" stroke={cor} strokeWidth="5" strokeLinecap="round" />
      <path d="M72 44 V57" stroke={cor} strokeWidth="5" strokeLinecap="round" />
    </svg>
  );
}

export const CORES_AV = ['var(--sky)', 'var(--mint)', 'var(--coral)', 'var(--brand)', 'var(--violet)', '#E8A13B'];

export function iniciais(nome: string): string {
  return nome
    .split(' ')
    .filter(Boolean)
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

/** Foto ilustrada do aluno (avatar gerado pelo nome, como no mockup). */
export function fotoAluno(nome: string): string {
  return `https://api.dicebear.com/9.x/adventurer/svg?seed=${encodeURIComponent(nome)}&backgroundColor=c0e8f9,d1f4d9,ffe0cc,fff1c2,e4dcf9`;
}

export function AvatarAluno({ nome, className = 'avimg' }: { nome: string; className?: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img className={className} src={fotoAluno(nome)} alt="" loading="lazy" />;
}

export function AvIniciais({ nome, indice = 0 }: { nome: string; indice?: number }) {
  return (
    <span className="av" style={{ background: CORES_AV[indice % CORES_AV.length] }}>
      {iniciais(nome)}
    </span>
  );
}

const CORES_TURMA = ['p-mint', 'p-coral', 'p-sky', 'p-sun', 'p-violet'];
export function PillTurma({ turma }: { turma: string | null }) {
  if (!turma) return <span className="pill p-grey">—</span>;
  return <span className={`pill ${CORES_TURMA[turma.length % CORES_TURMA.length]}`}>{turma}</span>;
}

export function PillEvento({ direction }: { direction: 'in' | 'out' }) {
  return direction === 'in' ? (
    <span className="pill p-mint"><Ic nome="login" />Entrada</span>
  ) : (
    <span className="pill p-sky"><Ic nome="logout" />Saída</span>
  );
}

/** Status de mensagem da API (queued/sent/delivered/read/failed) → pill do mockup. */
export function PillStatusEnvio({ status, erro }: { status: string; erro?: string | null }) {
  switch (status) {
    case 'read':
      return <span className="pill p-solid-sky"><Ic nome="checks" />Lido</span>;
    case 'delivered':
      return <span className="pill p-solid-mint"><Ic nome="checks" />Entregue</span>;
    case 'sent':
      return <span className="pill p-grey"><Ic nome="check" />Enviado</span>;
    case 'failed':
      return <span className="pill p-solid-coral"><Ic nome="x" />{erro || 'Falhou'}</span>;
    case 'queued':
      return <span className="pill p-sun"><Ic nome="hourglass" />Na fila</span>;
    default:
      return <span className="pill p-grey">{status}</span>;
  }
}

// ---- datas e telefone ----
export function horaCurta(iso: string | Date): string {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

export function mesmaData(a: Date, b: Date): boolean {
  return a.toDateString() === b.toDateString();
}

/** "Hoje · 10:41", "Ontem · 17:32" ou "21 ago · 07:12". */
export function quandoCurto(iso: string | Date): string {
  const d = new Date(iso);
  const hoje = new Date();
  const ontem = new Date(hoje);
  ontem.setDate(hoje.getDate() - 1);
  const hora = horaCurta(d);
  if (mesmaData(d, hoje)) return `Hoje · ${hora}`;
  if (mesmaData(d, ontem)) return `Ontem · ${hora}`;
  const dia = d.toLocaleDateString('pt-BR', { day: 'numeric', month: 'short' }).replace('.', '');
  return `${dia} · ${hora}`;
}

/** +5581999990000 → (81) 99999-0000 */
export function telefoneBonito(e164: string | null): string {
  if (!e164) return '—';
  const m = e164.match(/^\+55(\d{2})(\d{4,5})(\d{4})$/);
  if (m) return `(${m[1]}) ${m[2]}-${m[3]}`;
  return e164;
}

/** Entrada do usuário → E.164 (assume Brasil quando vier sem código do país). */
export function paraE164(entrada: string): string | null {
  const so = entrada.replace(/[\s().-]/g, '');
  if (/^\+[1-9]\d{7,14}$/.test(so)) return so;
  const digitos = so.replace(/\D/g, '');
  if (digitos.length === 10 || digitos.length === 11) return `+55${digitos}`;
  if (digitos.length === 12 || digitos.length === 13) return `+${digitos}`;
  return null;
}

// ---- toast ----
export function useToast(): { toast: (msg: string) => void; toastEl: React.ReactNode } {
  const [msg, setMsg] = useState('');
  const [visivel, setVisivel] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toast = useCallback((m: string) => {
    setMsg(m);
    setVisivel(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setVisivel(false), 2200);
  }, []);
  const toastEl = (
    <div className={`toast${visivel ? ' show' : ''}`}>
      <Ic nome="circle-check" />
      <span>{msg}</span>
    </div>
  );
  return { toast, toastEl };
}
