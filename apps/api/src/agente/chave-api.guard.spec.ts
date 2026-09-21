import { UnauthorizedException } from '@nestjs/common';
import { ChaveApiGuard, hashChave } from './chave-api.guard';
import { FakePrisma } from './fake-prisma.spec-util';

function contexto(authorization?: string) {
  const req: any = { headers: { authorization } };
  return {
    req,
    ctx: { switchToHttp: () => ({ getRequest: () => req }) } as any,
  };
}

describe('ChaveApiGuard', () => {
  const prisma = new FakePrisma();
  (prisma.chaves as any).push(
    { id: 'k1', schoolId: 'esc-1', keyHash: hashChave('chave-boa') },
    { id: 'k2', schoolId: 'esc-1', keyHash: hashChave('chave-morta'), revokedAt: new Date() },
  );
  const guard = new ChaveApiGuard(prisma as any);

  it('chave válida anexa o tenant ao request', async () => {
    const { req, ctx } = contexto('Bearer chave-boa');
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(req.agente).toEqual({ schoolId: 'esc-1', apiKeyId: 'k1' });
  });

  it('rejeita chave desconhecida, revogada e header ausente', async () => {
    for (const auth of ['Bearer nao-existe', 'Bearer chave-morta', undefined, 'Basic x']) {
      const { ctx } = contexto(auth);
      await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
    }
  });
});
