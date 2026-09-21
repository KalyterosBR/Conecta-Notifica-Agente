import { FakePrisma } from './fake-prisma.spec-util';
import { HeartbeatService } from './heartbeat.service';

describe('HeartbeatService', () => {
  it('atualiza last_seen_at e guarda o status para o painel', async () => {
    const prisma = new FakePrisma();
    prisma.chaves.push({ id: 'k1' });
    const service = new HeartbeatService(prisma as any);

    await service.registrar(
      { schoolId: 'esc-1', apiKeyId: 'k1' },
      { version: '0.1.0', cursor: '918233', pending: 0, db_ok: true, sent_today: 412 },
    );

    const chave: any = prisma.chaves[0];
    expect(chave.lastSeenAt).toBeInstanceOf(Date);
    expect(chave.lastStatus).toMatchObject({ cursor: '918233', db_ok: true, sent_today: 412 });
  });
});
