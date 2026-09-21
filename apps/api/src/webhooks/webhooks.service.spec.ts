import { NotFoundException } from '@nestjs/common';
import { FakePrismaNotificacao } from '../agente/fake-prisma.spec-util';
import { WebhooksService } from './webhooks.service';

function montar() {
  const prisma = new FakePrismaNotificacao();
  prisma.escolas.push({
    id: 'esc-1',
    name: 'Escola Demo',
    timezone: 'America/Sao_Paulo',
    providerConfig: { provider: 'uazapi', webhook_token: 'tok-123' },
  });
  prisma.eventos.push({
    id: 'ev-1',
    schoolId: 'esc-1',
    studentId: 'alu-1',
    externalEventId: 'x',
    direction: 'IN',
    occurredAt: new Date(),
  });
  prisma.mensagens.push({
    id: 'msg-1',
    accessEventId: 'ev-1',
    guardianId: 'r1',
    provider: 'uazapi',
    status: 'SENT',
    providerMessageId: 'prov-9',
    attempts: 1,
  });
  return { prisma, service: new WebhooksService(prisma as any) };
}

describe('WebhooksService', () => {
  it('delivered atualiza status e deliveredAt', async () => {
    const { prisma, service } = montar();
    const r = await service.processarUazapi('tok-123', { id: 'prov-9', status: 'delivered' });
    expect(r.updated).toBe(1);
    expect(prisma.mensagens[0].status).toBe('DELIVERED');
    expect(prisma.mensagens[0].deliveredAt).toBeInstanceOf(Date);
  });

  it('não regride: delivered atrasado não sobrescreve read', async () => {
    const { prisma, service } = montar();
    await service.processarUazapi('tok-123', { id: 'prov-9', status: 'read' });
    const r = await service.processarUazapi('tok-123', { id: 'prov-9', status: 'delivered' });
    expect(r.updated).toBe(0);
    expect(prisma.mensagens[0].status).toBe('READ');
  });

  it('token desconhecido responde 404', async () => {
    const { service } = montar();
    await expect(service.processarUazapi('tok-errado', {})).rejects.toThrow(NotFoundException);
  });

  it('formatos alternativos (ack numérico, data aninhado) são aceitos', async () => {
    const { prisma, service } = montar();
    const r = await service.processarUazapi('tok-123', { data: { key: { id: 'prov-9' }, ack: '3' } });
    expect(r.updated).toBe(1);
    expect(prisma.mensagens[0].status).toBe('READ');
  });

  it('mensagem desconhecida é ignorada sem erro', async () => {
    const { service } = montar();
    const r = await service.processarUazapi('tok-123', { id: 'nao-existe', status: 'delivered' });
    expect(r.updated).toBe(0);
  });
});
