'use client';
// Shell do painel — sidebar índigo + topbar, seguindo o entrou-mockup.html.
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import {
  api,
  Configuracoes,
  impersonando,
  nomeAtual,
  Onboarding,
  sair,
  tokenAtual,
  VisaoGeral,
  voltarAoAdmin,
} from '@/lib/api';
import { Ic, iniciais, LogoMarca } from '@/lib/ui';

const ITENS = [
  { rota: '/painel', icone: 'layout-grid', nome: 'Visão geral' },
  { rota: '/painel/onboarding', icone: 'rocket', nome: 'Primeiros passos' },
  { rota: '/painel/alunos', icone: 'users', nome: 'Alunos' },
  { rota: '/painel/responsaveis', icone: 'user-heart', nome: 'Responsáveis' },
  { rota: '/painel/envios', icone: 'send', nome: 'Envios' },
  { rota: '/painel/modelos', icone: 'template', nome: 'Modelos' },
  { rota: '/painel/relatorios', icone: 'chart-bar', nome: 'Relatórios', tag: 'Novo' },
  { rota: '/painel/integracoes', icone: 'plug', nome: 'Integrações' },
  { rota: '/painel/configuracoes', icone: 'settings', nome: 'Configurações' },
];

export default function PainelLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [pronto, setPronto] = useState(false);
  const [nome, setNome] = useState('');
  const [escola, setEscola] = useState('');
  const [plano, setPlano] = useState('');
  const [alunosTotal, setAlunosTotal] = useState<number | null>(null);
  const [semResp, setSemResp] = useState(0);
  const [falhasHoje, setFalhasHoje] = useState(0);
  const [busca, setBusca] = useState('');
  const [menuAberto, setMenuAberto] = useState(false);
  const [comoEscola, setComoEscola] = useState<string | null>(null);
  const [onboarding, setOnboarding] = useState<Onboarding | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!tokenAtual()) {
      router.replace('/login');
      return;
    }
    setPronto(true);
    setNome(nomeAtual());
    setComoEscola(impersonando());
    // Enquanto o onboarding não fecha, o painel avisa em toda tela: uma escola
    // com WhatsApp desconectado acha que está funcionando e não está.
    api<Onboarding>('/v1/painel/onboarding')
      .then(setOnboarding)
      .catch(() => {});
    // contexto do topo/sidebar; falha silenciosa não derruba o shell
    api<Configuracoes>('/v1/painel/configuracoes')
      .then((c) => {
        setEscola(c.escola.name);
        setPlano(c.escola.plan);
      })
      .catch(() => {});
    api<VisaoGeral>('/v1/painel/visao-geral')
      .then((v) => {
        setSemResp(v.alunos_sem_responsavel);
        setFalhasHoje(v.hoje.falhas);
      })
      .catch(() => {});
    api<{ total: number }>('/v1/painel/alunos?pagina=1')
      .then((r) => setAlunosTotal(r.total))
      .catch(() => {});
  }, [router]);

  useEffect(() => {
    function fora(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuAberto(false);
    }
    document.addEventListener('mousedown', fora);
    return () => document.removeEventListener('mousedown', fora);
  }, []);

  if (!pronto) return null;

  const ativo = (rota: string) =>
    rota === '/painel' ? pathname === '/painel' : pathname.startsWith(rota);

  function buscar(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' && busca.trim()) {
      router.push(`/painel/alunos?busca=${encodeURIComponent(busca.trim())}`);
      setBusca('');
    }
  }

  return (
    <div className="layout">
      <aside className="side">
        <div className="logo">
          <LogoMarca />
          <b>
            Conecta<span>NOTIFICA</span>
          </b>
        </div>
        <nav className="nav">
          {ITENS.map((i) => (
            <Link key={i.rota} href={i.rota} className={ativo(i.rota) ? 'on' : undefined}>
              <Ic nome={i.icone} />
              {i.nome}
              {i.nome === 'Alunos' && semResp > 0 && <span className="badge">{semResp}</span>}
              {i.tag && <span className="tag">{i.tag}</span>}
            </Link>
          ))}
        </nav>
        <div className="plan">
          <div className="ph">
            Plano {plano ? plano.charAt(0).toUpperCase() + plano.slice(1).toLowerCase() : '—'}
            <Ic nome="school" />
          </div>
          <small>
            {alunosTotal !== null ? `${alunosTotal} alunos sincronizados` : 'sincronizando…'}
          </small>
          <div className="bar">
            <i style={{ width: alunosTotal ? '100%' : '0%' }} />
          </div>
        </div>
      </aside>

      <div className="content">
        <div className="topbar">
          <div className="gsearch">
            <Ic nome="search" />
            <input
              placeholder="Buscar aluno pelo nome…"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              onKeyDown={buscar}
            />
          </div>
          <div className="grow" />
          <Link href="/painel/envios?status=failed" className="icon-btn" title="Falhas de envio hoje">
            <Ic nome="bell" />
            {falhasHoje > 0 && <span className="count">{falhasHoje}</span>}
          </Link>
          <div className="userchip" ref={menuRef} onClick={() => setMenuAberto((v) => !v)}>
            <span className="av">{nome ? iniciais(nome) : '·'}</span>
            <div className="txt">
              <b>{nome || 'Usuário'}</b>
              <small>{escola || '—'}</small>
            </div>
            <Ic nome="chevron-down" />
            {menuAberto && (
              <div className="menu">
                <button onClick={sair}>
                  <Ic nome="logout" />
                  Sair do painel
                </button>
              </div>
            )}
          </div>
        </div>
        <div className="page">
          {comoEscola && (
            <div className="imp-barra">
              <Ic nome="eye" />
              <span>
                Você está vendo o painel como <b>{comoEscola}</b>. Tudo o que fizer aqui é como se
                fosse a escola.
              </span>
              <button onClick={voltarAoAdmin}>
                <Ic nome="arrow-back-up" />
                Voltar ao admin
              </button>
            </div>
          )}
          {onboarding && !onboarding.concluido && pathname !== '/painel/onboarding' && (
            <Link href="/painel/onboarding" className="onb-barra">
              <Ic nome="rocket" />
              <span>
                <b>
                  Faltam{' '}
                  {onboarding.passos.filter((p) => !p.concluido).length} passo(s) para a escola
                  começar a avisar
                </b>
                <small>
                  {onboarding.passos.find((p) => !p.concluido)?.titulo} — continuar de onde parou
                </small>
              </span>
              <Ic nome="chevron-right" />
            </Link>
          )}
          {children}
        </div>
      </div>
    </div>
  );
}
