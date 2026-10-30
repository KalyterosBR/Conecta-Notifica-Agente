'use client';
// Envios — avisos disparados pelo WhatsApp, layout do entrou-mockup.html.
import { useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useState } from 'react';
import { api, RespostaEnvios } from '@/lib/api';
import {
  AvatarAluno,
  Ic,
  PillEvento,
  PillStatusEnvio,
  quandoCurto,
  telefoneBonito,
  useToast,
} from '@/lib/ui';

const POR_PAGINA = 50; // mesmo recorte da API
const STATUS_VALIDOS = ['queued', 'sent', 'delivered', 'read', 'failed'];

interface Contagens {
  todos: number;
  delivered: number;
  read: number;
  failed: number;
  queued: number;
}

function Conteudo() {
  const params = useSearchParams();
  const statusUrl = params.get('status');
  const [status, setStatus] = useState(
    statusUrl && STATUS_VALIDOS.includes(statusUrl) ? statusUrl : 'todos',
  );
  const [busca, setBusca] = useState('');
  const [pagina, setPagina] = useState(1);
  const [dados, setDados] = useState<RespostaEnvios | null>(null);
  const [contagens, setContagens] = useState<Contagens | null>(null);
  const [erro, setErro] = useState('');
  const { toast, toastEl } = useToast();

  useEffect(() => {
    if (statusUrl && STATUS_VALIDOS.includes(statusUrl)) {
      setStatus(statusUrl);
      setPagina(1);
    }
  }, [statusUrl]);

  const carregar = useCallback(() => {
    const q = new URLSearchParams();
    if (status !== 'todos') q.set('status', status);
    q.set('pagina', String(pagina));
    api<RespostaEnvios>(`/v1/painel/envios?${q}`)
      .then((r) => {
        setDados(r);
        setErro('');
      })
      .catch((e) => setErro(e instanceof Error ? e.message : 'falha ao carregar'));
  }, [status, pagina]);

  useEffect(carregar, [carregar]);

  const contar = useCallback(() => {
    Promise.all(
      ['', 'delivered', 'read', 'failed', 'queued'].map((s) =>
        api<RespostaEnvios>(`/v1/painel/envios?pagina=1${s ? `&status=${s}` : ''}`)
          .then((r) => r.total)
          .catch(() => 0),
      ),
    ).then(([todos, delivered, read, failed, queued]) =>
      setContagens({ todos, delivered, read, failed, queued }),
    );
  }, []);

  useEffect(contar, [contar]);

  async function reenviar(id: string) {
    try {
      await api(`/v1/painel/envios/${id}/reenviar`, { method: 'POST' });
      toast('Aviso reenfileirado para envio');
      carregar();
      contar();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'não foi possível reenviar');
    }
  }

  function filtrar(s: string) {
    setStatus(s);
    setPagina(1);
  }

  const lista = (dados?.envios ?? []).filter(
    (e) =>
      !busca.trim() ||
      `${e.aluno} ${e.responsavel}`.toLowerCase().includes(busca.trim().toLowerCase()),
  );
  const total = dados?.total ?? 0;
  const totalPaginas = Math.max(1, Math.ceil(total / POR_PAGINA));

  const tiles = [
    { f: 'todos', classe: 's-violet', icone: 'send', valor: contagens?.todos, rotulo: 'Enviados', mut: 'no total' },
    { f: 'delivered', classe: 's-mint', icone: 'checks', valor: contagens?.delivered, rotulo: 'Entregues', mut: 'confirmados' },
    { f: 'read', classe: 's-sky', icone: 'eye-check', valor: contagens?.read, rotulo: 'Lidos', mut: 'pelo responsável' },
    { f: 'failed', classe: 's-coral', icone: 'alert-circle', valor: contagens?.failed, rotulo: 'Falhas', mut: 'para reenviar' },
    { f: 'queued', classe: 's-sun', icone: 'hourglass', valor: contagens?.queued, rotulo: 'Na fila', mut: 'aguardando envio' },
  ];

  return (
    <section>
      <div className="phead">
        <div>
          <h1>Envios</h1>
          <p className="sub">Todos os avisos disparados pelo WhatsApp</p>
        </div>
      </div>

      <div className="resp-orientacao" style={{ marginBottom: 16 }}>
        <span className="resp-orientacao-icone">
          <Ic nome="info-circle" />
        </span>
        <div className="resp-orientacao-texto">
          <b>Como ler os status</b>
          <p>
            “Enviado” significa que o provedor aceitou o aviso. “Entregue” e “Lido” dependem de
            confirmação do WhatsApp — um aviso enviado pode ficar sem confirmação. “Falha” indica
            que o envio não foi concluído.
          </p>
        </div>
      </div>

      {erro && <div className="erro-inline">{erro}</div>}

      <div className="stats">
        {tiles.map((t) => (
          <div key={t.f} className={`stat ${t.classe}`} onClick={() => filtrar(t.f)}>
            <span className="ic"><Ic nome={t.icone} /></span>
            <div>
              <b>{t.valor ?? '—'}</b>
              <small>{t.rotulo}</small>
              <span className="mut">{t.mut}</span>
            </div>
          </div>
        ))}
      </div>

      <div className="fbar">
        <div className="fsearch">
          <Ic nome="search" />
          <input
            placeholder="Filtrar por aluno ou responsável…"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />
        </div>
        <select className="sel" value={status} onChange={(e) => filtrar(e.target.value)}>
          <option value="todos">Todos os status</option>
          <option value="read">Lidos</option>
          <option value="delivered">Entregues</option>
          <option value="sent">Enviados</option>
          <option value="failed">Falhas</option>
          <option value="queued">Na fila</option>
        </select>
      </div>

      <div className="tcard">
        {!dados ? (
          <div className="carregando">Carregando envios…</div>
        ) : lista.length === 0 ? (
          <div className="empty">
            <Ic nome="send" />
            {total === 0 && status === 'todos' && !busca.trim()
              ? 'Ainda não há avisos enviados. Confira o agente, o WhatsApp e os responsáveis para preparar o primeiro envio.'
              : 'Nenhum envio corresponde à busca e ao status selecionados.'}
          </div>
        ) : (
          <div className="tw">
            <table>
              <thead>
                <tr>
                  <th>Quando</th>
                  <th>Aluno</th>
                  <th>Evento</th>
                  <th>Responsável</th>
                  <th>Status</th>
                  <th style={{ textAlign: 'right' }}>Ações</th>
                </tr>
              </thead>
              <tbody>
                {lista.map((e) => (
                  <tr key={e.id} className={e.status === 'failed' ? 'fail' : undefined}>
                    <td>
                      <b>{quandoCurto(e.occurred_at)}</b>
                    </td>
                    <td>
                      <div className="who">
                        <AvatarAluno nome={e.aluno} />
                        <div>
                          <b>{e.aluno}</b>
                        </div>
                      </div>
                    </td>
                    <td>
                      <PillEvento direction={e.direction} />
                    </td>
                    <td>
                      <b style={{ fontSize: 13.5 }}>{e.responsavel}</b>
                      <span className="tel">
                        {telefoneBonito(e.phone)}{' '}
                        <Ic nome="brand-whatsapp" className="wa" />
                      </span>
                    </td>
                    <td>
                      <PillStatusEnvio status={e.status} erro={e.error} />
                    </td>
                    <td className="acts">
                      {e.status === 'failed' && (
                        <Ic nome="refresh" title="Reenviar" onClick={() => reenviar(e.id)} />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {dados && total > POR_PAGINA && (
          <div className="tfoot">
            <span className="info">
              Página {pagina} de {totalPaginas} · {total} envios
            </span>
            <div className="pages">
              <span className="pg" onClick={() => setPagina((p) => Math.max(1, p - 1))}>
                <Ic nome="chevron-left" />
              </span>
              <span className="pg on">{pagina}</span>
              <span className="pg" onClick={() => setPagina((p) => Math.min(totalPaginas, p + 1))}>
                <Ic nome="chevron-right" />
              </span>
            </div>
          </div>
        )}
      </div>
      {toastEl}
    </section>
  );
}

export default function PaginaEnvios() {
  return (
    <Suspense fallback={<div className="carregando">Carregando envios…</div>}>
      <Conteudo />
    </Suspense>
  );
}
