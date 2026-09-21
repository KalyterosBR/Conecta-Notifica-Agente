import { BadRequestException, Injectable } from '@nestjs/common';
import { ContextoUsuario } from '../auth/painel.guard';
import { PrismaService } from '../prisma/prisma.service';
import { TEMPLATE_PADRAO, VARIAVEIS, variaveisDesconhecidas } from '../notificacoes/template';
import { SalvarModeloDto } from './dto';

type Tipo = 'IN' | 'OUT';

/**
 * Modelos de mensagem por escola (doc §4, tela "Modelos"). Sem linha em
 * `message_templates` o worker já cai no TEMPLATE_PADRAO — por isso "restaurar
 * padrão" é apagar a linha, não gravar o texto padrão.
 */
@Injectable()
export class ModelosService {
  constructor(private readonly prisma: PrismaService) {}

  async listar(u: ContextoUsuario) {
    const salvos = await this.prisma.messageTemplate.findMany({
      where: { schoolId: u.schoolId },
    });
    const modelo = (t: Tipo) => {
      const s = salvos.find((x) => x.eventType === t);
      return { body: s?.body ?? TEMPLATE_PADRAO[t], personalizado: !!s };
    };
    return {
      variaveis: VARIAVEIS.map((v) => `{${v}}`),
      padrao: { in: TEMPLATE_PADRAO.IN, out: TEMPLATE_PADRAO.OUT },
      modelos: { in: modelo('IN'), out: modelo('OUT') },
    };
  }

  async salvar(u: ContextoUsuario, tipo: string, dto: SalvarModeloDto) {
    const eventType = direcao(tipo);
    const body = dto.body.trim();
    if (!body) throw new BadRequestException('a mensagem não pode ficar vazia');
    const desconhecidas = variaveisDesconhecidas(body);
    if (desconhecidas.length) {
      throw new BadRequestException(
        `variável não reconhecida: ${desconhecidas.join(', ')} — use ${VARIAVEIS.map(
          (v) => `{${v}}`,
        ).join(' ')}`,
      );
    }
    await this.prisma.messageTemplate.upsert({
      where: { schoolId_eventType: { schoolId: u.schoolId, eventType } },
      create: { schoolId: u.schoolId, eventType, body },
      update: { body },
    });
    // Vale para os próximos envios; o que já saiu não muda.
    return { ok: true, body, personalizado: true };
  }

  async restaurar(u: ContextoUsuario, tipo: string) {
    const eventType = direcao(tipo);
    await this.prisma.messageTemplate.deleteMany({
      where: { schoolId: u.schoolId, eventType },
    });
    return { ok: true, body: TEMPLATE_PADRAO[eventType], personalizado: false };
  }
}

function direcao(tipo: string): Tipo {
  if (tipo === 'in') return 'IN';
  if (tipo === 'out') return 'OUT';
  throw new BadRequestException('tipo deve ser "in" (entrada) ou "out" (saída)');
}
