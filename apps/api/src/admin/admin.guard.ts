import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

/** Operador interno autenticado. */
export interface ContextoAdmin {
  id: string;
  role: string;
}

/**
 * Admin interno: usuário sem escola vinculada (users.school_id nulo, doc §3)
 * e com role `admin`. Um usuário de escola nunca alcança estas rotas, mesmo
 * com token válido.
 */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const [esquema, token] = String(req.headers['authorization'] ?? '').split(' ');
    if (esquema !== 'Bearer' || !token) {
      throw new UnauthorizedException('token ausente');
    }
    let payload: any;
    try {
      payload = await this.jwt.verifyAsync(token);
    } catch {
      throw new UnauthorizedException('token inválido ou expirado');
    }
    if (payload.schoolId || payload.role !== 'admin') {
      throw new ForbiddenException('acesso restrito ao administrador');
    }
    req.admin = { id: payload.sub, role: payload.role } satisfies ContextoAdmin;
    return true;
  }
}
