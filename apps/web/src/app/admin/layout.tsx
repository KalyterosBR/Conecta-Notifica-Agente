'use client';
// Shell do back-office. Deliberadamente diferente do painel da escola: quem
// está aqui mexe em contrato e cobrança, e não pode achar que está no painel
// de um cliente.
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { ReactNode, useEffect, useState } from 'react';
import { ehAdmin, impersonando, nomeAtual, sair, tokenAtual, voltarAoAdmin } from '@/lib/api';
import { Ic, LogoMarca } from '@/lib/ui';

export default function LayoutAdmin({ children }: { children: ReactNode }) {
  const router = useRouter();
  const caminho = usePathname();

  // 'carregando' até saber quem é: renderizar o shell antes disso mostraria
  // o back-office por um instante para quem não pode vê-lo.
  const [acesso, setAcesso] = useState<'carregando' | 'ok' | 'sem-permissao'>('carregando');

  useEffect(() => {
    if (!tokenAtual()) {
      router.replace('/login');
      return;
    }
    // Antes isto redirecionava calado para /painel, e quem digitava /admin
    // via a URL mudar sozinha sem entender o motivo.
    setAcesso(ehAdmin() ? 'ok' : 'sem-permissao');
  }, [router]);

  if (acesso === 'carregando') return <div className="carregando">Carregando…</div>;

  if (acesso === 'sem-permissao') {
    const escola = impersonando();
    return (
      <div className="adm">
        <div className="adm-bloqueio">
          <span className="ic">
            <Ic nome="lock" />
          </span>
          <h1>Esta área é do operador interno</h1>
          {escola ? (
            <>
              <p>
                Você está vendo o sistema como <b>{escola}</b>. Volte para a sua conta de
                administrador para abrir o back-office.
              </p>
              <button className="btn" onClick={voltarAoAdmin}>
                <Ic nome="arrow-back-up" />
                Voltar ao admin
              </button>
            </>
          ) : (
            <>
              <p>
                Você entrou como <b>{nomeAtual() || 'usuário da escola'}</b>, que só enxerga o
                painel da própria escola. Para gerenciar contratos, cobrança e bloqueio, entre com
                a conta de administrador.
              </p>
              <div className="adm-acoes">
                <button className="btn" onClick={sair}>
                  <Ic nome="logout" />
                  Entrar com outra conta
                </button>
                <Link href="/painel" className="btn ghost">
                  <Ic nome="layout-grid" />
                  Ir para o painel da escola
                </Link>
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="adm">
      <header className="adm-top">
        <Link href="/admin" className="adm-marca">
          <LogoMarca cor="#fff" />
          <b>
            Conecta<span>ADMIN</span>
          </b>
        </Link>
        <nav>
          <Link href="/admin" className={caminho === '/admin' ? 'ativo' : ''}>
            <Ic nome="building-community" />
            Escolas
          </Link>
        </nav>
        <div className="adm-quem">
          <span>{nomeAtual()}</span>
          <button onClick={sair} title="Sair">
            <Ic nome="logout" />
          </button>
        </div>
      </header>
      <main className="adm-conteudo">{children}</main>
    </div>
  );
}
