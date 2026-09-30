'use client';
// Alunos — lista sincronizada da catraca, layout do entrou-mockup.html.
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { api, RespostaAlunos } from '@/lib/api';
import { AvatarAluno, Ic, PillTurma, useToast } from '@/lib/ui';

const POR_PAGINA = 50; // mesmo recorte da API

function Conteudo() {
  const router = useRouter();
  const params = useSearchParams();
  const [busca, setBusca] = useState(params.get('busca') ?? '');
  const [semResp, setSemResp] = useState(params.get('sem_responsavel') === '1');
  const [pagina, setPagina] = useState(1);
  const [dados, setDados] = useState<RespostaAlunos | null>(null);
  const [erro, setErro] = useState('');
  const [carregando, setCarregando] = useState(true);
  const [tentativa, setTentativa] = useState(0);
  const { toast, toastEl } = useToast();

  // valores vindos da URL (busca do topo, tile do dashboard)
  useEffect(() => {
    setBusca(params.get('busca') ?? '');
    setSemResp(params.get('sem_responsavel') === '1');
    setPagina(1);
  }, [params]);

  useEffect(() => {
    let ativo = true;
    setCarregando(true);
    setErro('');
    const q = new URLSearchParams();
    if (busca.trim()) q.set('busca', busca.trim());
    if (semResp) q.set('sem_responsavel', '1');
    q.set('pagina', String(pagina));
    const t = setTimeout(() => {
      api<RespostaAlunos>(`/v1/painel/alunos?${q}`)
        .then((r) => {
          if (ativo) {
            setDados(r);
          }
        })
        .catch((e) => ativo && setErro(e instanceof Error ? e.message : 'Falha ao carregar alunos.'))
        .finally(() => ativo && setCarregando(false));
    }, 250); // debounce da busca
    return () => {
      ativo = false;
      clearTimeout(t);
    };
  }, [busca, semResp, pagina, tentativa]);

  function exportarCsv() {
    if (!dados || dados.alunos.length === 0) {
      toast('Nada para exportar nesse filtro');
      return;
    }
    const linhas = [
      'nome;turma;matricula;cartao;responsaveis',
      ...dados.alunos.map((a) =>
        [a.name, a.class_name ?? '', a.external_id, a.card ?? '', a.responsaveis].join(';'),
      ),
    ];
    const blob = new Blob(['﻿' + linhas.join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'alunos.csv';
    a.click();
    URL.revokeObjectURL(a.href);
    toast('CSV exportado');
  }

  const total = dados?.total ?? 0;
  const totalPaginas = Math.max(1, Math.ceil(total / POR_PAGINA));
  const inicio = total === 0 ? 0 : (pagina - 1) * POR_PAGINA + 1;
  const fim = dados ? inicio + dados.alunos.length - 1 : 0;
  const semFiltro = !busca.trim() && !semResp;
  const resumo = dados?.resumo ?? (
    dados?.total === 0 && semFiltro
      ? { total: 0, sincronizados: 0, aguardando_sincronizacao: 0, sem_responsavel: 0 }
      : null
  );
  const resumoIndisponivel = !!dados && !dados.resumo && !(dados.total === 0 && semFiltro);
  const comResp = resumo ? resumo.total - resumo.sem_responsavel : null;

  return (
    <section>
      <div className="phead">
        <div>
          <h1>Alunos</h1>
          <p className="sub">
            {resumo
              ? `${resumo.sincronizados} ${resumo.sincronizados === 1 ? 'aluno sincronizado' : 'alunos sincronizados'} da catraca · ${resumo.aguardando_sincronizacao} aguardando cadastro`
              : erro
                ? 'Não foi possível obter a situação do cadastro.'
                : carregando
                  ? 'Carregando situação do cadastro…'
                  : 'Resumo de sincronização indisponível; tente novamente.'}{' '}
            {!erro && carregando && <span className="live-dot" />}
          </p>
        </div>
        <button className="btn" onClick={() => router.push('/painel/onboarding')}>
          <Ic nome="refresh" />
          Ver status do agente
        </button>
      </div>

      {erro && (
        <div className="erro-inline">
          {erro}{' '}
          <button className="btn ghost" onClick={() => setTentativa((n) => n + 1)}>
            Tentar novamente
          </button>
        </div>
      )}
      {resumoIndisponivel && !erro && (
        <div className="erro-inline">
          A API não enviou o resumo de sincronização. Atualize ou reinicie a API local e tente novamente.{' '}
          <button className="btn ghost" onClick={() => setTentativa((n) => n + 1)}>
            Tentar novamente
          </button>
        </div>
      )}

      <div className="stats">
        <div
          className="stat s-sky"
          onClick={() => {
            setSemResp(false);
            setPagina(1);
          }}
        >
          <span className="ic"><Ic nome="users" /></span>
          <div>
            <b>{resumo?.total ?? '—'}</b>
            <small>Alunos ativos</small>
            <span className="mut">
              {resumo
                ? `${resumo.sincronizados} ${resumo.sincronizados === 1 ? 'sincronizado' : 'sincronizados'} · ${resumo.aguardando_sincronizacao} pendentes`
                : erro ? 'Falha ao carregar' : carregando ? 'Carregando cadastro' : 'Resumo indisponível'}
            </span>
          </div>
        </div>
        <div
          className="stat s-coral"
          onClick={() => {
            setSemResp(true);
            setPagina(1);
          }}
        >
          <span className="ic"><Ic nome="user-off" /></span>
          <div>
            <b>{resumo?.sem_responsavel ?? '—'}</b>
            <small>Sem responsável</small>
            <span className="mut">
              {resumo && resumo.total > 0
                ? `${((resumo.sem_responsavel / resumo.total) * 100).toFixed(1).replace('.', ',')}% do total`
                : 'não recebem avisos'}
            </span>
          </div>
        </div>
        <div className="stat s-mint">
          <span className="ic"><Ic nome="shield-check" /></span>
          <div>
            <b>{comResp ?? '—'}</b>
            <small>Com responsável</small>
            <span className="mut">responsável vinculado</span>
          </div>
        </div>
      </div>

      <div className="fbar">
        <div className="fsearch">
          <Ic nome="search" />
          <input
            placeholder="Filtrar por nome do aluno…"
            value={busca}
            onChange={(e) => {
              setBusca(e.target.value);
              setPagina(1);
            }}
          />
        </div>
        <select
          className="sel"
          value={semResp ? 'semresp' : 'todos'}
          onChange={(e) => {
            setSemResp(e.target.value === 'semresp');
            setPagina(1);
          }}
        >
          <option value="todos">Todos os status</option>
          <option value="semresp">Sem responsável</option>
        </select>
        <div className="push">
          <button className="btn white" onClick={exportarCsv}>
            <Ic nome="download" />
            Exportar
          </button>
        </div>
      </div>

      <div className="tcard">
        {!dados ? (
          <div className="carregando">{carregando ? 'Carregando alunos…' : 'Não foi possível carregar a lista.'}</div>
        ) : dados.alunos.length === 0 ? (
          <div className="empty">
            <Ic nome="users" />
            {dados.total === 0 && semFiltro ? (
              <>
                Nenhum cadastro recebido da catraca ainda.
                <br />
                Confira se o agente está online em <Link href="/painel/onboarding">Primeiros passos</Link>.
              </>
            ) : (
              'Nenhum aluno encontrado com esses filtros.'
            )}
          </div>
        ) : (
          <div className="tw">
            <table>
              <thead>
                <tr>
                  <th>Aluno</th>
                  <th>Turma</th>
                  <th>Matrícula</th>
                  <th>Responsáveis</th>
                  <th>Status</th>
                  <th style={{ textAlign: 'right' }}>Ações</th>
                </tr>
              </thead>
              <tbody>
                {dados.alunos.map((a) => (
                  <tr
                    key={a.id}
                    className="clickable"
                    onClick={() => router.push(`/painel/alunos/${a.id}`)}
                  >
                    <td>
                      <div className="who">
                        <AvatarAluno nome={a.name} />
                        <div>
                          <b>{a.name}</b>
                          <small>{a.class_name ?? 'sem turma'}</small>
                        </div>
                      </div>
                    </td>
                    <td>
                      <PillTurma turma={a.class_name} />
                    </td>
                    <td>
                      <b style={{ fontSize: 13 }}>{a.external_id}</b>
                    </td>
                    <td>
                      {a.responsaveis > 0 ? (
                        <b style={{ fontSize: 13.5 }}>
                          {a.responsaveis} {a.responsaveis === 1 ? 'cadastrado' : 'cadastrados'}
                        </b>
                      ) : (
                        <span className="pill btnish">
                          <Ic nome="user-plus" />
                          Cadastrar responsável
                        </span>
                      )}
                    </td>
                    <td>
                      {!a.sincronizado ? (
                        <span className="pill p-sun">
                          <Ic nome="refresh" />
                          Aguardando sincronização
                        </span>
                      ) : a.pendente ? (
                        <span className="pill p-sun">
                          <Ic nome="user-off" />
                          Sem responsável
                        </span>
                      ) : (
                        <span className="pill p-mint">Sincronizado</span>
                      )}
                    </td>
                    <td className="acts">
                      <Ic nome="eye" title="Abrir ficha" />
                      <Ic nome="chevron-right" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {dados && total > 0 && (
          <div className="tfoot">
            <span className="info">
              Mostrando {inicio} a {fim} de {total} alunos
            </span>
            <div className="pages">
              <span
                className="pg"
                onClick={() => setPagina((p) => Math.max(1, p - 1))}
              >
                <Ic nome="chevron-left" />
              </span>
              {Array.from({ length: totalPaginas }, (_, i) => i + 1)
                .filter((n) => n === 1 || n === totalPaginas || Math.abs(n - pagina) <= 2)
                .map((n, idx, arr) => (
                  <span key={n} style={{ display: 'contents' }}>
                    {idx > 0 && arr[idx - 1] !== n - 1 && <span className="pg dots">…</span>}
                    <span
                      className={`pg${n === pagina ? ' on' : ''}`}
                      onClick={() => setPagina(n)}
                    >
                      {n}
                    </span>
                  </span>
                ))}
              <span
                className="pg"
                onClick={() => setPagina((p) => Math.min(totalPaginas, p + 1))}
              >
                <Ic nome="chevron-right" />
              </span>
            </div>
            <span className="info">{POR_PAGINA} por página</span>
          </div>
        )}
      </div>
      {toastEl}
    </section>
  );
}

export default function PaginaAlunos() {
  return (
    <Suspense fallback={<div className="carregando">Carregando alunos…</div>}>
      <Conteudo />
    </Suspense>
  );
}
