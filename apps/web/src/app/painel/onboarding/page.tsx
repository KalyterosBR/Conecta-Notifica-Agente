'use client';
// Primeiros passos — o wizard do doc §4. Três etapas na ordem em que
// dependem uma da outra, e nenhuma "concluída por clique": o estado vem do
// sistema, então recarregar a página nunca mente sobre o que falta.
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { ConexaoWhatsapp, Onboarding, api } from '@/lib/api';
import { Ic, quandoCurto, useToast } from '@/lib/ui';

export default function PaginaOnboarding() {
  const [o, setO] = useState<Onboarding | null>(null);
  const [erro, setErro] = useState('');
  const [chave, setChave] = useState('');
  const [conexao, setConexao] = useState<ConexaoWhatsapp | null>(null);
  const [aguardando, setAguardando] = useState(false);
  const [aberto, setAberto] = useState<string | null>(null);
  const { toast, toastEl } = useToast();

  const carregar = useCallback(() => {
    api<Onboarding>('/v1/painel/onboarding')
      .then((r) => {
        setO(r);
        setErro('');
        // Abre sozinho o primeiro passo que falta — é o que a escola veio fazer.
        setAberto((atual) => atual ?? r.passos.find((p) => !p.concluido)?.id ?? null);
      })
      .catch((e) => setErro(e instanceof Error ? e.message : 'falha ao carregar'));
  }, []);

  useEffect(carregar, [carregar]);

  // Enquanto o QR está na tela, pergunta se já foi lido.
  useEffect(() => {
    if (!aguardando) return;
    const id = setInterval(async () => {
      try {
        const r = await api<ConexaoWhatsapp>('/v1/painel/configuracoes/whatsapp/status');
        if (r.conectado) {
          setAguardando(false);
          setConexao(null);
          toast('WhatsApp conectado');
          carregar();
        }
      } catch {
        /* um tick que falha não cancela a leitura */
      }
    }, 3000);
    const fim = setTimeout(() => setAguardando(false), 120_000);
    return () => {
      clearInterval(id);
      clearTimeout(fim);
    };
  }, [aguardando, carregar, toast]);

  async function gerarChave() {
    if (
      o?.agente.chave_criada_em &&
      !window.confirm(
        'Gerar uma chave nova? A atual para de funcionar na hora e o agente precisa ser reconfigurado.',
      )
    )
      return;
    try {
      const r = await api<{ api_key: string }>('/v1/painel/configuracoes/agente/regenerar-chave', {
        method: 'POST',
      });
      setChave(r.api_key);
      carregar();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'não foi possível gerar');
    }
  }

  async function conectarWhats() {
    try {
      const r = await api<ConexaoWhatsapp>('/v1/painel/configuracoes/whatsapp/conectar', {
        method: 'POST',
        body: JSON.stringify({}),
      });
      setConexao(r);
      setAguardando(!r.conectado);
      if (r.conectado) carregar();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'não foi possível gerar o QR');
    }
  }

  if (erro) return <div className="carregando">{erro}</div>;
  if (!o) return <div className="carregando">Carregando…</div>;

  const feitos = o.passos.filter((p) => p.concluido).length;

  return (
    <section className="onb">
      <div className="phead">
        <div>
          <h1>Primeiros passos</h1>
          <p className="sub">
            {o.concluido
              ? 'Tudo pronto — a escola já está avisando os responsáveis'
              : `${feitos} de ${o.passos.length} concluídos`}
          </p>
        </div>
        {o.concluido && (
          <Link href="/painel" className="btn">
            <Ic nome="layout-dashboard" />
            Ir para a visão geral
          </Link>
        )}
      </div>

      <div className="onb-prog">
        <span style={{ width: `${(feitos / o.passos.length) * 100}%` }} />
      </div>

      {o.passos.map((p, i) => {
        const expandido = aberto === p.id;
        return (
          <div className={`card onb-passo ${p.concluido ? 'feito' : ''}`} key={p.id}>
            <button className="onb-cab" onClick={() => setAberto(expandido ? null : p.id)}>
              <span className="onb-num">
                {p.concluido ? <Ic nome="check" /> : i + 1}
              </span>
              <span className="onb-txt">
                <b>{p.titulo}</b>
                <small>{p.detalhe}</small>
              </span>
              <Ic nome={expandido ? 'chevron-up' : 'chevron-down'} />
            </button>

            {expandido && (
              <div className="onb-corpo">
                {p.id === 'agente' && (
                  <>
                    <p>
                      O agente é um programa que roda no computador da escola, lê os giros da
                      catraca no SQL Server e envia para cá. Ele precisa de duas informações:
                    </p>
                    <div className="field">
                      <label>Endereço do servidor (vai no <code>config.yaml</code>)</label>
                      <div className="keybox">
                        <span>{o.url_agente ?? 'defina PUBLIC_API_URL na API'}</span>
                        {o.url_agente && (
                          <Ic nome="copy" title="Copiar" onClick={() => copiar(o.url_agente!, toast)} />
                        )}
                      </div>
                    </div>
                    {chave ? (
                      <div className="field">
                        <label>
                          Chave da escola — <b>copie agora, ela não aparece de novo</b>
                        </label>
                        <div className="keybox">
                          <span>{chave}</span>
                          <Ic nome="copy" title="Copiar" onClick={() => copiar(chave, toast)} />
                        </div>
                      </div>
                    ) : (
                      <button className="btn" onClick={gerarChave}>
                        <Ic nome="key" />
                        {o.agente.chave_criada_em ? 'Gerar chave nova' : 'Gerar a chave do agente'}
                      </button>
                    )}
                    <p className="onb-dica">
                      <Ic nome="info-circle" />
                      No computador da escola: descompacte o instalador em <code>C:\ConectaNotifica</code>,
                      preencha o <code>config.yaml</code> com o endereço e a chave acima, e rode{' '}
                      <code>INSTALAR.bat</code> como administrador. O passo fecha sozinho no primeiro
                      sinal que chegar.
                    </p>
                  </>
                )}

                {p.id === 'whatsapp' && (
                  <>
                    {o.whatsapp.chips.filter((c) => c.conectado).map((c) => (
                      <div className="setrow" key={c.id}>
                        <div>
                          <b>{c.numero ?? c.nome}</b>
                          <small>{c.perfil ?? 'número conectado'}</small>
                        </div>
                        <span className="pill p-mint">
                          <Ic nome="plug-connected" />
                          Ativo
                        </span>
                      </div>
                    ))}
                    {conexao?.qrcode && aguardando ? (
                      <div className="qrzona">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img className="qrimg" src={conexao.qrcode} alt="QR code do WhatsApp" />
                        <ol className="qrpassos">
                          <li>Abra o WhatsApp no celular da escola</li>
                          <li>Toque em <b>Aparelhos conectados</b></li>
                          <li>Toque em <b>Conectar aparelho</b> e aponte para o código</li>
                        </ol>
                        <p className="qrstatus">
                          <span className="ponto" />
                          Esperando a leitura…
                        </p>
                      </div>
                    ) : (
                      o.whatsapp.pode_adicionar && (
                        <>
                          <p>
                            É o número de onde os avisos vão sair. Funciona como o WhatsApp Web:
                            um código na tela, lido pelo celular da escola.
                          </p>
                          <button className="btn" onClick={conectarWhats}>
                            <Ic nome="qrcode" />
                            Conectar por QR code
                          </button>
                        </>
                      )
                    )}
                  </>
                )}

                {p.id === 'responsaveis' && (
                  <>
                    <p>
                      {o.alunos.total === 0
                        ? 'Os alunos aparecem aqui automaticamente assim que o agente sincronizar o cadastro da catraca. Nada precisa ser digitado.'
                        : `${o.alunos.total} aluno(s) sincronizados da catraca e ${o.alunos.responsaveis} responsável(is) cadastrados. Falta vincular ${o.alunos.sem_responsavel}.`}
                    </p>
                    <div className="onb-acoes">
                      <Link href="/painel/responsaveis" className="btn">
                        <Ic nome="table-import" />
                        Importar planilha
                      </Link>
                      <Link href="/painel/alunos?sem_responsavel=1" className="btn ghost">
                        <Ic nome="users" />
                        Ver alunos sem responsável
                      </Link>
                    </div>
                    <p className="onb-dica">
                      <Ic nome="shield-check" />
                      Um responsável só recebe mensagem depois do opt-in — é a exigência da LGPD, e
                      o sistema não envia sem ele.
                    </p>
                  </>
                )}
              </div>
            )}
          </div>
        );
      })}
      {toastEl}
    </section>
  );
}

function copiar(texto: string, toast: (m: string) => void) {
  navigator.clipboard
    .writeText(texto)
    .then(() => toast('Copiado'))
    .catch(() => toast('Não foi possível copiar'));
}
