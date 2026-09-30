'use client';
// Configurações — conexões, regras de envio e dados da escola.
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { api, ConexaoWhatsapp, Configuracoes } from '@/lib/api';
import { Ic, quandoCurto, useToast } from '@/lib/ui';

// A UAZAPI expira o QR em 2 min e o código de pareamento em 5 (doc do
// /instance/connect). Passado o prazo, paramos de perguntar e oferecemos outro.
const QR_VALIDADE_MS = 120_000;
const CODIGO_VALIDADE_MS = 300_000;

export default function PaginaConfiguracoes() {
  const [cfg, setCfg] = useState<Configuracoes | null>(null);
  const [erro, setErro] = useState('');
  const [chaveNova, setChaveNova] = useState('');
  const [conexao, setConexao] = useState<ConexaoWhatsapp | null>(null);
  const [abrindoQr, setAbrindoQr] = useState(false);
  const [aguardandoLeitura, setAguardandoLeitura] = useState(false);
  const [expirado, setExpirado] = useState(false);
  const [modoCodigo, setModoCodigo] = useState(false);
  const [telefone, setTelefone] = useState('');
  const [chipAlvo, setChipAlvo] = useState<string | null>(null);
  const { toast, toastEl } = useToast();

  const carregar = useCallback(() => {
    api<Configuracoes>('/v1/painel/configuracoes')
      .then((r) => {
        setCfg(r);
        setErro('');
      })
      .catch((e) => setErro(e instanceof Error ? e.message : 'falha ao carregar'));
  }, []);

  useEffect(() => {
    carregar();
    const id = setInterval(carregar, 15_000);
    return () => clearInterval(id);
  }, [carregar]);

  async function salvarRegra(campo: string, valor: string | number | boolean) {
    if (!cfg) return;
    const anterior = cfg;
    setCfg({ ...cfg, regras: { ...cfg.regras, [campo]: valor } });
    try {
      await api('/v1/painel/configuracoes/regras', {
        method: 'PATCH',
        body: JSON.stringify({ [campo]: valor }),
      });
      toast('Preferência salva');
    } catch {
      setCfg(anterior);
      toast('Não foi possível salvar');
    }
  }

  async function regenerarChave() {
    if (
      !window.confirm(
        'Regenerar a chave do agente? A chave atual para de funcionar na hora e o agente precisa ser reconfigurado.',
      )
    )
      return;
    try {
      const r = await api<{ api_key: string }>('/v1/painel/configuracoes/agente/regenerar-chave', {
        method: 'POST',
      });
      setChaveNova(r.api_key);
      toast('Chave regenerada — copie agora');
      carregar();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'não foi possível regenerar');
    }
  }

  /**
   * Onboarding por QR: a API cria a instância da escola na primeira chamada e
   * devolve o código para escanear. Sem telefone vem QR; com telefone, o
   * código de 8 dígitos.
   */
  async function iniciarConexao(comTelefone?: string, instanciaId?: string) {
    setAbrindoQr(true);
    setExpirado(false);
    try {
      const r = await api<ConexaoWhatsapp>('/v1/painel/configuracoes/whatsapp/conectar', {
        method: 'POST',
        body: JSON.stringify({
          ...(comTelefone ? { telefone: comTelefone } : {}),
          ...(instanciaId ? { instancia_id: instanciaId } : {}),
        }),
      });
      setConexao(r);
      setChipAlvo(r.chip?.id ?? null);
      setAguardandoLeitura(!r.conectado);
      if (r.conectado) carregar();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'não foi possível gerar o código');
    } finally {
      setAbrindoQr(false);
    }
  }

  async function desconectarWhats(chipId: string) {
    if (!window.confirm('Desconectar este número? Os avisos param de sair por ele.')) return;
    try {
      await api('/v1/painel/configuracoes/whatsapp/desconectar', {
        method: 'POST',
        body: JSON.stringify({ instancia_id: chipId }),
      });
      setConexao(null);
      setAguardandoLeitura(false);
      toast('WhatsApp desconectado');
      carregar();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'não foi possível desconectar');
    }
  }

  // Enquanto o código está na tela, perguntamos à UAZAPI se já foi lido.
  useEffect(() => {
    if (!aguardandoLeitura) return;
    const inicio = Date.now();
    const limite = conexao?.paircode ? CODIGO_VALIDADE_MS : QR_VALIDADE_MS;
    const id = setInterval(async () => {
      if (Date.now() - inicio > limite) {
        setExpirado(true);
        setAguardandoLeitura(false);
        return;
      }
      try {
        const r = await api<ConexaoWhatsapp>(
          `/v1/painel/configuracoes/whatsapp/status${chipAlvo ? `?instancia_id=${chipAlvo}` : ''}`,
        );
        // Só troca o que está na tela quando há novidade: o status sozinho não
        // traz o QR, e sobrescrever apagaria a imagem no meio da leitura.
        setConexao((atual) => (r.conectado || r.qrcode ? r : atual));
        if (r.conectado) {
          setAguardandoLeitura(false);
          toast('WhatsApp conectado');
          carregar();
        }
      } catch {
        // Falha de rede num tick não cancela a leitura; o próximo tenta de novo.
      }
    }, 3000);
    return () => clearInterval(id);
  }, [aguardandoLeitura, conexao?.paircode, chipAlvo, carregar, toast]);

  function copiar(texto: string) {
    navigator.clipboard
      .writeText(texto)
      .then(() => toast('Copiado'))
      .catch(() => toast('Não foi possível copiar'));
  }

  if (erro && !cfg) return <div className="carregando">{erro}</div>;
  if (!cfg) return <div className="carregando">Carregando configurações…</div>;

  const agenteOnline = cfg.agente.online;
  const webhookUrl = cfg.whatsapp.webhook_url;

  return (
    <section>
      <div className="phead">
        <div>
          <h1>Configurações</h1>
          <p className="sub">Conexões, regras de envio e dados da escola</p>
        </div>
      </div>

      {cfg.contrato.bloqueado && (
        <div className="adm-alerta">
          <Ic nome="lock" />
          <div>
            <b>Conta bloqueada</b>
            <small>
              Os giros continuam sendo registrados, mas os avisos no WhatsApp não estão saindo.
              Fale com o suporte para liberar.
            </small>
          </div>
        </div>
      )}

      <div className="cfg-grid">
        <div className="card">
          <div className="cfg-head">
            <span className="ic" style={{ background: 'var(--mint-soft)', color: '#106B48' }}>
              <Ic nome="brand-whatsapp" />
            </span>
            <div>
              <h3>WhatsApp</h3>
              <small>
                {cfg.whatsapp.chips.length === 0
                  ? 'Nenhum número conectado'
                  : `${cfg.whatsapp.chips.filter((c) => c.conectado).length} de ${cfg.contrato.max_chips} ${cfg.contrato.max_chips === 1 ? 'número' : 'números'} conectado(s)`}
              </small>
            </div>
          </div>
          {cfg.whatsapp.chips.map((c) => (
            <div className="setrow" key={c.id}>
              <div>
                <b>{c.numero ? formatarNumero(c.numero) : (c.label ?? 'Número em conexão')}</b>
                <small>
                  {c.perfil ?? c.nome}
                  {c.ultimo_envio && ` · último envio ${quandoCurto(c.ultimo_envio)}`}
                </small>
              </div>
              {c.conectado ? (
                <button className="btn ghost" onClick={() => desconectarWhats(c.id)}>
                  <Ic nome="plug-off" />
                  Desconectar
                </button>
              ) : (
                <button
                  className="btn ghost"
                  onClick={() => iniciarConexao(undefined, c.id)}
                  disabled={abrindoQr}
                >
                  <Ic nome="qrcode" />
                  Reconectar
                </button>
              )}
            </div>
          ))}

          <div className="qrzona">
            {conexao?.qrcode && aguardandoLeitura ? (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img className="qrimg" src={conexao.qrcode} alt="QR code para conectar o WhatsApp" />
                <ol className="qrpassos">
                  <li>Abra o WhatsApp no celular da escola</li>
                  <li>Toque em <b>Aparelhos conectados</b></li>
                  <li>Toque em <b>Conectar aparelho</b> e aponte para o código</li>
                </ol>
                <p className="qrstatus">
                  <span className="ponto" />
                  Esperando a leitura…
                </p>
              </>
            ) : conexao?.paircode && aguardandoLeitura ? (
              <>
                <div className="paircode">{conexao.paircode}</div>
                <ol className="qrpassos">
                  <li>No WhatsApp do celular, vá em <b>Aparelhos conectados</b></li>
                  <li>Toque em <b>Conectar com número de telefone</b></li>
                  <li>Digite o código acima</li>
                </ol>
                <p className="qrstatus">
                  <span className="ponto" />
                  Esperando a confirmação…
                </p>
              </>
            ) : (
              <>
                {expirado && (
                  <p className="qraviso">
                    <Ic nome="clock-exclamation" />
                    O código expirou sem ser lido. Gere outro para tentar de novo.
                  </p>
                )}
                {!cfg.whatsapp.pode_adicionar ? (
                  cfg.whatsapp.chips.length > 0 && (
                    <p className="qrtexto">
                      {cfg.contrato.bloqueado
                        ? 'Escola bloqueada: fale com o suporte para liberar.'
                        : `Seu plano libera ${cfg.contrato.max_chips} ${cfg.contrato.max_chips === 1 ? 'número' : 'números'}. Fale com o suporte para ampliar.`}
                    </p>
                  )
                ) : modoCodigo ? (
                  <form
                    onSubmit={(e: FormEvent) => {
                      e.preventDefault();
                      iniciarConexao(telefone.trim());
                    }}
                  >
                    <div className="field">
                      <label>Número do WhatsApp da escola</label>
                      <input
                        value={telefone}
                        onChange={(e) => setTelefone(e.target.value)}
                        placeholder="+55 81 99999-0000"
                        required
                      />
                    </div>
                    <button className="btn" disabled={abrindoQr}>
                      <Ic nome="password" />
                      {abrindoQr ? 'Gerando…' : 'Gerar código de 8 dígitos'}
                    </button>
                    <button type="button" className="btn ghost" onClick={() => setModoCodigo(false)}>
                      Voltar ao QR code
                    </button>
                  </form>
                ) : (
                  <>
                    {cfg.whatsapp.chips.length === 0 && (
                      <p className="qrtexto">
                        Conecte o WhatsApp que vai avisar os responsáveis. É o mesmo passo a passo
                        do WhatsApp Web: um código na tela, lido pelo celular da escola.
                      </p>
                    )}
                    <button className="btn" onClick={() => iniciarConexao()} disabled={abrindoQr}>
                      <Ic nome="qrcode" />
                      {abrindoQr
                        ? 'Gerando código…'
                        : cfg.whatsapp.chips.length === 0
                          ? 'Conectar por QR code'
                          : 'Adicionar outro número'}
                    </button>
                    <button type="button" className="btn ghost" onClick={() => setModoCodigo(true)}>
                      <Ic nome="password" />
                      Não consigo escanear
                    </button>
                  </>
                )}
              </>
            )}
          </div>
          {webhookUrl && (
            <div className="field" style={{ margin: '10px 0 0' }}>
              <label>Webhook de status (cole na UAZAPI)</label>
              <div className="keybox">
                <span>{webhookUrl}</span>
                <Ic nome="copy" title="Copiar" onClick={() => copiar(webhookUrl)} />
              </div>
            </div>
          )}
          {!webhookUrl && (
            <p className="onb-dica" style={{ marginTop: 12 }}>
              <Ic nome="info-circle" />
              O endereço público da API não está configurado nesta instalação. As confirmações de entrega
              do WhatsApp podem não atualizar até o administrador configurar o webhook da plataforma.
            </p>
          )}
        </div>

        <div className="card">
          <div className="cfg-head">
            <span className="ic" style={{ background: 'var(--sky-soft)', color: '#1A4FA3' }}>
              <Ic nome="server-2" />
            </span>
            <div>
              <h3>Agente local</h3>
              <small>
                {agenteOnline
                  ? cfg.agente.status?.db_ok === false
                    ? 'Online · último reporte indicou falha no SQL'
                    : 'Online agora'
                  : cfg.agente.last_seen_at
                    ? `Último sinal ${quandoCurto(cfg.agente.last_seen_at)}`
                    : 'Aguardando primeira conexão'}
              </small>
            </div>
          </div>
          {cfg.agente.status && (
            <>
              <div className="setrow">
                <div>
                  <b>Último reporte do SQL Server</b>
                  <small>
                    {cfg.agente.status.db_ok === undefined
                      ? 'Sem informação'
                      : cfg.agente.status.db_ok
                        ? 'Conectado no último sinal'
                        : 'Sem conexão no último sinal'}
                  </small>
                </div>
                <span className={`pill ${cfg.agente.status.db_ok ? 'p-mint' : 'p-coral'}`}>
                  {cfg.agente.status.db_ok === undefined ? '—' : cfg.agente.status.db_ok ? 'OK' : 'Falha'}
                </span>
              </div>
              <div className="setrow">
                <div>
                  <b>Fila de eventos</b>
                  <small>
                    {cfg.agente.status.pending ?? 0} pendente(s)
                    {cfg.agente.status.sent_today !== undefined &&
                      ` · ${cfg.agente.status.sent_today} enviado(s) hoje`}
                  </small>
                </div>
                {cfg.agente.status.last_event_at && (
                  <span className="pill p-grey">
                    Último evento {quandoCurto(cfg.agente.status.last_event_at)}
                  </span>
                )}
              </div>
              {cfg.agente.status.version && (
                <div className="setrow">
                  <div><b>Versão do agente</b></div>
                  <span className="pill p-grey">{cfg.agente.status.version}</span>
                </div>
              )}
            </>
          )}
          <div className="field" style={{ marginBottom: 10 }}>
            <label>Chave de API do agente</label>
            {chaveNova ? (
              <>
                <div className="keybox">
                  <span>{chaveNova}</span>
                  <Ic nome="copy" title="Copiar" onClick={() => copiar(chaveNova)} />
                </div>
                <div className="hint" style={{ color: '#B3391E' }}>
                  Copie agora — a chave não aparece de novo.
                </div>
              </>
            ) : (
              <div className="keybox">
                <span>
                  cn_····························
                  {cfg.agente.chave_criada_em
                    ? `  (gerada em ${new Date(cfg.agente.chave_criada_em).toLocaleDateString('pt-BR')})`
                    : ''}
                </span>
                <Ic nome="lock" title="Só é exibida ao gerar" />
              </div>
            )}
          </div>
          <div className="setrow">
            <div>
              <b>Regenerar chave</b>
              <small>A chave atual para de funcionar na hora</small>
            </div>
            <button className="btn danger" onClick={regenerarChave}>
              <Ic nome="key" />
              Regenerar
            </button>
          </div>
        </div>

        <div className="card">
          <div className="cfg-head">
            <span className="ic" style={{ background: 'var(--sun-soft)', color: '#8A5A00' }}>
              <Ic nome="adjustments" />
            </span>
            <div>
              <h3>Regras de envio</h3>
              <small>Quando o aviso sai — e quando não sai</small>
            </div>
          </div>
          <div className="setrow">
            <div>
              <b>Janela de notificação</b>
              <small>Fora dela o evento não notifica</small>
            </div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input
                type="time"
                value={cfg.regras.window_start}
                onChange={(e) => salvarRegra('window_start', e.target.value)}
              />{' '}
              –{' '}
              <input
                type="time"
                value={cfg.regras.window_end}
                onChange={(e) => salvarRegra('window_end', e.target.value)}
              />
            </div>
          </div>
          <div className="setrow">
            <div>
              <b>Evitar avisos duplicados</b>
              <small>Não repete o aviso do mesmo aluno e tipo de acesso dentro do intervalo</small>
            </div>
            <select
              value={cfg.regras.dedupe_minutes}
              onChange={(e) => salvarRegra('dedupe_minutes', Number(e.target.value))}
            >
              {[0, 2, 3, 5, 10].map((m) => (
                <option key={m} value={m}>
                  {m === 0 ? 'Desligado' : `${m} minutos`}
                </option>
              ))}
            </select>
          </div>
          <div className="setrow">
            <div>
              <b>Notificar fins de semana</b>
              <small>Sábados e domingos</small>
            </div>
            <button
              className={`toggle${cfg.regras.notify_weekends ? ' on' : ''}`}
              aria-label="Notificar fins de semana"
              onClick={() => salvarRegra('notify_weekends', !cfg.regras.notify_weekends)}
            />
          </div>
        </div>

        <div className="card">
          <div className="cfg-head">
            <span className="ic" style={{ background: 'var(--brand-soft)', color: 'var(--brand-deep)' }}>
              <Ic nome="school" />
            </span>
            <div>
              <h3>Escola</h3>
              <small>Dados do contrato</small>
            </div>
          </div>
          <div className="setrow">
            <div>
              <b>{cfg.escola.name}</b>
              <small>Nome no painel e nas mensagens</small>
            </div>
          </div>
          <div className="setrow">
            <div>
              <b>Fuso horário</b>
              <small>Usado na janela de notificação</small>
            </div>
            <span className="pill p-grey">{cfg.escola.timezone}</span>
          </div>
          <div className="setrow">
            <div>
              <b>Plano</b>
              <small>Fale com o suporte para mudar</small>
            </div>
            <span className="pill p-violet">{cfg.escola.plan}</span>
          </div>
        </div>
      </div>
      {toastEl}
    </section>
  );
}

/** 5581999990000 -> +55 81 99999-0000, só para leitura no painel. */
function formatarNumero(bruto: string): string {
  const d = bruto.replace(/\D/g, '');
  const m = d.match(/^(\d{2})(\d{2})(\d{4,5})(\d{4})$/);
  return m ? `+${m[1]} ${m[2]} ${m[3]}-${m[4]}` : bruto;
}
