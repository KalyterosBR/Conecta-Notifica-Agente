import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ContextoAgente } from './chave-api.guard';

/**
 * Identidade mínima que o agente pode consultar sobre o próprio tenant.
 * Nunca inclui credenciais de provedor, dados pessoais ou configurações
 * internas da escola.
 */
export interface PerfilAgente {
  school_id: string;
  school_name: string;
  timezone: string;
  blocked: boolean;
  whatsapp_connected: boolean;
}

@Injectable()
export class PerfilAgenteService {
  constructor(private readonly prisma: PrismaService) {}

  async obter(agente: ContextoAgente): Promise<PerfilAgente> {
    const escola = await this.prisma.school.findUnique({
      where: { id: agente.schoolId },
      select: {
        id: true,
        name: true,
        timezone: true,
        blocked: true,
        instances: {
          where: { status: 'connected' },
          select: { id: true },
        },
      },
    });
    if (!escola) throw new UnauthorizedException('escola da chave não encontrada');

    return {
      school_id: escola.id,
      school_name: escola.name,
      timezone: escola.timezone,
      blocked: escola.blocked,
      whatsapp_connected: escola.instances.length > 0,
    };
  }
}
