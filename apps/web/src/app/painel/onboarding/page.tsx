'use client';
// Primeiros passos — o wizard do doc §4. Três etapas na ordem em que
// dependem uma da outra, e nenhuma "concluída por clique": o estado vem do
// sistema, então recarregar a página nunca mente sobre o que falta.
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { ConexaoWhatsapp, Onboarding, api } from '@/lib/api';
import { Ic, quandoCurto, useToast } from '@/lib/ui';

const URL_API_AGENTE = 'https://painel.conectapontoeacesso.com.br/api';

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
                <small>
                  {p.detalhe}
                  {p.id === 'agente' && o.agente.last_seen_at
                    ? ` · Último sinal ${quandoCurto(o.agente.last_seen_at)}`
                    : ''}
                </small>
                {p.id === 'agente' && o.agente.last_seen_at && (
                  <span className={`pill ${o.agente.online ? 'p-mint' : 'p-coral'}`}>
                    {o.agente.online ? 'Online agora' : 'Offline agora'}
                  </span>
                )}
              </span>
              <Ic nome={expandido ? 'chevron-up' : 'chevron-down'} />
            </button>

            {expandido && (
              <div className="onb-corpo">
                {p.id === 'agente' && (
                  <>
                    <p>
                      O agente é um programa que roda no computador da escola, lê os eventos da
                      catraca no SQL Server e envia para cá. Para instalar, use a Central do Agente
                      no computador da escola e informe os dados da catraca, o endereço da API e a
                      chave da escola:
                    </p>
                    <div className="onb-download">
                      <div>
                        <b>Agente Conecta Notifica para Windows</b>
                        <small>Baixe o instalador oficial mais recente para o computador da escola.</small>
                      </div>
                      <a
                        className="btn"
                        href="https://github.com/KalyterosBR/Conecta-Notifica-Agente/releases/latest"
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <Ic nome="download" />
                        Baixar agente
                      </a>
                    </div>
                    <div className="field">
                      <label>Endereço da API Conecta Notifica</label>
                      <div className="keybox">
                        <span>{URL_API_AGENTE}</span>
                        <Ic nome="copy" title="Copiar" onClick={() => copiar(URL_API_AGENTE, toast)} />
                      </div>
                      <small className="hint">
                        API oficial do Conecta Notifica. O agente enviará os dados para o painel publicado.
                      </small>
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
                    <aside className="onb-dica onb-dica-agente">
                      <span className="onb-dica-icone"><Ic nome="info-circle" /></span>
                      <div className="onb-dica-conteudo">
                        <b>Como concluir a instalação</b>
                        <p>
                          No computador da escola, execute o instalador e abra a Central do Agente
                          como administrador. Informe os dados SQL, o endereço da API e a chave da
                          escola; depois clique em <b>Testar conexões</b> e instale o serviço.
                        </p>
                        <p className="onb-dica-secundaria">
                          Se o agente já estiver instalado, mas offline, confira o serviço e o teste
                          de conexões na Central. Os novos acessos só chegam ao painel enquanto ele
                          estiver conectado.
                        </p>
                      </div>
                    </aside>
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
                        : `${o.alunos.sincronizados} ${o.alunos.sincronizados === 1 ? 'aluno sincronizado' : 'alunos sincronizados'} da catraca; ${o.alunos.aguardando_sincronizacao} ${o.alunos.aguardando_sincronizacao === 1 ? 'aluno aguarda' : 'alunos aguardam'} cadastro completo. Há ${o.alunos.sem_responsavel} ${o.alunos.sem_responsavel === 1 ? 'aluno' : 'alunos'} sem responsável e ${o.alunos.responsaveis} ${o.alunos.responsaveis === 1 ? 'responsável cadastrado' : 'responsáveis cadastrados'}.`}
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
                      Um responsável só recebe avisos depois de autorizar o recebimento — exigência
                      da LGPD. O sistema não envia antes de essa autorização ser registrada.
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
