import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { MessageStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

// Ordem dos status: nunca regredir (um "delivered" atrasado não pode
// sobrescrever um "read").
const ORDEM: Record<MessageStatus, number> = {
  [MessageStatus.QUEUED]: 0,
  [MessageStatus.SENT]: 1,
  [MessageStatus.DELIVERED]: 2,
  [MessageStatus.READ]: 3,
  [MessageStatus.FAILED]: 4,
};

@Injectable()
export class WebhooksService {
  private readonly log = new Logger(WebhooksService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Atualiza o status de uma mensagem a partir do callback do provedor.
   * O token do caminho identifica a escola (provider_config.webhook_token).
   */
  async processarUazapi(token: string, corpo: unknown): Promise<{ updated: number }> {
    const escola = await this.prisma.school.findFirst({
      where: {
        providerConfig: { path: ['webhook_token'], equals: token },
      },
      select: { id: true },
    });
    if (!escola) throw new NotFoundException();

    const eventos = this.extrair(corpo);
    let updated = 0;
    for (const e of eventos) {
      const msg = await this.prisma.message.findFirst({
        where: {
          providerMessageId: e.providerMessageId,
          accessEvent: { schoolId: escola.id },
        },
        select: { id: true, status: true },
      });
      if (!msg) continue;
      if (ORDEM[e.status] <= ORDEM[msg.status]) continue;

      const dados: Prisma.MessageUpdateInput = { status: e.status };
      if (e.status === MessageStatus.DELIVERED) dados.deliveredAt = new Date();
      if (e.status === MessageStatus.FAILED && e.erro) dados.error = e.erro.slice(0, 500);
      await this.prisma.message.update({ where: { id: msg.id }, data: dados });
      updated++;
    }
    return { updated };
  }

  /**
   * O formato do callback varia entre versões da UAZAPI; extraímos com
   * tolerância os campos que importam (id da mensagem + status novo).
   */
  private extrair(corpo: unknown): {
    providerMessageId: string;
    status: MessageStatus;
    erro?: string;
  }[] {
    const b = (corpo ?? {}) as Record<string, any>;
    const candidatos = Array.isArray(b) ? b : [b.data ?? b];
    const saida: { providerMessageId: string; status: MessageStatus; erro?: string }[] = [];

    for (const c of candidatos) {
      if (!c || typeof c !== 'object') continue;
      const id = c.id ?? c.messageid ?? c.message_id ?? c.key?.id;
      const bruto = String(c.status ?? c.ack ?? b.event ?? '').toLowerCase();
      if (!id || !bruto) continue;

      let status: MessageStatus | null = null;
      if (['delivered', 'received', 'ack_device', '2'].includes(bruto)) {
        status = MessageStatus.DELIVERED;
      } else if (['read', 'seen', 'played', 'ack_read', '3', '4'].includes(bruto)) {
        status = MessageStatus.READ;
      } else if (['failed', 'error', 'undeliverable', '-1'].includes(bruto)) {
        status = MessageStatus.FAILED;
      } else if (['sent', 'ack_server', '1'].includes(bruto)) {
        status = MessageStatus.SENT;
      }
      if (!status) {
        this.log.debug(`status desconhecido no webhook: ${bruto}`);
        continue;
      }
      saida.push({
        providerMessageId: String(id),
        status,
        erro: c.error ?? c.reason,
      });
    }
    return saida;
  }
}
