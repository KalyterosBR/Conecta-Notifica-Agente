import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { MessageStatus } from '@prisma/client';
import { ContextoUsuario } from '../auth/painel.guard';
import { NotificacoesQueue } from '../filas/notificacoes.queue';
import { PrismaService } from '../prisma/prisma.service';
import { FiltroEnviosDto } from './dto';

const POR_PAGINA = 50;

const STATUS_API: Record<string, MessageStatus> = {
  queued: MessageStatus.QUEUED,
  sent: MessageStatus.SENT,
  delivered: MessageStatus.DELIVERED,
  read: MessageStatus.READ,
  failed: MessageStatus.FAILED,
};

@Injectable()
export class EnviosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly fila: NotificacoesQueue,
  ) {}

  async listar(u: ContextoUsuario, f: FiltroEnviosDto) {
    const where = {
      accessEvent: { schoolId: u.schoolId },
      ...(f.status ? { status: STATUS_API[f.status] } : {}),
      ...(f.de || f.ate
        ? {
            createdAt: {
              ...(f.de ? { gte: new Date(f.de) } : {}),
              ...(f.ate ? { lte: new Date(f.ate) } : {}),
            },
          }
        : {}),
    };
    const pagina = f.pagina ?? 1;
    const [total, mensagens] = await Promise.all([
      this.prisma.message.count({ where }),
      this.prisma.message.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (pagina - 1) * POR_PAGINA,
        take: POR_PAGINA,
        include: {
          guardian: { select: { name: true, phoneE164: true } },
          accessEvent: {
            select: {
              direction: true,
              occurredAt: true,
              student: { select: { name: true } },
            },
          },
        },
      }),
    ]);
    return {
      total,
      pagina,
      envios: mensagens.map((m) => ({
        id: m.id,
        aluno: m.accessEvent.student.name,
        responsavel: m.guardian.name,
        phone: m.guardian.phoneE164,
        direction: m.accessEvent.direction === 'IN' ? 'in' : 'out',
        occurred_at: m.accessEvent.occurredAt,
        status: m.status.toLowerCase(),
        error: m.error,
        attempts: m.attempts,
        sent_at: m.sentAt,
        delivered_at: m.deliveredAt,
      })),
    };
  }

  /** Reenvia uma mensagem que falhou (tela Envios, doc §4). */
  async reenviar(u: ContextoUsuario, id: string) {
    const msg = await this.prisma.message.findFirst({
      where: { id, accessEvent: { schoolId: u.schoolId } },
      include: { accessEvent: { select: { id: true, schoolId: true } } },
    });
    if (!msg) throw new NotFoundException();
    if (msg.status !== MessageStatus.FAILED) {
      throw new BadRequestException('só mensagens com falha podem ser reenviadas');
    }
    await this.prisma.message.update({
      where: { id },
      data: { status: MessageStatus.QUEUED, error: null },
    });
    // jobId novo: o job original (jobId = accessEventId) já foi consumido.
    await this.fila.reenfileirar({
      accessEventId: msg.accessEvent.id,
      schoolId: msg.accessEvent.schoolId,
    });
    return { ok: true };
  }
}
