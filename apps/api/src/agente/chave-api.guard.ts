import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';

/** Contexto do tenant resolvido pela API key, anexado ao request. */
export interface ContextoAgente {
  schoolId: string;
  apiKeyId: string;
}

export function hashChave(chave: string): string {
  return createHash('sha256').update(chave).digest('hex');
}

/**
 * Autentica o agente da escola: Authorization: Bearer <api_key>. A chave em
 * claro nunca é guardada — comparamos o sha256 com agent_api_keys.key_hash.
 */
@Injectable()
export class ChaveApiGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const cabecalho: string = req.headers['authorization'] ?? '';
    const [esquema, chave] = cabecalho.split(' ');
    if (esquema !== 'Bearer' || !chave) {
      throw new UnauthorizedException('API key ausente');
    }
    const registro = await this.prisma.agentApiKey.findFirst({
      where: { keyHash: hashChave(chave), revokedAt: null },
      select: { id: true, schoolId: true },
    });
    if (!registro) {
      throw new UnauthorizedException('API key inválida ou revogada');
    }
    req.agente = {
      schoolId: registro.schoolId,
      apiKeyId: registro.id,
    } satisfies ContextoAgente;
    return true;
  }
}
