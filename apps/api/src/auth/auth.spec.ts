import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { PainelGuard } from './painel.guard';
import { conferirSenha, gerarHashSenha } from './senha';

describe('senha (scrypt)', () => {
  it('hash confere e senha errada não passa', () => {
    const h = gerarHashSenha('demo1234');
    expect(h.startsWith('scrypt$')).toBe(true);
    expect(conferirSenha('demo1234', h)).toBe(true);
    expect(conferirSenha('outra', h)).toBe(false);
    expect(conferirSenha('demo1234', 'lixo')).toBe(false);
  });

  it('dois hashes da mesma senha são diferentes (sal aleatório)', () => {
    expect(gerarHashSenha('x')).not.toBe(gerarHashSenha('x'));
  });
});

describe('AuthService + PainelGuard', () => {
  const jwt = new JwtService({ secret: 'teste', signOptions: { expiresIn: '1h' } });
  const usuario = {
    id: 'u1',
    schoolId: 'esc-1',
    name: 'Direção',
    email: 'd@e.dev',
    role: 'school',
    passwordHash: gerarHashSenha('demo1234'),
  };
  const prisma = {
    user: { findUnique: async ({ where }: any) => (where.email === usuario.email ? usuario : null) },
  };
  const auth = new AuthService(prisma as any, jwt);
  const guard = new PainelGuard(jwt);

  const ctxCom = (authorization?: string) => {
    const req: any = { headers: { authorization } };
    return { req, ctx: { switchToHttp: () => ({ getRequest: () => req }) } as any };
  };

  it('login válido devolve token que o guard aceita', async () => {
    const sessao = await auth.login('d@e.dev', 'demo1234');
    expect(sessao.user).toMatchObject({ email: 'd@e.dev', school_id: 'esc-1' });

    const { req, ctx } = ctxCom(`Bearer ${sessao.token}`);
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    // Login normal nunca é sessão de impersonação.
    expect(req.usuario).toEqual({
      id: 'u1',
      schoolId: 'esc-1',
      role: 'school',
      impersonando: false,
    });
  });

  it('senha errada e e-mail inexistente: mesma exceção', async () => {
    await expect(auth.login('d@e.dev', 'errada')).rejects.toThrow(UnauthorizedException);
    await expect(auth.login('x@e.dev', 'demo1234')).rejects.toThrow(UnauthorizedException);
  });

  it('guard rejeita token adulterado e admin sem escola', async () => {
    const { ctx } = ctxCom('Bearer abc.def.ghi');
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);

    const tokenAdmin = await jwt.signAsync({ sub: 'u2', schoolId: null, role: 'admin' });
    const { ctx: ctx2 } = ctxCom(`Bearer ${tokenAdmin}`);
    await expect(guard.canActivate(ctx2)).rejects.toThrow('usuário sem escola vinculada');
  });
});
