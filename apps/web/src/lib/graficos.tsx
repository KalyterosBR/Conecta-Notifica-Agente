'use client';
/**
 * Peças de gráfico do painel. SVG na mão, sem biblioteca: são três formas,
 * e o viewBox escalando em 100% da largura resolve responsividade sem medir
 * o contêiner.
 *
 * Paleta validada para daltonismo (ΔE 17.8 entre as duas séries categóricas):
 *   entrada #3F8CFF (--sky) · saída #5546C9 (violeta do tema)
 * Status de mensagem usa a paleta de estado — mint/coral — sempre com rótulo
 * e ícone junto, nunca só a cor.
 */
import { ReactNode, useState } from 'react';

export const COR = {
  entrada: '#3F8CFF',
  saida: '#5546C9',
  entregue: '#2FC28B',
  falha: '#FF6B4A',
  enviada: '#9094AB',
} as const;

const EIXO = '#9094AB';
const GRADE = '#E9E6DF';

interface Dica {
  x: number;
  y: number;
  conteudo: ReactNode;
}

/** Tooltip em HTML sobre o SVG — posição em % do viewBox, escala junto. */
function Balao({ dica, largura, altura }: { dica: Dica | null; largura: number; altura: number }) {
  if (!dica) return null;
  const esquerda = (dica.x / largura) * 100;
  return (
    <div
      className="gdica"
      style={{
        left: `${esquerda}%`,
        top: `${(dica.y / altura) * 100}%`,
        transform: `translate(${esquerda > 65 ? '-100%' : esquerda < 12 ? '0' : '-50%'}, -115%)`,
      }}
    >
      {dica.conteudo}
    </div>
  );
}

export function Legenda({ itens }: { itens: { cor: string; rotulo: string; icone?: string }[] }) {
  return (
    <div className="glegenda">
      {itens.map((i) => (
        <span key={i.rotulo}>
          <i style={{ background: i.cor }} />
          {i.rotulo}
        </span>
      ))}
    </div>
  );
}

/**
 * Barras empilhadas por dia. Dia sem movimento aparece como espaço vazio, não
 * some do eixo — sumir sugeriria um volume que não existiu.
 */
export function BarrasDia({
  dados,
  series,
  formatoDia,
}: {
  dados: { dia: string; [k: string]: string | number }[];
  series: { chave: string; cor: string; rotulo: string }[];
  formatoDia?: (dia: string) => string;
}) {
  const [dica, setDica] = useState<Dica | null>(null);
  const L = 720;
  const A = 200;
  const base = A - 26;
  const topo = 12;
  const maximo = Math.max(
    1,
    ...dados.map((d) => series.reduce((s, x) => s + Number(d[x.chave] ?? 0), 0)),
  );
  const passo = L / Math.max(dados.length, 1);
  const largura = Math.min(18, Math.max(3, passo * 0.62));

  return (
    <div className="gwrap">
      <svg viewBox={`0 0 ${L} ${A}`} className="gsvg" role="img">
        {[0, 0.5, 1].map((f) => (
          <line
            key={f}
            x1={0}
            x2={L}
            y1={base - f * (base - topo)}
            y2={base - f * (base - topo)}
            stroke={GRADE}
            strokeWidth={1}
          />
        ))}
        {dados.map((d, i) => {
          const cx = i * passo + passo / 2;
          let y = base;
          const total = series.reduce((s, x) => s + Number(d[x.chave] ?? 0), 0);
          return (
            <g
              key={d.dia}
              onMouseEnter={() =>
                setDica({
                  x: cx,
                  y: base - ((total / maximo) * (base - topo)),
                  conteudo: (
                    <>
                      <b>{formatoDia ? formatoDia(d.dia) : d.dia}</b>
                      {series.map((s) => (
                        <span key={s.chave}>
                          <i style={{ background: s.cor }} />
                          {s.rotulo}: <b>{Number(d[s.chave] ?? 0)}</b>
                        </span>
                      ))}
                    </>
                  ),
                })
              }
              onMouseLeave={() => setDica(null)}
            >
              {/* alvo de hover maior que a barra */}
              <rect x={i * passo} y={topo} width={passo} height={base - topo} fill="transparent" />
              {series.map((s) => {
                const v = Number(d[s.chave] ?? 0);
                if (v <= 0) return null;
                const h = (v / maximo) * (base - topo);
                y -= h;
                return (
                  <rect
                    key={s.chave}
                    x={cx - largura / 2}
                    y={y}
                    width={largura}
                    // 2px de folga entre segmentos empilhados
                    height={Math.max(1, h - 2)}
                    rx={3}
                    fill={s.cor}
                  />
                );
              })}
            </g>
          );
        })}
        <line x1={0} x2={L} y1={base} y2={base} stroke={EIXO} strokeWidth={1} />
        {dados.map((d, i) =>
          // Um rótulo a cada ~6 dias: número em todo ponto vira ruído.
          i % Math.ceil(dados.length / 6) === 0 ? (
            <text key={d.dia} x={i * passo + passo / 2} y={A - 8} className="grot" textAnchor="middle">
              {formatoDia ? formatoDia(d.dia) : d.dia}
            </text>
          ) : null,
        )}
        <text x={2} y={topo + 4} className="grot">
          {maximo}
        </text>
      </svg>
      <Balao dica={dica} largura={L} altura={A} />
    </div>
  );
}

/** Distribuição por hora: duas séries lado a lado, 24 posições fixas. */
export function BarrasHora({
  dados,
}: {
  dados: { hora: number; entradas: number; saidas: number }[];
}) {
  const [dica, setDica] = useState<Dica | null>(null);
  const L = 720;
  const A = 190;
  const base = A - 26;
  const topo = 12;
  const maximo = Math.max(1, ...dados.map((d) => Math.max(d.entradas, d.saidas)));
  const passo = L / 24;
  const larg = passo * 0.34;

  return (
    <div className="gwrap">
      <svg viewBox={`0 0 ${L} ${A}`} className="gsvg" role="img">
        <line x1={0} x2={L} y1={topo} y2={topo} stroke={GRADE} strokeWidth={1} />
        <line x1={0} x2={L} y1={(base + topo) / 2} y2={(base + topo) / 2} stroke={GRADE} strokeWidth={1} />
        {dados.map((d) => {
          const cx = d.hora * passo + passo / 2;
          return (
            <g
              key={d.hora}
              onMouseEnter={() =>
                setDica({
                  x: cx,
                  y: base - (Math.max(d.entradas, d.saidas) / maximo) * (base - topo),
                  conteudo: (
                    <>
                      <b>{String(d.hora).padStart(2, '0')}h</b>
                      <span>
                        <i style={{ background: COR.entrada }} />
                        entradas: <b>{d.entradas}</b>
                      </span>
                      <span>
                        <i style={{ background: COR.saida }} />
                        saídas: <b>{d.saidas}</b>
                      </span>
                    </>
                  ),
                })
              }
              onMouseLeave={() => setDica(null)}
            >
              <rect x={d.hora * passo} y={topo} width={passo} height={base - topo} fill="transparent" />
              {(
                [
                  { v: d.entradas, cor: COR.entrada, dx: -larg - 1 },
                  { v: d.saidas, cor: COR.saida, dx: 1 },
                ] as const
              ).map(({ v, cor, dx }, k) => {
                if (v <= 0) return null;
                const h = (v / maximo) * (base - topo);
                return (
                  <rect
                    key={k}
                    x={cx + dx}
                    y={base - h}
                    width={larg}
                    height={h}
                    rx={3}
                    fill={cor}
                  />
                );
              })}
            </g>
          );
        })}
        <line x1={0} x2={L} y1={base} y2={base} stroke={EIXO} strokeWidth={1} />
        {dados.map((d) =>
          d.hora % 3 === 0 ? (
            <text
              key={d.hora}
              x={d.hora * passo + passo / 2}
              y={A - 8}
              className="grot"
              textAnchor="middle"
            >
              {String(d.hora).padStart(2, '0')}h
            </text>
          ) : null,
        )}
      </svg>
      <Balao dica={dica} largura={L} altura={A} />
    </div>
  );
}

/**
 * Ranking de turmas: barra horizontal, série única. Uma série não precisa de
 * legenda — o título já diz o que é —, então vai com rótulo direto no valor.
 */
export function BarrasTurma({ dados }: { dados: { turma: string; alunos: number; acessos: number }[] }) {
  const maximo = Math.max(1, ...dados.map((d) => d.acessos));
  return (
    <div className="gturmas">
      {dados.map((d) => (
        <div className="gturma" key={d.turma}>
          <span className="nome" title={d.turma}>
            {d.turma}
          </span>
          <span className="trilho">
            <span
              className="preenche"
              style={{ width: `${Math.max(2, (d.acessos / maximo) * 100)}%` }}
            />
          </span>
          <span className="valor">
            {d.acessos}
            <small>{d.alunos} aluno{d.alunos === 1 ? '' : 's'}</small>
          </span>
        </div>
      ))}
    </div>
  );
}
