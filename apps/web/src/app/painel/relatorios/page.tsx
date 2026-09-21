'use client';
// Relatórios — o consolidado que a direção olha uma vez por semana: quanto
// passou pela catraca, quanto virou aviso e quanto chegou.
import { useCallback, useEffect, useState } from 'react';
import { Relatorio, api } from '@/lib/api';
import { BarrasDia, BarrasHora, BarrasTurma, COR, Legenda } from '@/lib/graficos';
import { Ic } from '@/lib/ui';

const JANELAS = [
  { dias: 7, rotulo: '7 dias' },
  { dias: 30, rotulo: '30 dias' },
  { dias: 90, rotulo: '90 dias' },
];

export default function PaginaRelatorios() {
  const [dias, setDias] = useState(30);
  const [r, setR] = useState<Relatorio | null>(null);
  const [erro, setErro] = useState('');
  const [tabela, setTabela] = useState(false);

  const carregar = useCallback(() => {
    api<Relatorio>(`/v1/painel/relatorios?dias=${dias}`)
      .then((d) => {
        setR(d);
        setErro('');
      })
      .catch((e) => setErro(e instanceof Error ? e.message : 'falha ao carregar'));
  }, [dias]);

  useEffect(carregar, [carregar]);

  if (erro) return <div className="carregando">{erro}</div>;
  if (!r) return <div className="carregando">Carregando relatórios…</div>;

  const t = r.totais;
  const semMovimento = t.eventos === 0;

  return (
    <section>
      <div className="phead">
        <div>
          <h1>Relatórios</h1>
          <p className="sub">Acessos, avisos e entrega no período</p>
        </div>
        <div className="chips">
          {JANELAS.map((j) => (
            <button
              key={j.dias}
              className={`chip ${dias === j.dias ? 'ativo' : ''}`}
              onClick={() => setDias(j.dias)}
            >
              {j.rotulo}
            </button>
          ))}
        </div>
      </div>

      <div className="adm-cards">
        <Tile tom="s-sky" icone="door-enter" valor={t.eventos} rotulo="Acessos registrados" />
        <Tile tom="s-violet" icone="send" valor={t.mensagens} rotulo="Avisos disparados" />
        <Tile
          tom="s-mint"
          icone="circle-check"
          valor={t.taxa_entrega === null ? '—' : `${t.taxa_entrega}%`}
          rotulo={t.taxa_entrega === null ? 'Nada enviado ainda' : `${t.entregues} entregues`}
        />
        <Tile
          tom={t.falhas > 0 ? 's-coral' : 's-mint'}
          icone="alert-triangle"
          valor={t.falhas}
          rotulo="Falhas de envio"
        />
        <Tile
          tom={t.alunos_sem_responsavel > 0 ? 's-sun' : 's-mint'}
          icone="user-question"
          valor={t.alunos_sem_responsavel}
          rotulo="Alunos sem responsável"
        />
      </div>

      {semMovimento ? (
        <div className="tcard">
          <div className="empty">
            <Ic nome="chart-bar" />
            Nenhum acesso registrado nos últimos {dias} dias.
            <br />
            Assim que o agente enviar os giros da catraca, os gráficos aparecem aqui.
          </div>
        </div>
      ) : (
        <>
          <div className="card gcard">
            <div className="gtopo">
              <div>
                <h3>Acessos por dia</h3>
                <small>Entradas e saídas registradas pela catraca</small>
              </div>
              <div className="gacoes">
                <Legenda
                  itens={[
                    { cor: COR.entrada, rotulo: 'entradas' },
                    { cor: COR.saida, rotulo: 'saídas' },
                  ]}
                />
                <button className="chip" onClick={() => setTabela((v) => !v)}>
                  <Ic nome={tabela ? 'chart-bar' : 'table'} />
                  {tabela ? 'Ver gráfico' : 'Ver tabela'}
                </button>
              </div>
            </div>
            {tabela ? (
              <div className="gtabela">
                <table className="adm-tabela">
                  <thead>
                    <tr>
                      <th>Dia</th>
                      <th>Entradas</th>
                      <th>Saídas</th>
                      <th>Avisos</th>
                      <th>Entregues</th>
                      <th>Falhas</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...r.serie].reverse().map((d) => (
                      <tr key={d.dia}>
                        <td>{diaCurto(d.dia)}</td>
                        <td>{d.entradas}</td>
                        <td>{d.saidas}</td>
                        <td>{d.enviadas}</td>
                        <td>{d.entregues}</td>
                        <td className={d.falhas ? 'falhas' : ''}>{d.falhas}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <BarrasDia
                dados={r.serie}
                formatoDia={diaCurto}
                series={[
                  { chave: 'entradas', cor: COR.entrada, rotulo: 'entradas' },
                  { chave: 'saidas', cor: COR.saida, rotulo: 'saídas' },
                ]}
              />
            )}
          </div>

          <div className="g2col">
            <div className="card gcard">
              <div className="gtopo">
                <div>
                  <h3>Horário do movimento</h3>
                  <small>Onde estão os picos — ajuda a ajustar a janela de envio</small>
                </div>
                <Legenda
                  itens={[
                    { cor: COR.entrada, rotulo: 'entradas' },
                    { cor: COR.saida, rotulo: 'saídas' },
                  ]}
                />
              </div>
              <BarrasHora dados={r.horas} />
            </div>

            <div className="card gcard">
              <div className="gtopo">
                <div>
                  <h3>Avisos por dia</h3>
                  <small>Quanto saiu e quanto chegou</small>
                </div>
                <div className="glegenda">
                  <span>
                    <Ic nome="circle-check" />
                    entregues
                  </span>
                  <span>
                    <Ic nome="alert-triangle" />
                    falhas
                  </span>
                </div>
              </div>
              <BarrasDia
                dados={r.serie}
                formatoDia={diaCurto}
                series={[
                  { chave: 'entregues', cor: COR.entregue, rotulo: 'entregues' },
                  { chave: 'falhas', cor: COR.falha, rotulo: 'falhas' },
                ]}
              />
            </div>
          </div>

          <div className="card gcard">
            <div className="gtopo">
              <div>
                <h3>Turmas que mais passam</h3>
                <small>Acessos no período, por turma</small>
              </div>
            </div>
            {r.turmas.length === 0 ? (
              <div className="empty">
                <Ic nome="school" />
                As turmas aparecem aqui quando o agente sincroniza o cadastro.
              </div>
            ) : (
              <BarrasTurma dados={r.turmas} />
            )}
          </div>
        </>
      )}
    </section>
  );
}

function Tile({
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

/** 2026-08-30 -> 30/08 */
function diaCurto(dia: string): string {
  const [, m, d] = dia.split('-');
  return `${d}/${m}`;
}
