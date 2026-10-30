'use client';
// Responsáveis — lista da escola inteira e a importação por planilha, que é
// como uma escola de 400 alunos entra no sistema sem digitar um a um.
import Link from 'next/link';
import { ChangeEvent, useCallback, useEffect, useState } from 'react';
import { ListaResponsaveis, Responsavel, ResultadoImportacao, api } from '@/lib/api';
import { Ic, useToast } from '@/lib/ui';

export default function PaginaResponsaveis() {
  const [lista, setLista] = useState<ListaResponsaveis | null>(null);
  const [busca, setBusca] = useState('');
  const [semOptIn, setSemOptIn] = useState(false);
  const [pagina, setPagina] = useState(1);
  const [erro, setErro] = useState('');
  const [importando, setImportando] = useState(false);
  const [resultado, setResultado] = useState<ResultadoImportacao | null>(null);
  const { toast, toastEl } = useToast();

  const carregar = useCallback(() => {
    const q = new URLSearchParams();
    if (busca.trim()) q.set('busca', busca.trim());
    if (semOptIn) q.set('sem_opt_in', 'true');
    if (pagina > 1) q.set('pagina', String(pagina));
    api<ListaResponsaveis>(`/v1/painel/responsaveis?${q}`)
      .then((r) => {
        setLista(r);
        setErro('');
      })
      .catch((e) => setErro(e instanceof Error ? e.message : 'falha ao carregar'));
  }, [busca, semOptIn, pagina]);

  useEffect(carregar, [carregar]);

  async function importarArquivo(ev: ChangeEvent<HTMLInputElement>) {
    const arquivo = ev.target.files?.[0];
    ev.target.value = ''; // permite reenviar o mesmo arquivo depois de corrigir
    if (!arquivo) return;

    setImportando(true);
    setResultado(null);
    try {
      const linhas = lerPlanilha(await arquivo.text());
      if (linhas.length === 0) {
        throw new Error('nenhuma linha encontrada — confira o cabeçalho do arquivo');
      }
      const r = await api<ResultadoImportacao>('/v1/painel/responsaveis/importar', {
        method: 'POST',
        body: JSON.stringify({ linhas, opt_in: true }),
      });
      setResultado(r);
      setPagina(1);
      carregar();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'não foi possível importar');
    } finally {
      setImportando(false);
    }
  }

  const paginas = lista ? Math.ceil(lista.total / lista.por_pagina) : 1;

  return (
    <section>
      <div className="phead">
        <div>
          <h1>Responsáveis</h1>
          <p className="sub">Quem recebe os avisos de entrada e saída</p>
        </div>
        <label className={`btn ${importando ? 'ghost' : ''}`}>
          <Ic nome="table-import" />
          {importando ? 'Importando…' : 'Importar planilha'}
          <input
            type="file"
            accept=".csv,text/csv,text/plain"
            hidden
            onChange={importarArquivo}
            disabled={importando}
          />
        </label>
      </div>

      <div className="resp-orientacao">
        <span className="resp-orientacao-icone">
          <Ic nome="user-plus" />
        </span>
        <div className="resp-orientacao-texto">
          <b>Cadastro individual é feito pela ficha do aluno</b>
          <p>
            Para incluir um responsável, abra <b>Alunos</b>, selecione o aluno e clique em{' '}
            <b>Adicionar responsável</b>. Assim, ele já fica vinculado ao aluno correto.
          </p>
        </div>
        <Link href="/painel/alunos" className="btn ghost">
          Ver alunos
          <Ic nome="chevron-right" />
        </Link>
      </div>

      {resultado && (
        <div className={`card imp-resultado ${resultado.erros.length ? 'com-erro' : ''}`}>
          <h3>
            <Ic nome={resultado.erros.length ? 'alert-triangle' : 'circle-check'} />
            {resultado.criados} responsáve{resultado.criados === 1 ? 'l' : 'is'} criado
            {resultado.criados === 1 ? '' : 's'}, {resultado.vinculados} vínculo
            {resultado.vinculados === 1 ? '' : 's'} feito{resultado.vinculados === 1 ? '' : 's'}
          </h3>
          {resultado.erros.length > 0 ? (
            <>
              <p className="sub">
                {resultado.erros.length} de {resultado.total} linhas não entraram. Corrija na
                planilha e importe de novo — o que já entrou não duplica.
              </p>
              <ul className="imp-erros">
                {resultado.erros.slice(0, 12).map((e) => (
                  <li key={e.linha}>
                    <b>Linha {e.linha}</b> {e.motivo}
                  </li>
                ))}
                {resultado.erros.length > 12 && (
                  <li>… e mais {resultado.erros.length - 12} linha(s).</li>
                )}
              </ul>
            </>
          ) : (
            <p className="sub">Todas as {resultado.total} linhas entraram.</p>
          )}
          <button className="btn ghost" onClick={() => setResultado(null)}>
            Fechar
          </button>
        </div>
      )}

      <details className="card imp-ajuda">
        <summary>
          <Ic nome="file-spreadsheet" />
          Como montar a planilha
        </summary>

        <ol className="imp-passos">
          <li>
            Abra o Excel (ou o Google Planilhas) e crie uma planilha nova.
          </li>
          <li>
            <p className="imp-passo-texto">
              Na <b>primeira linha</b>, escreva exatamente estes títulos das colunas:
            </p>
            <div className="imp-colunas" role="list">
              <span role="listitem">
                <strong>matricula</strong>
                <small>código do aluno</small>
              </span>
              <span role="listitem">
                <strong>nome</strong>
                <small>do responsável</small>
              </span>
              <span role="listitem">
                <strong>telefone</strong>
                <small>WhatsApp com DDD</small>
              </span>
              <span role="listitem">
                <strong>parentesco</strong>
                <small>mãe, pai… (opcional)</small>
              </span>
            </div>
          </li>
          <li>
            Em cada linha seguinte, preencha um responsável. A <b>matrícula</b> é o mesmo
            código que aparece na tela <Link href="/painel/alunos">Alunos</Link> (coluna
            Matrícula) — é assim que o sistema liga o responsável ao aluno certo.
          </li>
          <li>
            Se o mesmo pai ou mãe cuida de mais de um aluno, <b>repita o telefone</b> em
            outra linha com a matrícula do outro filho. O sistema une tudo em um único
            cadastro, sem duplicar.
          </li>
          <li>
            Salve o arquivo como <b>CSV</b> (no Excel: Arquivo → Salvar como → CSV) e use o
            botão <b>Importar planilha</b> acima.
          </li>
        </ol>

        <p className="imp-exemplo-titulo">Exemplo pronto para copiar:</p>
        <div className="imp-tabela-wrap">
          <table className="imp-tabela-exemplo">
            <thead>
              <tr>
                <th>matricula</th>
                <th>nome</th>
                <th>telefone</th>
                <th>parentesco</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>1001</td>
                <td>Maria da Silva</td>
                <td>(81) 99999-0000</td>
                <td>mãe</td>
              </tr>
              <tr>
                <td>1002</td>
                <td>João Souza</td>
                <td>(81) 98888-7777</td>
                <td>pai</td>
              </tr>
              <tr>
                <td>1003</td>
                <td>Maria da Silva</td>
                <td>(81) 99999-0000</td>
                <td>mãe</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="imp-dica">
          No exemplo, Maria aparece duas vezes (alunos 1001 e 1003) com o mesmo telefone —
          depois da importação ela fica como <b>um</b> responsável com dois filhos.
        </p>
        <div className="imp-acoes">
          <a className="btn ghost" href={urlModeloCsv()} download="modelo-responsaveis.csv">
            <Ic nome="download" />
            Baixar modelo CSV
          </a>
          <span className="mut">Abra no Excel, preencha e importe.</span>
        </div>
      </details>

      <div className="fbar">
        <div className="fsearch">
          <Ic nome="search" />
          <input
            value={busca}
            onChange={(e) => {
              setBusca(e.target.value);
              setPagina(1);
            }}
            placeholder="Filtrar por nome ou telefone…"
          />
        </div>
        <button
          className={`chip ${semOptIn ? 'ativo' : ''}`}
          onClick={() => {
            setSemOptIn((v) => !v);
            setPagina(1);
          }}
        >
          <Ic nome="shield-x" />
          Sem autorização
        </button>
      </div>

      <div className="tcard">
        {erro ? (
          <div className="carregando">{erro}</div>
        ) : !lista ? (
          <div className="carregando">Carregando responsáveis…</div>
        ) : lista.responsaveis.length === 0 ? (
          <div className="empty">
            <Ic nome="user-heart" />
            {busca || semOptIn
              ? 'Nenhum responsável com esse filtro.'
              : 'Nenhum responsável ainda. Importe a planilha ou cadastre pela ficha de um aluno.'}
          </div>
        ) : (
          <>
            <div className="tw">
              <table>
                <thead>
                  <tr>
                    <th>Responsável</th>
                    <th>Telefone</th>
                    <th>Alunos</th>
                    <th>Avisos</th>
                    <th>LGPD</th>
                  </tr>
                </thead>
                <tbody>
                  {lista.responsaveis.map((r) => (
                    <tr key={r.id}>
                      <td>
                        <b>{r.name}</b>
                        {r.relation && <small className="rel"> · {r.relation}</small>}
                      </td>
                      <td className="tel-col">{formatarTelefone(r.phone)}</td>
                      <td>
                        {r.alunos.length === 0 ? (
                          <span className="pill p-sun">sem aluno</span>
                        ) : (
                          <div className="chips-alunos">
                            {r.alunos.map((a) => (
                              <Link key={a.id} href={`/painel/alunos/${a.id}`} className="chip-aluno">
                                {a.name}
                                {a.class_name && <small>{a.class_name}</small>}
                              </Link>
                            ))}
                          </div>
                        )}
                      </td>
                      <td>
                        <Avisos r={r} />
                      </td>
                      <td>
                        {r.opt_in ? (
                          <span className="pill p-mint">
                            <Ic nome="shield-check" />
                            Autorizado
                          </span>
                        ) : (
                          <span className="pill p-coral" title="Sem autorização, o sistema não envia avisos">
                            <Ic nome="shield-x" />
                            Sem autorização
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {paginas > 1 && (
              <div className="tfoot">
                <span className="info">
                  {pagina} de {paginas} · {lista.total} responsáveis
                </span>
                <div className="pages">
                  <button className="btn ghost" disabled={pagina <= 1} onClick={() => setPagina((p) => p - 1)}>
                    Anterior
                  </button>
                  <button
                    className="btn ghost"
                    disabled={pagina >= paginas}
                    onClick={() => setPagina((p) => p + 1)}
                  >
                    Próxima
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
      {toastEl}
    </section>
  );
}

function Avisos({ r }: { r: Responsavel }) {
  const entrada = r.alunos.some((a) => a.notify_entry);
  const saida = r.alunos.some((a) => a.notify_exit);
  if (!entrada && !saida) return <span className="pill p-grey">nenhum</span>;
  return (
    <span className="avisos-col">
      {entrada && (
        <span className="pill p-sky">
          <Ic nome="login" />
          entrada
        </span>
      )}
      {saida && (
        <span className="pill p-violet">
          <Ic nome="logout" />
          saída
        </span>
      )}
    </span>
  );
}

/** Modelo CSV com cabeçalho e 2 linhas de exemplo (separador `;` do Excel BR). */
function urlModeloCsv(): string {
  const conteudo = [
    'matricula;nome;telefone;parentesco',
    '1001;Maria da Silva;(81) 99999-0000;mãe',
    '1002;João Souza;(81) 98888-7777;pai',
  ].join('\n');
  return `data:text/csv;charset=utf-8,${encodeURIComponent(conteudo)}`;
}

/**
 * CSV da secretaria: aceita `;` ou `,` como separador (Excel brasileiro usa
 * ponto e vírgula) e encontra as colunas pelo cabeçalho, em qualquer ordem.
 */
function lerPlanilha(texto: string): {
  aluno_external_id: string;
  nome: string;
  telefone: string;
  parentesco?: string;
}[] {
  const linhas = texto
    .replace(/^﻿/, '') // BOM que o Excel escreve
    .split(/\r?\n/)
    .filter((l) => l.trim());
  if (linhas.length < 2) return [];

  const sep = (linhas[0].match(/;/g) ?? []).length >= (linhas[0].match(/,/g) ?? []).length ? ';' : ',';
  const cabecalho = linhas[0].split(sep).map((c) => c.trim().toLowerCase().replace(/^"|"$/g, ''));
  const col = (...nomes: string[]) => cabecalho.findIndex((c) => nomes.includes(c));
  const iAluno = col('aluno_external_id', 'aluno', 'matricula', 'matrícula', 'codigo', 'código');
  const iNome = col('nome', 'responsavel', 'responsável');
  const iTel = col('telefone', 'celular', 'whatsapp', 'fone');
  const iPar = col('parentesco', 'relacao', 'relação', 'vinculo', 'vínculo');
  if (iAluno < 0 || iNome < 0 || iTel < 0) {
    throw new Error(
      'a planilha precisa das colunas matricula (ou aluno), nome e telefone na primeira linha',
    );
  }

  return linhas.slice(1).map((linha) => {
    const c = linha.split(sep).map((v) => v.trim().replace(/^"|"$/g, ''));
    return {
      aluno_external_id: c[iAluno] ?? '',
      nome: c[iNome] ?? '',
      telefone: c[iTel] ?? '',
      ...(iPar >= 0 && c[iPar] ? { parentesco: c[iPar] } : {}),
    };
  });
}

/** +5581999990000 -> (81) 99999-0000 */
function formatarTelefone(e164: string): string {
  const d = e164.replace(/\D/g, '').replace(/^55/, '');
  const m = d.match(/^(\d{2})(\d{4,5})(\d{4})$/);
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : e164;
}
