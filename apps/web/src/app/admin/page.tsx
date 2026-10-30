'use client';
// Lista de escolas: o operador bate o olho, vê quem está com problema e age.
import Link from 'next/link';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import {
  AgenteMudo,
  EscolaAdmin,
  PILL_COBRANCA,
  ROTULO_COBRANCA,
  ResumoAdmin,
  duracaoCurta,
  formatarCnpj,
} from '@/lib/admin';
import { Ic, quandoCurto, useToast } from '@/lib/ui';

export default function PaginaEscolas() {
  const [resumo, setResumo] = useState<ResumoAdmin | null>(null);
  const [escolas, setEscolas] = useState<EscolaAdmin[] | null>(null);
  const [mudos, setMudos] = useState<AgenteMudo[]>([]);
  const [busca, setBusca] = useState('');
  const [erro, setErro] = useState('');
  const [novaAberta, setNovaAberta] = useState(false);
  const [criada, setCriada] = useState<{
    nome: string;
    email: string;
    senha: string;
    api_key: string;
  } | null>(null);
  const { toast, toastEl } = useToast();

  const carregar = useCallback(
    (termo = '') => {
      const q = termo ? `?busca=${encodeURIComponent(termo)}` : '';
      Promise.all([
        api<ResumoAdmin>('/v1/admin/resumo'),
        api<{ escolas: EscolaAdmin[] }>(`/v1/admin/escolas${q}`),
        api<AgenteMudo[]>('/v1/admin/agentes-mudos'),
      ])
        .then(([r, l, m]) => {
          setResumo(r);
          setEscolas(l.escolas);
          setMudos(m);
          setErro('');
        })
        .catch((e) => setErro(e instanceof Error ? e.message : 'falha ao carregar'));
    },
    [],
  );

  useEffect(() => {
    carregar();
  }, [carregar]);

  async function criarEscola(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    try {
      const r = await api<{ nome: string; email: string; senha: string; api_key: string }>(
        '/v1/admin/escolas',
        {
          method: 'POST',
          body: JSON.stringify({
            nome: String(f.get('nome')),
            email: String(f.get('email')),
            cnpj: String(f.get('cnpj') || '') || undefined,
            plano: String(f.get('plano') || '') || undefined,
            max_alunos: Number(f.get('max_alunos')) || undefined,
            max_chips: Number(f.get('max_chips')) || undefined,
          }),
        },
      );
      setCriada(r);
      setNovaAberta(false);
      carregar(busca);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'não foi possível criar');
    }
  }

  if (erro && !escolas) return <div className="carregando">{erro}</div>;

  return (
    <section>
      <div className="phead">
        <div>
          <h1>Escolas</h1>
          <p className="sub">Contratos, limites, cobrança e bloqueio</p>
        </div>
        <button className="btn" onClick={() => setNovaAberta((v) => !v)}>
          <Ic nome="plus" />
          Nova escola
        </button>
      </div>

      {resumo && (
        <div className="adm-cards">
          <Indicador icone="building-community" tom="s-violet" valor={resumo.escolas} rotulo="Escolas" />
          <Indicador icone="lock" tom="s-coral" valor={resumo.bloqueadas} rotulo="Bloqueadas" />
          <Indicador icone="cash-off" tom="s-sun" valor={resumo.inadimplentes} rotulo="Em atraso" />
          <Indicador icone="file-invoice" tom="s-sky" valor={resumo.sem_nota} rotulo="Sem nota" />
          <Indicador
            icone="antenna-off"
            tom={resumo.agentes_mudos > 0 ? 's-coral' : 's-mint'}
            valor={resumo.agentes_mudos}
            rotulo="Agentes mudos"
          />
          <Indicador icone="send" tom="s-mint" valor={resumo.mensagens_mes} rotulo="Msgs no mês" />
        </div>
      )}

      {mudos.length > 0 && (
        <div className="adm-alerta">
          <Ic nome="antenna-off" />
          <div>
            <b>
              {mudos.length} agente{mudos.length === 1 ? '' : 's'} sem dar sinal
            </b>
            <small>
              Os giros da catraca não estão chegando — nenhum aviso sai enquanto isso.
            </small>
            <ul className="adm-mudos">
              {mudos.map((m) => (
                <li key={m.escola_id}>
                  <Link href={`/admin/${m.escola_id}`}>{m.escola}</Link>
                  <span>
                    Sem sinal há {duracaoCurta(m.mudo_ha_minutos)}
                    {m.ultimo_sinal ? ` · último sinal ${quandoCurto(m.ultimo_sinal)}` : ''}
                  </span>
                  {m.ja_avisado && <em>alerta enviado</em>}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {criada && (
        <div className="card adm-segredo">
          <h3>
            <Ic nome="key" /> {criada.nome} criada
          </h3>
          <p className="sub">
            Estes dados <b>não aparecem de novo</b>. Copie antes de fechar.
          </p>
          <Segredo rotulo="Login do painel" valor={criada.email} />
          <Segredo rotulo="Senha" valor={criada.senha} />
          <Segredo rotulo="API key do agente" valor={criada.api_key} />
          <button className="btn ghost" onClick={() => setCriada(null)}>
            Já copiei, fechar
          </button>
        </div>
      )}

      {novaAberta && (
        <form className="card adm-form" onSubmit={criarEscola}>
          <h3>Nova escola</h3>
          <div className="adm-grid">
            <label className="field">
              <span>Nome</span>
              <input name="nome" required placeholder="Escola Municipal…" />
            </label>
            <label className="field">
              <span>E-mail da direção</span>
              <input name="email" type="email" required placeholder="direcao@escola.com.br" />
            </label>
            <label className="field">
              <span>CNPJ</span>
              <input name="cnpj" placeholder="00.000.000/0001-00" />
            </label>
            <label className="field">
              <span>Plano</span>
              <input name="plano" defaultValue="basico" />
            </label>
            <label className="field">
              <span>Alunos liberados</span>
              <input name="max_alunos" type="number" min={1} placeholder="sem teto" />
            </label>
            <label className="field">
              <span>Chips (números)</span>
              <input name="max_chips" type="number" min={1} defaultValue={1} />
            </label>
          </div>
          <button className="btn">
            <Ic nome="check" />
            Criar escola
          </button>
          <button className="btn ghost" type="button" onClick={() => setNovaAberta(false)}>
            Cancelar
          </button>
        </form>
      )}

      <div className="fsearch">
        <Ic nome="search" />
        <input
          value={busca}
          onChange={(e) => {
            setBusca(e.target.value);
            carregar(e.target.value);
          }}
          placeholder="Buscar por nome ou CNPJ…"
        />
      </div>

      <div className="tcard">
        {!escolas ? (
          <div className="carregando">Carregando escolas…</div>
        ) : escolas.length === 0 ? (
          <div className="empty">
            <Ic nome="building-community" />
            Nenhuma escola encontrada.
          </div>
        ) : (
          <div className="tw">
          <table className="adm-tabela">
            <thead>
              <tr>
                <th>Escola</th>
                <th>Alunos</th>
                <th>Chips</th>
                <th>Agente</th>
                <th>Msgs/mês</th>
                <th>Cobrança</th>
                <th>Situação</th>
              </tr>
            </thead>
            <tbody>
              {escolas.map((e) => (
                <tr key={e.id} className={e.bloqueado ? 'bloqueada' : ''}>
                  <td>
                    <Link href={`/admin/${e.id}`} className="adm-nome">
                      <b>{e.nome}</b>
                      <small>{formatarCnpj(e.cnpj)}</small>
                    </Link>
                  </td>
                  <td>
                    <span className={e.uso.alunos_acima_do_teto ? 'estourado' : ''}>
                      {e.uso.alunos}
                      {e.contrato.max_alunos ? ` / ${e.contrato.max_alunos}` : ''}
                    </span>
                  </td>
                  <td>
                    {e.uso.chips_conectados} / {e.contrato.max_chips}
                  </td>
                  <td>
                    <span className={`pill ${e.agente.online ? 'p-mint' : 'p-grey'}`}>
                      {e.agente.online ? 'online' : 'offline'}
                    </span>
                  </td>
                  <td>
                    {e.uso.mensagens_mes}
                    {e.uso.falhas_mes > 0 && (
                      <small className="falhas"> · {e.uso.falhas_mes} falhas</small>
                    )}
                  </td>
                  <td>
                    <span className={`pill ${PILL_COBRANCA[e.cobranca.status]}`}>
                      {ROTULO_COBRANCA[e.cobranca.status]}
                    </span>
                    {!e.cobranca.nota_emitida && e.cobranca.status !== 'isento' && (
                      <small className="semnota"> sem NF</small>
                    )}
                  </td>
                  <td>
                    {e.bloqueado ? (
                      <span className="pill p-coral">
                        <Ic nome="lock" />
                        Bloqueada
                      </span>
                    ) : e.saudavel ? (
                      <span className="pill p-mint">
                        <Ic nome="circle-check" />
                        Operação normal
                      </span>
                    ) : (
                      <span className="pill p-sun">
                        <Ic nome="alert-triangle" />
                        Atenção operacional
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </div>
      {toastEl}
    </section>
  );
}

function Indicador({
  icone,
  tom,
  valor,
  rotulo,
}: {
  icone: string;
  tom: string;
  valor: number;
  rotulo: string;
}) {
  return (
    <div className="card stat">
      <span className={`ic ${tom}`}>
        <Ic nome={icone} />
      </span>
      <div>
        <b>{valor}</b>
        <small>{rotulo}</small>
      </div>
    </div>
  );
}

function Segredo({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="field">
      <label>{rotulo}</label>
      <div className="keybox">
        <span>{valor}</span>
        <Ic
          nome="copy"
          title="Copiar"
          onClick={() => navigator.clipboard.writeText(valor).catch(() => undefined)}
        />
      </div>
    </div>
  );
}
