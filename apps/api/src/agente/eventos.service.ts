import { Injectable, Logger } from '@nestjs/common';
import { Direction, Prisma } from '@prisma/client';
import { NotificacoesQueue } from '../filas/notificacoes.queue';
import { PrismaService } from '../prisma/prisma.service';
import { ContextoAgente } from './chave-api.guard';
import { EventoDto, LoteEventosDto } from './dto';

export interface ResultadoLote {
  accepted: number;
  duplicates: number;
}

@Injectable()
export class EventosService {
  private readonly log = new Logger(EventosService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly fila: NotificacoesQueue,
  ) {}

  /**
   * Recebe um lote do agente. Idempotente: o unique
   * (school_id, external_event_id) faz reenvio virar "duplicates", nunca
   * evento repetido. Aluno desconhecido é criado na hora como pendente de
   * responsável — o evento nunca é descartado (doc §2.4).
   */
  async receberLote(ag: ContextoAgente, lote: LoteEventosDto): Promise<ResultadoLote> {
    if (lote.events.length === 0) return { accepted: 0, duplicates: 0 };

    const alunos = await this.garantirAlunos(ag.schoolId, lote.events);

    let accepted = 0;
    let duplicates = 0;
    const paraNotificar: { accessEventId: string; schoolId: string }[] = [];

    for (const ev of lote.events) {
      const studentId = alunos.get(ev.external_student_id)!;
      try {
        const criado = await this.prisma.accessEvent.create({
          data: {
            schoolId: ag.schoolId,
            studentId,
            externalEventId: ev.external_event_id,
            direction: ev.direction === 'in' ? Direction.IN : Direction.OUT,
            occurredAt: new Date(ev.occurred_at),
            card: ev.card,
            deviceId: ev.device_id,
            locationId: ev.location_id,
          },
          select: { id: true },
        });
        accepted++;
        paraNotificar.push({ accessEventId: criado.id, schoolId: ag.schoolId });
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
          duplicates++;
          continue;
        }
        throw e;
      }
    }

    await this.fila.enfileirar(paraNotificar);
    this.log.log(
      `lote da escola ${ag.schoolId}: ${accepted} aceitos, ${duplicates} duplicados`,
    );
    return { accepted, duplicates };
  }

  /**
   * Resolve external_student_id -> students.id, criando os que ainda não
   * existem. Cobre tanto a escola nova (eventos chegando antes do sync de
   * alunos) quanto cartão sem pessoa ("cartao:<n>").
   */
  private async garantirAlunos(
    schoolId: string,
    eventos: EventoDto[],
  ): Promise<Map<string, string>> {
    const ids = [...new Set(eventos.map((e) => e.external_student_id))];
    const existentes = await this.prisma.student.findMany({
      where: { schoolId, externalId: { in: ids } },
      select: { id: true, externalId: true },
    });
    const mapa = new Map(existentes.map((s) => [s.externalId, s.id]));

    for (const ev of eventos) {
      if (mapa.has(ev.external_student_id)) continue;
      const aluno = await this.prisma.student.upsert({
        where: {
          schoolId_externalId: { schoolId, externalId: ev.external_student_id },
        },
        create: {
          schoolId,
          externalId: ev.external_student_id,
          name: ev.student_name || this.nomePendente(ev),
          card: ev.card,
        },
        update: {},
        select: { id: true },
      });
      mapa.set(ev.external_student_id, aluno.id);
    }
    return mapa;
  }

  private nomePendente(ev: EventoDto): string {
    return ev.external_student_id.startsWith('cartao:')
      ? `Cartão ${ev.card ?? ev.external_student_id.slice(7)} (não vinculado)`
      : `Aluno ${ev.external_student_id} (aguardando sincronização)`;
  }
}
