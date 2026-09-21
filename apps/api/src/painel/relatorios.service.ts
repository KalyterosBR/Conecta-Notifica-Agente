import { Injectable } from '@nestjs/common';
import { ContextoUsuario } from '../auth/painel.guard';
import { PrismaService } from '../prisma/prisma.service';
import { FiltroRelatorioDto } from './dto';

/** Um dia da série, sempre no fuso da escola. */
interface DiaSerie {
  dia: string; // YYYY-MM-DD
  entradas: number;
  saidas: number;
  enviadas: number;
  entregues: number;
  falhas: number;
}

@Injectable()
export class RelatoriosService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Consolidado do período. Tudo agrupado no fuso da escola — agrupar em UTC
   * jogaria os giros do fim da tarde para o dia seguinte.
   *
   * As colunas são `timestamp without time zone` guardando UTC (é o mapa
   * padrão do Prisma), então a conversão precisa dos dois passos:
   * `AT TIME ZONE 'UTC'` diz o que o valor é, e o segundo leva para o fuso da
   * escola. Só o segundo interpretaria o UTC como hora local e erraria o dia.
   */
  async consolidado(u: ContextoUsuario, f: FiltroRelatorioDto) {
    const dias = f.dias ?? 30;
    const escola = await this.prisma.school.findUnique({
      where: { id: u.schoolId },
      select: { timezone: true },
    });
    const tz = escola?.timezone ?? 'America/Sao_Paulo';
    const desde = new Date(Date.now() - dias * 86_400_000);

    const [acessos, mensagens, turmas, horas, totais] = await Promise.all([
      this.acessosPorDia(u.schoolId, tz, desde),
      this.mensagensPorDia(u.schoolId, tz, desde),
      this.rankingTurmas(u.schoolId, desde),
      this.picoPorHora(u.schoolId, tz, desde),
      this.totais(u.schoolId, desde),
    ]);

    return {
      periodo: { dias, desde, timezone: tz },
      serie: montarSerie(dias, tz, acessos, mensagens),
      turmas,
      horas,
      totais,
    };
  }

  private acessosPorDia(schoolId: string, tz: string, desde: Date) {
    return this.prisma.$queryRaw<{ dia: string; direction: string; total: bigint }[]>`
      SELECT to_char((occurred_at AT TIME ZONE 'UTC') AT TIME ZONE ${tz}, 'YYYY-MM-DD') AS dia,
             direction::text AS direction,
             count(*) AS total
        FROM access_events
       WHERE school_id = ${schoolId} AND occurred_at >= ${desde}
       GROUP BY 1, 2`;
  }

  private mensagensPorDia(schoolId: string, tz: string, desde: Date) {
    return this.prisma.$queryRaw<{ dia: string; status: string; total: bigint }[]>`
      SELECT to_char((m.created_at AT TIME ZONE 'UTC') AT TIME ZONE ${tz}, 'YYYY-MM-DD') AS dia,
             m.status::text AS status,
             count(*) AS total
        FROM messages m
        JOIN access_events e ON e.id = m.access_event_id
       WHERE e.school_id = ${schoolId} AND m.created_at >= ${desde}
       GROUP BY 1, 2`;
  }

  /** Turmas que mais passam pela catraca — ajuda a explicar picos. */
  private async rankingTurmas(schoolId: string, desde: Date) {
    const linhas = await this.prisma.$queryRaw<
      { turma: string | null; alunos: bigint; acessos: bigint }[]
    >`
      SELECT s.class_name AS turma,
             count(DISTINCT s.id) AS alunos,
             count(e.id) AS acessos
        FROM students s
        LEFT JOIN access_events e ON e.student_id = s.id AND e.occurred_at >= ${desde}
       WHERE s.school_id = ${schoolId} AND s.active
       GROUP BY 1
       ORDER BY 3 DESC, 1 ASC
       LIMIT 12`;
    return linhas.map((l) => ({
      turma: l.turma ?? 'sem turma',
      alunos: Number(l.alunos),
      acessos: Number(l.acessos),
    }));
  }

  /** Distribuição por hora: mostra a janela real de entrada e saída. */
  private async picoPorHora(schoolId: string, tz: string, desde: Date) {
    const linhas = await this.prisma.$queryRaw<
      { hora: number; direction: string; total: bigint }[]
    >`
      SELECT extract(hour FROM (occurred_at AT TIME ZONE 'UTC') AT TIME ZONE ${tz})::int AS hora,
             direction::text AS direction,
             count(*) AS total
        FROM access_events
       WHERE school_id = ${schoolId} AND occurred_at >= ${desde}
       GROUP BY 1, 2`;
    const horas = Array.from({ length: 24 }, (_, h) => ({ hora: h, entradas: 0, saidas: 0 }));
    for (const l of linhas) {
      const alvo = horas[l.hora];
      if (!alvo) continue;
      if (l.direction === 'in') alvo.entradas = Number(l.total);
      else alvo.saidas = Number(l.total);
    }
    return horas;
  }

  private async totais(schoolId: string, desde: Date) {
    const [eventos, mensagens, entregues, lidas, falhas, semResponsavel] = await Promise.all([
      this.prisma.accessEvent.count({ where: { schoolId, occurredAt: { gte: desde } } }),
      this.prisma.message.count({
        where: { accessEvent: { schoolId }, createdAt: { gte: desde } },
      }),
      this.prisma.message.count({
        where: { accessEvent: { schoolId }, createdAt: { gte: desde }, status: 'DELIVERED' },
      }),
      this.prisma.message.count({
        where: { accessEvent: { schoolId }, createdAt: { gte: desde }, status: 'READ' },
      }),
      this.prisma.message.count({
        where: { accessEvent: { schoolId }, createdAt: { gte: desde }, status: 'FAILED' },
      }),
      this.prisma.student.count({
        where: { schoolId, active: true, guardians: { none: {} } },
      }),
    ]);
    // Entregue inclui lida: quem leu, recebeu.
    const chegaram = entregues + lidas;
    return {
      eventos,
      mensagens,
      entregues: chegaram,
      falhas,
      alunos_sem_responsavel: semResponsavel,
      // null quando nada foi enviado — 0% mentiria sobre um período vazio.
      taxa_entrega: mensagens > 0 ? Math.round((chegaram / mensagens) * 100) : null,
    };
  }
}

/**
 * Preenche os dias sem movimento com zero. Sem isso o gráfico "pula" o fim de
 * semana e sugere um volume que não existiu.
 */
export function montarSerie(
  dias: number,
  tz: string,
  acessos: { dia: string; direction: string; total: bigint }[],
  mensagens: { dia: string; status: string; total: bigint }[],
): DiaSerie[] {
  const serie = new Map<string, DiaSerie>();
  const hoje = new Date();
  for (let i = dias - 1; i >= 0; i--) {
    const d = new Date(hoje.getTime() - i * 86_400_000);
    const dia = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(d);
    serie.set(dia, { dia, entradas: 0, saidas: 0, enviadas: 0, entregues: 0, falhas: 0 });
  }
  for (const a of acessos) {
    const alvo = serie.get(a.dia);
    if (!alvo) continue;
    if (a.direction === 'in') alvo.entradas = Number(a.total);
    else alvo.saidas = Number(a.total);
  }
  for (const m of mensagens) {
    const alvo = serie.get(m.dia);
    if (!alvo) continue;
    const n = Number(m.total);
    if (m.status === 'failed') alvo.falhas += n;
    else if (m.status === 'delivered' || m.status === 'read') {
      alvo.entregues += n;
      alvo.enviadas += n;
    } else if (m.status === 'sent') alvo.enviadas += n;
  }
  return [...serie.values()];
}
