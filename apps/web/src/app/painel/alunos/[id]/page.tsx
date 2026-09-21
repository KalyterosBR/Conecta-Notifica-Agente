'use client';
// Ficha do aluno — responsáveis, preferências de aviso e histórico de acessos.
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { AlunoDetalhe, api } from '@/lib/api';
import {
  AvatarAluno,
  AvIniciais,
  Ic,
  paraE164,
  PillEvento,
  quandoCurto,
  telefoneBonito,
  useToast,
} from '@/lib/ui';

export default function PaginaAluno() {
  const { id } = useParams<{ id: string }>();
  const [aluno, setAluno] = useState<AlunoDetalhe | null>(null);
  const [erro, setErro] = useState('');
  const [formAberto, setFormAberto] = useState(false);
  const { toast, toastEl } = useToast();

  const carregar = useCallback(() => {
    api<AlunoDetalhe>(`/v1/painel/alunos/${id}`)
      .then((r) => {
        setAluno(r);
        setErro('');
      })
      .catch((e) => setErro(e instanceof Error ? e.message : 'falha ao carregar'));
  }, [id]);

  useEffect(carregar, [carregar]);

  async function mudarVinculo(respId: string, campo: 'notify_entry' | 'notify_exit', valor: boolean) {
    if (!aluno) return;
    const anterior = aluno;
    setAluno({
      ...aluno,
      responsaveis: aluno.responsaveis.map((r) =>
        r.id === respId ? { ...r, [campo]: valor } : r,
      ),
    });
    try {
      await api(`/v1/painel/alunos/${id}/responsaveis/${respId}`, {
        method: 'PATCH',
        body: JSON.stringify({ [campo]: valor }),
      });
      toast('Preferência salva');
    } catch {
      setAluno(anterior);
      toast('Não foi possível salvar');
    }
  }

  async function mudarOptIn(respId: string, valor: boolean) {
    try {
      await api(`/v1/painel/responsaveis/${respId}`, {
        method: 'PATCH',
        body: JSON.stringify({ opt_in: valor }),
      });
      toast(valor ? 'Opt-in registrado' : 'Opt-out registrado');
      carregar();
    } catch {
      toast('Não foi possível salvar');
    }
  }

  if (erro && !aluno) return <div className="carregando">{erro}</div>;
  if (!aluno) return <div className="carregando">Carregando aluno…</div>;

  const totalAvisos = aluno.acessos.reduce((s, a) => s + a.avisos, 0);

  return (
    <section>
      <p className="crumb">
        <Link href="/painel/alunos">Alunos</Link> <Ic nome="chevron-right" /> <span>{aluno.name}</span>
      </p>

      <div className="hero">
        <div className="card" style={{ display: 'flex', alignItems: 'center' }}>
          <div className="profile">
            <AvatarAluno nome={aluno.name} className="av" />
            <div>
              <h1 style={{ fontSize: 23 }}>{aluno.name}</h1>
              <div className="facts">
                <div>
                  <small>Turma</small>
                  <b>{aluno.class_name ?? '—'}</b>
                </div>
                <div>
                  <small>Matrícula</small>
                  <b>{aluno.external_id}</b>
                </div>
                <div>
                  <small>Origem</small>
                  <b>
                    <Ic nome="refresh" style={{ color: 'var(--sky)' }} /> Catraca
                  </b>
                </div>
                <div>
                  <small>Status</small>
                  <b style={{ color: aluno.active ? '#106B48' : 'var(--ink-3)' }}>
                    {aluno.active ? 'Ativo' : 'Inativo'}
                  </b>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div className="card" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 4 }}>
          <h3 style={{ marginBottom: 4 }}>Últimos acessos</h3>
          <div className="kv">
            <span>Acessos registrados</span>
            <b>{aluno.acessos.length}</b>
          </div>
          <div className="kv">
            <span>Avisos disparados</span>
            <b>{totalAvisos}</b>
          </div>
          <div className="kv">
            <span>Responsáveis</span>
            <b>{aluno.responsaveis.length}</b>
          </div>
        </div>
      </div>

      <div className="section">
        <h2>Responsáveis</h2>
        <button className="btn" onClick={() => setFormAberto((v) => !v)}>
          <Ic nome={formAberto ? 'x' : 'plus'} />
          {formAberto ? 'Fechar' : 'Adicionar responsável'}
        </button>
      </div>

      {formAberto && (
        <FormResponsavel
          alunoId={aluno.id}
          aoSalvar={() => {
            setFormAberto(false);
            carregar();
            toast('Responsável cadastrado');
          }}
        />
      )}

      {aluno.responsaveis.length === 0 ? (
        !formAberto && (
          <div className="tcard">
            <div className="empty">
              <Ic nome="user-plus" />
              Nenhum responsável cadastrado.
              <br />
              Os avisos deste aluno ficam retidos até você cadastrar alguém.
              <br />
              <br />
              <button className="btn" onClick={() => setFormAberto(true)}>
                <Ic nome="plus" />
                Cadastrar agora
              </button>
            </div>
          </div>
        )
      ) : (
        <div className="tcard">
          <div className="tw">
            <table style={{ minWidth: 620 }}>
              <thead>
                <tr>
                  <th>Nome</th>
                  <th>Telefone</th>
                  <th>Opt-in</th>
                  <th>Entrada</th>
                  <th>Saída</th>
                </tr>
              </thead>
              <tbody>
                {aluno.responsaveis.map((r, i) => (
                  <tr key={r.id}>
                    <td>
                      <div className="who">
                        <AvIniciais nome={r.name} indice={i + 2} />
                        <div>
                          <b>{r.name}</b>
                          <small>
                            {r.relation ?? 'Responsável'}
                            {r.is_primary ? ' · principal' : ''}
                          </small>
                        </div>
                      </div>
                    </td>
                    <td>
                      <b style={{ fontSize: 13 }}>{telefoneBonito(r.phone)}</b>{' '}
                      <Ic nome="brand-whatsapp" className="wa" style={{ color: '#22A65B' }} />
                    </td>
                    <td>
                      {r.opt_in ? (
                        <span
                          className="pill p-mint"
                          style={{ cursor: 'pointer' }}
                          title="Clique para registrar opt-out"
                          onClick={() => mudarOptIn(r.id, false)}
                        >
                          <Ic nome="check" />
                          Aceito
                        </span>
                      ) : (
                        <span
                          className="pill p-sun"
                          style={{ cursor: 'pointer' }}
                          title="Clique para registrar opt-in"
                          onClick={() => mudarOptIn(r.id, true)}
                        >
                          <Ic nome="clock" />
                          Pendente
                        </span>
                      )}
                    </td>
                    <td>
                      <button
                        className={`toggle${r.notify_entry ? ' on' : ''}`}
                        aria-label="Avisar na entrada"
                        onClick={() => mudarVinculo(r.id, 'notify_entry', !r.notify_entry)}
                      />
                    </td>
                    <td>
                      <button
                        className={`toggle${r.notify_exit ? ' on' : ''}`}
                        aria-label="Avisar na saída"
                        onClick={() => mudarVinculo(r.id, 'notify_exit', !r.notify_exit)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="section">
        <h2>Histórico de acessos</h2>
      </div>
      <div className="card">
        {aluno.acessos.length === 0 ? (
          <div className="empty">
            <Ic nome="door-enter" />
            Nenhum acesso registrado ainda.
          </div>
        ) : (
          <div className="hist">
            {aluno.acessos.map((a) => (
              <div className="row" key={a.id}>
                <span className="t">{quandoCurto(a.occurred_at)}</span>
                <PillEvento direction={a.direction} />
                <span className="n">
                  {a.avisos === 0
                    ? 'nenhum aviso'
                    : `${a.avisos} ${a.avisos === 1 ? 'aviso' : 'avisos'}`}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
      {toastEl}
    </section>
  );
}

const RELACOES = ['Mãe', 'Pai', 'Avó', 'Avô', 'Tia', 'Tio', 'Responsável legal', 'Outro'];

function FormResponsavel({ alunoId, aoSalvar }: { alunoId: string; aoSalvar: () => void }) {
  const [nome, setNome] = useState('');
  const [telefone, setTelefone] = useState('');
  const [relacao, setRelacao] = useState('Mãe');
  const [optIn, setOptIn] = useState(false);
  const [entrada, setEntrada] = useState(true);
  const [saida, setSaida] = useState(true);
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);

  async function salvar(e: FormEvent) {
    e.preventDefault();
    const fone = paraE164(telefone);
    if (!fone) {
      setErro('Telefone inválido — use DDD + número, ex.: (81) 99999-0000');
      return;
    }
    setErro('');
    setSalvando(true);
    try {
      await api('/v1/painel/responsaveis', {
        method: 'POST',
        body: JSON.stringify({
          name: nome.trim(),
          phone: fone,
          relation: relacao,
          opt_in: optIn,
          student_ids: [alunoId],
          notify_entry: entrada,
          notify_exit: saida,
        }),
      });
      aoSalvar();
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'não foi possível salvar');
      setSalvando(false);
    }
  }

  return (
    <form className="card" style={{ marginBottom: 16 }} onSubmit={salvar}>
      <div className="cfg-head">
        <span className="ic" style={{ background: 'var(--mint-soft)', color: '#106B48' }}>
          <Ic nome="user-plus" />
        </span>
        <div>
          <h3>Novo responsável</h3>
          <small>Recebe os avisos deste aluno pelo WhatsApp</small>
        </div>
      </div>
      {erro && <div className="erro-inline">{erro}</div>}
      <div className="g2">
        <div className="field">
          <label>Nome completo</label>
          <input
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            required
            minLength={2}
            placeholder="Maria da Silva"
          />
        </div>
        <div className="field">
          <label>WhatsApp</label>
          <input
            value={telefone}
            onChange={(e) => setTelefone(e.target.value)}
            required
            placeholder="(81) 99999-0000"
          />
        </div>
        <div className="field">
          <label>Relação com o aluno</label>
          <select value={relacao} onChange={(e) => setRelacao(e.target.value)}>
            {RELACOES.map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Avisar em</label>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <label className="switch">
              <button
                type="button"
                className={`toggle${entrada ? ' on' : ''}`}
                onClick={() => setEntrada((v) => !v)}
              />
              Entrada
            </label>
            <label className="switch">
              <button
                type="button"
                className={`toggle${saida ? ' on' : ''}`}
                onClick={() => setSaida((v) => !v)}
              />
              Saída
            </label>
          </div>
        </div>
      </div>
      <label className="switch" style={{ marginBottom: 14 }}>
        <button
          type="button"
          className={`toggle${optIn ? ' on' : ''}`}
          onClick={() => setOptIn((v) => !v)}
        />
        O responsável autorizou receber avisos por WhatsApp (consentimento LGPD)
      </label>
      <button className="btn" disabled={salvando}>
        <Ic nome="device-floppy" />
        {salvando ? 'Salvando…' : 'Salvar responsável'}
      </button>
    </form>
  );
}
