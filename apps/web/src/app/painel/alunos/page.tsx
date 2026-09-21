'use client';
// Alunos — lista sincronizada da catraca, layout do entrou-mockup.html.
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
  const [totalGeral, setTotalGeral] = useState<number | null>(null);
  const [totalSemResp, setTotalSemResp] = useState<number | null>(null);
  const [erro, setErro] = useState('');
  const { toast, toastEl } = useToast();

  // valores vindos da URL (busca do topo, tile do dashboard)
  useEffect(() => {
    setBusca(params.get('busca') ?? '');
    setSemResp(params.get('sem_responsavel') === '1');
    setPagina(1);
  }, [params]);

  useEffect(() => {
    let ativo = true;
    const q = new URLSearchParams();
    if (busca.trim()) q.set('busca', busca.trim());
    if (semResp) q.set('sem_responsavel', '1');
    q.set('pagina', String(pagina));
    const t = setTimeout(() => {
      api<RespostaAlunos>(`/v1/painel/alunos?${q}`)
        .then((r) => {
          if (ativo) {
            setDados(r);
            setErro('');
          }
        })
        .catch((e) => ativo && setErro(e instanceof Error ? e.message : 'falha ao carregar'));
    }, 250); // debounce da busca
    return () => {
      ativo = false;
      clearTimeout(t);
    };
  }, [busca, semResp, pagina]);

  useEffect(() => {
    api<RespostaAlunos>('/v1/painel/alunos?pagina=1')
      .then((r) => setTotalGeral(r.total))
      .catch(() => {});
    api<RespostaAlunos>('/v1/painel/alunos?sem_responsavel=1&pagina=1')
      .then((r) => setTotalSemResp(r.total))
      .catch(() => {});
  }, []);

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
  const comResp =
    totalGeral !== null && totalSemResp !== null ? totalGeral - totalSemResp : null;

  return (
    <section>
      <div className="phead">
        <div>
          <h1>Alunos</h1>
          <p className="sub">
            {totalGeral !== null
              ? `${totalGeral} alunos sincronizados da catraca`
              : 'Sincronizados da catraca'}{' '}
            <span className="live-dot" />
          </p>
        </div>
        <button className="btn" onClick={() => toast('A sincronização roda pelo agente na escola')}>
          <Ic nome="refresh" />
          Sincronizar agora
        </button>
      </div>

      {erro && <div className="erro-inline">{erro}</div>}

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
            <b>{totalGeral ?? '—'}</b>
            <small>Todos os alunos</small>
            <span className="mut">100% sincronizados</span>
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
            <b>{totalSemResp ?? '—'}</b>
            <small>Sem responsável</small>
            <span className="mut">
              {totalGeral && totalSemResp !== null && totalGeral > 0
                ? `${((totalSemResp / totalGeral) * 100).toFixed(1).replace('.', ',')}% do total`
                : 'não recebem avisos'}
            </span>
          </div>
        </div>
        <div className="stat s-mint">
          <span className="ic"><Ic nome="shield-check" /></span>
          <div>
            <b>{comResp ?? '—'}</b>
            <small>Com responsável</small>
            <span className="mut">prontos para avisos</span>
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
          <div className="carregando">Carregando alunos…</div>
        ) : dados.alunos.length === 0 ? (
          <div className="empty">
            <Ic nome="users" />
            Nenhum aluno encontrado nesse filtro.
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
                      {a.pendente ? (
                        <span className="pill p-sun">
                          <Ic nome="user-off" />
                          Sem responsável
                        </span>
                      ) : (
                        <span className="pill p-mint">Ativo</span>
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
