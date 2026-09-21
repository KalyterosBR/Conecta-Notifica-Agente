'use client';
// Modelos de mensagem — editor com preview de WhatsApp (entrou-mockup.html).
// Entrada e saída ficam em message_templates pela API (o worker lê essa tabela
// no envio). O convite de opt-in ainda não é disparado pelo sistema, então
// continua um rascunho salvo neste navegador para a escola copiar.
import { useEffect, useRef, useState } from 'react';
import { api, Configuracoes, Modelos } from '@/lib/api';
import { Ic, useToast } from '@/lib/ui';

type ChaveTpl = 'in' | 'out' | 'optin';

const OPTIN_PADRAO =
  'Olá {responsavel}! Aqui é a {escola}. Vamos te avisar por aqui sempre que {aluno} entrar ou sair da escola. Responda SIM para confirmar. Para parar de receber, responda PARAR a qualquer momento.';

const ABAS: { chave: ChaveTpl; icone: string; nome: string }[] = [
  { chave: 'in', icone: 'login', nome: 'Entrada' },
  { chave: 'out', icone: 'logout', nome: 'Saída' },
  { chave: 'optin', icone: 'shield-check', nome: 'Confirmação de opt-in' },
];

const CHAVE_LOCAL = 'cn_modelo_optin';

export default function PaginaModelos() {
  const [dados, setDados] = useState<Modelos | null>(null);
  const [textos, setTextos] = useState<Record<ChaveTpl, string>>({
    in: '',
    out: '',
    optin: OPTIN_PADRAO,
  });
  const [aba, setAba] = useState<ChaveTpl>('in');
  const [escola, setEscola] = useState('sua escola');
  const [salvando, setSalvando] = useState(false);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const { toast, toastEl } = useToast();

  useEffect(() => {
    try {
      const local = localStorage.getItem(CHAVE_LOCAL);
      if (local) setTextos((t) => ({ ...t, optin: local }));
    } catch {}
    api<Modelos>('/v1/painel/modelos')
      .then((m) => {
        setDados(m);
        setTextos((t) => ({ ...t, in: m.modelos.in.body, out: m.modelos.out.body }));
      })
      .catch((e) => toast(e.message));
    api<Configuracoes>('/v1/painel/configuracoes')
      .then((c) => setEscola(c.escola.name))
      .catch(() => {});
  }, []);

  function mudar(texto: string) {
    setTextos((t) => ({ ...t, [aba]: texto }));
  }

  function inserirVar(v: string) {
    const ta = areaRef.current;
    if (!ta) return;
    const pos = ta.selectionStart;
    const novo = ta.value.slice(0, pos) + v + ta.value.slice(ta.selectionEnd);
    mudar(novo);
    requestAnimationFrame(() => {
      ta.focus();
      ta.selectionStart = ta.selectionEnd = pos + v.length;
    });
  }

  async function salvar() {
    if (aba === 'optin') {
      try {
        localStorage.setItem(CHAVE_LOCAL, textos.optin);
        toast('Rascunho salvo neste navegador');
      } catch {
        toast('Não foi possível salvar');
      }
      return;
    }
    setSalvando(true);
    try {
      const r = await api<{ body: string; personalizado: boolean }>(`/v1/painel/modelos/${aba}`, {
        method: 'PUT',
        body: JSON.stringify({ body: textos[aba] }),
      });
      aplicar(aba, r);
      toast('Modelo salvo — vale para os próximos avisos');
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setSalvando(false);
    }
  }

  async function restaurar() {
    if (aba === 'optin') {
      try {
        localStorage.removeItem(CHAVE_LOCAL);
      } catch {}
      setTextos((t) => ({ ...t, optin: OPTIN_PADRAO }));
      toast('Texto padrão restaurado');
      return;
    }
    setSalvando(true);
    try {
      const r = await api<{ body: string; personalizado: boolean }>(`/v1/painel/modelos/${aba}`, {
        method: 'DELETE',
      });
      aplicar(aba, r);
      toast('Voltou ao texto padrão do sistema');
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setSalvando(false);
    }
  }

  function aplicar(chave: 'in' | 'out', r: { body: string; personalizado: boolean }) {
    setTextos((t) => ({ ...t, [chave]: r.body }));
    setDados((d) =>
      d ? { ...d, modelos: { ...d.modelos, [chave]: { body: r.body, personalizado: r.personalizado } } } : d,
    );
  }

  const variaveis = dados?.variaveis ?? ['{responsavel}', '{aluno}', '{hora}', '{escola}'];
  const salvo = aba === 'optin' ? null : dados?.modelos[aba];
  const alterado = aba === 'optin' ? false : !!salvo && salvo.body !== textos[aba];
  const podeRestaurar = aba === 'optin' ? textos.optin !== OPTIN_PADRAO : !!salvo?.personalizado;

  const hora = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const preview = textos[aba]
    .replaceAll('{responsavel}', 'Mariana')
    .replaceAll('{aluno}', 'Ana Beatriz')
    .replaceAll('{hora}', hora)
    .replaceAll('{escola}', escola);

  return (
    <section>
      <div className="phead">
        <div>
          <h1>Modelos de mensagem</h1>
          <p className="sub">O aviso que o responsável recebe em cada tipo de evento</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {podeRestaurar && (
            <button className="btn white" onClick={restaurar} disabled={salvando}>
              <Ic nome="rotate" />
              Restaurar padrão
            </button>
          )}
          <button className="btn" onClick={salvar} disabled={salvando || !textos[aba].trim()}>
            <Ic nome="device-floppy" />
            {salvando ? 'Salvando…' : 'Salvar modelo'}
          </button>
        </div>
      </div>

      <div className="tpl-grid">
        <div className="card">
          <div className="chips" style={{ marginBottom: 16 }}>
            {ABAS.map((a) => (
              <span
                key={a.chave}
                className={`chip${aba === a.chave ? ' on' : ''}`}
                onClick={() => setAba(a.chave)}
              >
                <Ic nome={a.icone} /> {a.nome}
              </span>
            ))}
          </div>
          <div className="field">
            <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              Texto da mensagem
              {aba === 'optin' ? (
                <span className="pill p-sun">
                  <Ic nome="pencil" /> Rascunho
                </span>
              ) : alterado ? (
                <span className="pill p-sun">
                  <Ic nome="alert-circle" /> Não salvo
                </span>
              ) : salvo?.personalizado ? (
                <span className="pill p-mint">
                  <Ic nome="check" /> Personalizado
                </span>
              ) : (
                <span className="pill p-grey">Padrão do sistema</span>
              )}
            </label>
            <textarea
              ref={areaRef}
              rows={6}
              value={textos[aba]}
              onChange={(e) => mudar(e.target.value)}
              disabled={aba !== 'optin' && !dados}
            />
            <div className="hint">
              {aba === 'optin'
                ? 'O convite de opt-in ainda não é disparado pelo sistema: copie este texto para enviar aos responsáveis. Fica salvo neste navegador.'
                : 'Toque em uma variável para inserir no texto. O que você salvar aqui vale para os próximos avisos; o que já foi enviado não muda.'}
            </div>
          </div>
          <div className="vars">
            {variaveis.map((v) => (
              <button key={v} type="button" className="var" onClick={() => inserirVar(v)}>
                {v}
              </button>
            ))}
          </div>
        </div>
        <div className="phone">
          <div className="screen">
            <div className="wa-head">
              <span className="av">
                <Ic nome="message-circle-check" />
              </span>
              <div>
                {escola}
                <small>via Conecta Notifica</small>
              </div>
            </div>
            <div className="bubble">
              {preview}
              <div className="meta">
                {hora} <Ic nome="checks" />
              </div>
            </div>
          </div>
        </div>
      </div>
      {toastEl}
    </section>
  );
}
