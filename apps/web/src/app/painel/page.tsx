'use client';
// Visão geral — dashboard ao vivo, layout do entrou-mockup.html.
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { api, nomeAtual, VisaoGeral } from '@/lib/api';
import { AvatarAluno, fotoAluno, horaCurta, Ic, PillEvento } from '@/lib/ui';

const ATUALIZA_MS = 5_000;

type Acesso = VisaoGeral['ultimos_acessos'][number];

function saudacao(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Bom dia';
  if (h < 18) return 'Boa tarde';
  return 'Boa noite';
}

function hojePorExtenso(): string {
  const s = new Date().toLocaleDateString('pt-BR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export default function PaginaVisaoGeral() {
  const [dados, setDados] = useState<VisaoGeral | null>(null);
  const [erro, setErro] = useState('');
  const [novoId, setNovoId] = useState('');
  const [pop, setPop] = useState<Acesso | null>(null);
  const [popVisivel, setPopVisivel] = useState(false);
  const primeiroId = useRef<string | null>(null);
  const popTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let ativo = true;
    async function carregar() {
      try {
        const r = await api<VisaoGeral>('/v1/painel/visao-geral');
        if (!ativo) return;
        setDados(r);
        setErro('');
        const topo = r.ultimos_acessos[0];
        if (topo && primeiroId.current && topo.id !== primeiroId.current) {
          // chegou giro novo: anima a linha e mostra o cartão ao vivo
          setNovoId(topo.id);
          setPop(topo);
          setPopVisivel(true);
          if (popTimer.current) clearTimeout(popTimer.current);
          popTimer.current = setTimeout(() => setPopVisivel(false), 5000);
        }
        if (topo) primeiroId.current = topo.id;
      } catch (e) {
        if (ativo) setErro(e instanceof Error ? e.message : 'falha ao carregar');
      }
    }
    carregar();
    const timer = setInterval(carregar, ATUALIZA_MS);
    return () => {
      ativo = false;
      clearInterval(timer);
      if (popTimer.current) clearTimeout(popTimer.current);
    };
  }, []);

  if (!dados) {
    return <div className="carregando">{erro || 'Carregando visão geral…'}</div>;
  }

  const nome = nomeAtual().split(' ')[0];
  const { hoje } = dados;
  const taxa = hoje.enviadas > 0 ? (hoje.entregues / hoje.enviadas) * 100 : null;
  const agenteTexto = dados.agente.online
    ? `Online · ${dados.agente.status?.pending ?? 0} na fila`
    : dados.agente.last_seen_at
      ? `Offline · último sinal ${horaCurta(dados.agente.last_seen_at)}`
      : 'Aguardando primeira conexão';

  return (
    <section>
      <div className="phead">
        <div>
          <h1>
            {saudacao()}
            {nome ? `, ${nome}` : ''} 👋
          </h1>
          <p className="sub">
            {hojePorExtenso()} · <b>{hoje.eventos}</b> acessos até agora{' '}
            {erro ? <span className="pill p-coral">reconectando…</span> : <span className="live-dot" />}
          </p>
        </div>
      </div>

      <div className="withrail">
        <div className="colmain">
          <div className="stats">
            <div className="stat s-sky">
              <span className="ic"><Ic nome="door-enter" /></span>
              <div>
                <b>{hoje.eventos}</b>
                <small>Eventos hoje</small>
                <span className="mut">entradas e saídas</span>
              </div>
            </div>
            <div className="stat s-violet">
              <span className="ic"><Ic nome="send" /></span>
              <div>
                <b>{hoje.enviadas}</b>
                <small>Avisos enviados</small>
                <span className="mut">via WhatsApp</span>
              </div>
            </div>
            <div className="stat s-mint">
              <span className="ic"><Ic nome="checks" /></span>
              <div>
                <b>{hoje.entregues}</b>
                <small>Entregues</small>
                <span className="mut">{taxa !== null ? `${taxa.toFixed(0)}% do total` : '—'}</span>
              </div>
            </div>
            <div className="stat s-coral">
              <span className="ic"><Ic nome="alert-circle" /></span>
              <div>
                <b>{hoje.falhas}</b>
                <small>Falhas</small>
                <span className="mut">para reenviar</span>
              </div>
            </div>
          </div>

          <div className="conns">
            <Link href="/painel/configuracoes" className={`conn ${dados.agente.online ? 'c-sky' : 'c-coral'}`}>
              <Ic nome="server-2" className="big" />
              <span className="go"><Ic nome="chevron-right" /></span>
              <small>Agente local</small>
              <b>{agenteTexto}</b>
            </Link>
            <Link href="/painel/configuracoes" className={`conn ${dados.whatsapp.conectado ? 'c-mint' : 'c-coral'}`}>
              <Ic nome="brand-whatsapp" className="big" />
              <span className="go"><Ic nome="chevron-right" /></span>
              <small>WhatsApp</small>
              <b>{dados.whatsapp.conectado ? `Conectado · via ${dados.whatsapp.provider}` : 'Não conectado'}</b>
            </Link>
            {dados.alunos_sem_responsavel > 0 ? (
              <Link href="/painel/alunos?sem_responsavel=1" className="conn c-coral">
                <Ic nome="user-off" className="big" />
                <span className="go"><Ic nome="chevron-right" /></span>
                <small>Precisa de atenção</small>
                <b>
                  {dados.alunos_sem_responsavel}{' '}
                  {dados.alunos_sem_responsavel === 1 ? 'aluno sem responsável' : 'alunos sem responsável'}
                </b>
              </Link>
            ) : (
              <Link href="/painel/alunos" className="conn c-mint">
                <Ic nome="user-check" className="big" />
                <span className="go"><Ic nome="chevron-right" /></span>
                <small>Responsáveis</small>
                <b>Todos os alunos têm responsável</b>
              </Link>
            )}
          </div>

          <div className="section" style={{ marginTop: 20 }}>
            <h2>
              Últimos acessos{' '}
              <span className="pill p-mint" style={{ marginLeft: 6 }}>
                <span className="live-dot" />
                ao vivo
              </span>
            </h2>
            <Link href="/painel/envios" className="link">
              Ver todos
            </Link>
          </div>
          <div className="tcard">
            {dados.ultimos_acessos.length === 0 ? (
              <div className="empty">
                <Ic nome="door-enter" />
                Nenhum acesso registrado ainda.
                <br />
                Assim que o agente enviar o primeiro giro, ele aparece aqui.
              </div>
            ) : (
              <div className="tw">
                <table>
                  <thead>
                    <tr>
                      <th>Aluno</th>
                      <th>Evento</th>
                      <th>Hora</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dados.ultimos_acessos.map((a) => (
                      <tr key={a.id} className={a.id === novoId ? 'new-row' : undefined}>
                        <td>
                          <div className="who">
                            <AvatarAluno nome={a.aluno} />
                            <div>
                              <b>{a.aluno}</b>
                            </div>
                          </div>
                        </td>
                        <td>
                          <PillEvento direction={a.direction} />
                        </td>
                        <td>
                          <b>{horaCurta(a.occurred_at)}</b>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        <div className="rail">
          <div className="card">
            <h3>Resumo de hoje</h3>
            <div className="kv"><span>Eventos na catraca</span><b>{hoje.eventos}</b></div>
            <div className="kv"><span>Avisos enviados</span><b>{hoje.enviadas}</b></div>
            <div className="kv"><span>Entregues</span><b>{hoje.entregues}</b></div>
            <div className="kv">
              <span>Falhas</span>
              <b style={{ color: hoje.falhas > 0 ? '#B3391E' : undefined }}>{hoje.falhas}</b>
            </div>
            <div className="kv hl">
              <span>Taxa de sucesso</span>
              <b style={{ color: '#106B48' }}>
                {taxa !== null ? `${taxa.toFixed(1).replace('.', ',')}%` : '—'}{' '}
                <Ic nome="trending-up" />
              </b>
            </div>
          </div>
          <div className="card">
            <h3>Dicas rápidas</h3>
            <div className="tip">
              <span className="ic"><Ic nome="refresh" /></span>
              <div>
                <b>Sincronize os dados</b>
                <small>Mantenha os alunos atualizados da catraca</small>
              </div>
            </div>
            <div className="tip">
              <span className="ic" style={{ background: 'var(--mint-soft)', color: '#106B48' }}>
                <Ic nome="user-plus" />
              </span>
              <div>
                <b>Cadastre responsáveis</b>
                <small>Alunos sem responsável não recebem avisos</small>
              </div>
            </div>
            <div className="tip">
              <span className="ic" style={{ background: 'var(--sun-soft)', color: '#8A5A00' }}>
                <Ic nome="eye" />
              </span>
              <div>
                <b>Fique de olho nos avisos</b>
                <small>Acompanhe falhas e opt-ins pendentes</small>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className={`livepop${popVisivel ? ' show' : ''}`}>
        {pop && (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={fotoAluno(pop.aluno)} alt="" />
            <div>
              <div className="lbl2">
                <span className="live-dot" />
                Acesso agora
              </div>
              <b>{pop.aluno}</b>
              <small>{horaCurta(pop.occurred_at)}</small>
            </div>
            <span style={{ marginLeft: 'auto' }}>
              <PillEvento direction={pop.direction} />
            </span>
            <Ic nome="x" className="x" onClick={() => setPopVisivel(false)} />
          </>
        )}
      </div>
    </section>
  );
}
