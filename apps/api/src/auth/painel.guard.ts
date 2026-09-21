import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

/** Usuário autenticado do painel, anexado ao request. */
export interface ContextoUsuario {
  id: string;
  schoolId: string;
  role: string;
  /** true quando um operador interno entrou como a escola. */
  impersonando?: boolean;
}

@Injectable()
export class PainelGuard implements CanActivate {
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
    if (!payload.schoolId) {
      // Admin interno sem escola: o lugar dele é /admin, não o painel.
      throw new ForbiddenException('usuário sem escola vinculada');
    }
    req.usuario = {
      id: payload.sub,
      schoolId: payload.schoolId,
      role: payload.role,
      impersonando: !!payload.impersonando,
    } satisfies ContextoUsuario;
    return true;
  }
}
