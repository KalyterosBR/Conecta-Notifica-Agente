'use client';
// Ficha da escola: contrato, cobrança, saúde e o botão que liga/desliga o
// cliente. É aqui que o operador resolve tudo de um cliente só.
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { api, entrarComoEscola } from '@/lib/api';
import { EscolaDetalhe, PILL_COBRANCA, ROTULO_COBRANCA, formatarCnpj } from '@/lib/admin';
import { Ic, quandoCurto, useToast } from '@/lib/ui';

export default function FichaEscola() {
  const { id } = useParams<{ id: string }>();
  const [e, setE] = useState<EscolaDetalhe | null>(null);
  const [erro, setErro] = useState('');
  const { toast, toastEl } = useToast();

  const carregar = useCallback(() => {
    api<EscolaDetalhe>(`/v1/admin/escolas/${id}`)
      .then((r) => {
        setE(r);
        setErro('');
      })
      .catch((err) => setErro(err instanceof Error ? err.message : 'falha ao carregar'));
  }, [id]);

  useEffect(carregar, [carregar]);

  async function salvarContrato(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const f = new FormData(ev.currentTarget);
    try {
      await api(`/v1/admin/escolas/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          nome: String(f.get('nome')),
          cnpj: String(f.get('cnpj') || '') || undefined,
          plano: String(f.get('plano') || '') || undefined,
          // 0 é o jeito de dizer "sem teto" para a API.
          max_alunos: Number(f.get('max_alunos')) || 0,
          max_chips: Number(f.get('max_chips')) || 1,
          observacoes: String(f.get('observacoes') || ''),
          conta_azul_id: String(f.get('conta_azul_id') || '') || undefined,
        }),
      });
      toast('Contrato salvo');
      carregar();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'não foi possível salvar');
    }
  }

  async function salvarCobranca(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const f = new FormData(ev.currentTarget);
    try {
      await api(`/v1/admin/escolas/${id}/cobranca`, {
        method: 'PATCH',
        body: JSON.stringify({
          status: String(f.get('status')),
          nota_emitida: f.get('nota_emitida') === 'on',
          data_nota: String(f.get('data_nota') || '') || undefined,
        }),
      });
      toast('Cobrança atualizada');
      carregar();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'não foi possível salvar');
    }
  }

  /** Abre o painel da escola com um token curto, marcado como impersonação. */
  async function entrarComo() {
    try {
      const r = await api<{ token: string; escola: string; expira_em_minutos: number }>(
        `/v1/admin/escolas/${id}/impersonar`,
        { method: 'POST' },
      );
      entrarComoEscola(r.token, r.escola);
      window.location.href = '/painel';
    } catch (err) {
      toast(err instanceof Error ? err.message : 'não foi possível entrar');
    }
  }

  async function alternarBloqueio() {
    if (!e) return;
    const motivo = e.bloqueado
      ? undefined
      : window.prompt('Motivo do bloqueio (a escola não vê este texto):', 'mensalidade em atraso');
    if (!e.bloqueado && motivo === null) return;
    try {
      await api(`/v1/admin/escolas/${id}/bloqueio`, {
        method: 'POST',
        body: JSON.stringify({ bloqueado: !e.bloqueado, motivo: motivo || undefined }),
      });
      toast(e.bloqueado ? 'Escola liberada' : 'Escola bloqueada');
      carregar();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'não foi possível alterar');
    }
  }

  if (erro) return <div className="carregando">{erro}</div>;
  if (!e) return <div className="carregando">Carregando escola…</div>;

  return (
    <section>
      <div className="phead">
        <div>
          <Link href="/admin" className="crumb">
            <Ic nome="arrow-left" />
            Escolas
          </Link>
          <h1>{e.nome}</h1>
          <p className="sub">
            {formatarCnpj(e.cnpj)} · plano {e.plano} · cliente desde{' '}
            {new Date(e.criada_em).toLocaleDateString('pt-BR')}
          </p>
        </div>
        <div className="adm-acoes">
          <button className="btn ghost" onClick={entrarComo}>
            <Ic nome="eye" />
            Entrar como esta escola
          </button>
          <button className={`btn ${e.bloqueado ? '' : 'perigo'}`} onClick={alternarBloqueio}>
            <Ic nome={e.bloqueado ? 'lock-open' : 'lock'} />
            {e.bloqueado ? 'Liberar escola' : 'Bloquear escola'}
          </button>
        </div>
      </div>

      {e.bloqueado && (
        <div className="adm-alerta">
          <Ic nome="lock" />
          <div>
            <b>Escola bloqueada</b>
            <small>
              {e.motivo_bloqueio}
              {e.bloqueado_em && ` · desde ${new Date(e.bloqueado_em).toLocaleDateString('pt-BR')}`}
              . Os giros continuam sendo gravados; os avisos no WhatsApp não saem.
            </small>
          </div>
        </div>
      )}

      <div className="adm-cards">
        <Indicador
          tom={e.uso.alunos_acima_do_teto ? 's-coral' : 's-violet'}
          icone="users"
          valor={`${e.uso.alunos}${e.contrato.max_alunos ? ` / ${e.contrato.max_alunos}` : ''}`}
          rotulo={e.uso.alunos_acima_do_teto ? 'Alunos — acima do teto' : 'Alunos'}
        />
        <Indicador
          tom="s-mint"
          icone="device-mobile"
          valor={`${e.uso.chips_conectados} / ${e.contrato.max_chips}`}
          rotulo="Chips conectados"
        />
        <Indicador
          tom={e.agente.online ? 's-sky' : 's-coral'}
          icone="server-2"
          valor={e.agente.online ? 'online' : 'offline'}
          rotulo={
            e.agente.last_seen_at ? `Agente · ${quandoCurto(e.agente.last_seen_at)}` : 'Agente · nunca'
          }
        />
        <Indicador tom="s-sun" icone="send" valor={e.uso.mensagens_mes} rotulo="Mensagens no mês" />
        <Indicador
          tom={e.uso.falhas_mes > 0 ? 's-coral' : 's-mint'}
          icone="alert-triangle"
          valor={e.uso.falhas_mes}
          rotulo="Falhas no mês"
        />
      </div>

      <div className="cfg-grid">
        <form className="card" onSubmit={salvarContrato}>
          <div className="cfg-head">
            <span className="ic s-violet">
              <Ic nome="file-text" />
            </span>
            <div>
              <h3>Contrato</h3>
              <small>O que o plano libera</small>
            </div>
          </div>
          <div className="adm-grid">
            <label className="field">
              <span>Nome</span>
              <input name="nome" defaultValue={e.nome} required />
            </label>
            <label className="field">
              <span>CNPJ</span>
              <input name="cnpj" defaultValue={e.cnpj ?? ''} placeholder="00.000.000/0001-00" />
            </label>
            <label className="field">
              <span>Plano</span>
              <input name="plano" defaultValue={e.plano} />
            </label>
            <label className="field">
              <span>Conta Azul (ID do cliente)</span>
              <input name="conta_azul_id" defaultValue={e.conta_azul_id ?? ''} placeholder="ainda não integrado" />
            </label>
            <label className="field">
              <span>Alunos liberados</span>
              <input
                name="max_alunos"
                type="number"
                min={0}
                defaultValue={e.contrato.max_alunos ?? 0}
                placeholder="0 = sem teto"
              />
            </label>
            <label className="field">
              <span>Chips (números)</span>
              <input name="max_chips" type="number" min={1} defaultValue={e.contrato.max_chips} />
            </label>
          </div>
          <label className="field">
            <span>Observações internas</span>
            <textarea name="observacoes" rows={3} defaultValue={e.observacoes ?? ''} />
          </label>
          <button className="btn">
            <Ic nome="check" />
            Salvar contrato
          </button>
        </form>

        <form className="card" onSubmit={salvarCobranca}>
          <div className="cfg-head">
            <span className="ic s-sun">
              <Ic nome="cash" />
            </span>
            <div>
              <h3>Cobrança</h3>
              <small>
                {e.cobranca.atualizado_em
                  ? `Atualizado ${quandoCurto(e.cobranca.atualizado_em)}`
                  : 'Nunca atualizado'}
              </small>
            </div>
          </div>
          <div className="setrow">
            <div>
              <b>Situação atual</b>
              <small>
                {e.cobranca.nota_emitida
                  ? `NF emitida${e.cobranca.data_nota ? ` em ${new Date(e.cobranca.data_nota).toLocaleDateString('pt-BR')}` : ''}`
                  : 'Nota fiscal não emitida'}
              </small>
            </div>
            <span className={`pill ${PILL_COBRANCA[e.cobranca.status]}`}>
              {ROTULO_COBRANCA[e.cobranca.status]}
            </span>
          </div>
          <label className="field">
            <span>Status do pagamento</span>
            <select name="status" defaultValue={e.cobranca.status}>
              <option value="em_dia">Em dia</option>
              <option value="pendente">Pendente</option>
              <option value="atrasado">Atrasado</option>
              <option value="isento">Isento</option>
            </select>
          </label>
          <label className="field">
            <span>Data da nota fiscal</span>
            <input
              name="data_nota"
              type="date"
              defaultValue={e.cobranca.data_nota ? e.cobranca.data_nota.slice(0, 10) : ''}
            />
          </label>
          <label className="adm-check">
            <input type="checkbox" name="nota_emitida" defaultChecked={e.cobranca.nota_emitida} />
            <span>Nota fiscal emitida</span>
          </label>
          <button className="btn">
            <Ic nome="check" />
            Salvar cobrança
          </button>
          <p className="adm-nota">
            <Ic nome="info-circle" />
            Preenchido à mão por enquanto. Quando a integração com o Conta Azul entrar, estes
            campos passam a ser atualizados por ela.
          </p>
        </form>

        <div className="card">
          <div className="cfg-head">
            <span className="ic s-mint">
              <Ic nome="brand-whatsapp" />
            </span>
            <div>
              <h3>Chips</h3>
              <small>
                {e.chips.length} de {e.contrato.max_chips} usados
              </small>
            </div>
          </div>
          {e.chips.length === 0 ? (
            <div className="empty">
              <Ic nome="device-mobile-off" />
              Nenhum número conectado ainda.
            </div>
          ) : (
            e.chips.map((c) => (
              <div className="setrow" key={c.id}>
                <div>
                  <b>{c.numero ?? c.nome}</b>
                  <small>
                    {c.perfil ?? c.label ?? c.nome}
                    {c.ultimo_envio && ` · último envio ${quandoCurto(c.ultimo_envio)}`}
                  </small>
                </div>
                <span className={`pill ${c.status === 'connected' ? 'p-mint' : 'p-grey'}`}>
                  {c.status === 'connected' ? 'conectado' : c.status}
                </span>
              </div>
            ))
          )}
        </div>

        <div className="card">
          <div className="cfg-head">
            <span className="ic s-sky">
              <Ic nome="users" />
            </span>
            <div>
              <h3>Acesso ao painel</h3>
              <small>Quem entra pela escola</small>
            </div>
          </div>
          {e.usuarios.map((u) => (
            <div className="setrow" key={u.id}>
              <div>
                <b>{u.name}</b>
                <small>{u.email}</small>
              </div>
              <span className="pill p-grey">{u.role}</span>
            </div>
          ))}
        </div>
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
  valor: string | number;
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
