import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { WhatsappInstance } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MessageProvider } from './provedor.interface';
import { UazapiProvider } from './uazapi.provider';
import { EstadoInstancia, UazapiAdminService } from './uazapi.admin';

/** Um chip como o painel enxerga — sem o token, que nunca sai da API. */
export interface ChipPainel {
  id: string;
  nome: string;
  label: string | null;
  status: string;
  conectado: boolean;
  numero: string | null;
  perfil: string | null;
  conectado_em: Date | null;
  ultimo_envio: Date | null;
}

/**
 * Os chips da escola: cada linha de whatsapp_instances é uma instância na
 * UAZAPI. Quantos a escola pode ter é o `maxInstances` do contrato, definido
 * pelo admin interno.
 */
@Injectable()
export class InstanciasService {
  private readonly log = new Logger(InstanciasService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly uazapi: UazapiAdminService,
  ) {}

  async listar(schoolId: string): Promise<ChipPainel[]> {
    const chips = await this.prisma.whatsappInstance.findMany({
      where: { schoolId },
      orderBy: { createdAt: 'asc' },
    });
    return chips.map(paraPainel);
  }

  /**
   * Inicia a leitura do QR. Sem `instanciaId` cria mais um chip — desde que o
   * contrato permita. Com `instanciaId`, reconecta um que já existe.
   */
  async iniciarConexao(
    schoolId: string,
    opcoes: { telefone?: string; instanciaId?: string; label?: string },
  ): Promise<{ chip: ChipPainel; estado: EstadoInstancia }> {
    const chip = opcoes.instanciaId
      ? await this.exigir(schoolId, opcoes.instanciaId)
      : await this.criar(schoolId, opcoes.label);

    const estado = await this.uazapi.conectar(chip.token, opcoes.telefone, chip.baseUrl);
    const atualizado = await this.gravarEstado(chip, estado);
    return { chip: paraPainel(atualizado), estado };
  }

  /** Polling do painel: pergunta à UAZAPI e atualiza a linha. */
  async status(schoolId: string, instanciaId: string): Promise<{ chip: ChipPainel; estado: EstadoInstancia }> {
    const chip = await this.exigir(schoolId, instanciaId);
    const estado = await this.uazapi.status(chip.token, chip.baseUrl);
    const atualizado = await this.gravarEstado(chip, estado);
    return { chip: paraPainel(atualizado), estado };
  }

  async desconectar(schoolId: string, instanciaId: string): Promise<ChipPainel> {
    const chip = await this.exigir(schoolId, instanciaId);
    await this.uazapi.desconectar(chip.token, chip.baseUrl);
    const atualizado = await this.prisma.whatsappInstance.update({
      where: { id: chip.id },
      data: { status: 'disconnected', phone: null, profileName: null, connectedAt: null },
    });
    return paraPainel(atualizado);
  }

  /**
   * Escolhe o chip do próximo envio: conectado e parado há mais tempo. É o
   * rodízio que evita concentrar o volume num número só (doc §2.5).
   */
  async paraEnvio(
    schoolId: string,
  ): Promise<{ id: string; provedor: MessageProvider } | null> {
    const chip = await this.prisma.whatsappInstance.findFirst({
      where: { schoolId, status: 'connected' },
      orderBy: [{ lastUsedAt: { sort: 'asc', nulls: 'first' } }, { createdAt: 'asc' }],
    });
    if (!chip) return null;
    return { id: chip.id, provedor: new UazapiProvider(chip.baseUrl, chip.token) };
  }

  /** Marca o uso para o rodízio. Falhar aqui não pode derrubar o envio. */
  async registrarUso(instanciaId: string): Promise<void> {
    await this.prisma.whatsappInstance
      .update({ where: { id: instanciaId }, data: { lastUsedAt: new Date() } })
      .catch(() => undefined);
  }

  private async criar(schoolId: string, label?: string): Promise<WhatsappInstance> {
    if (!this.uazapi.podeCriarInstancia) {
      throw new BadRequestException(
        'A conta UAZAPI não está configurada nesta API (UAZAPI_URL e UAZAPI_ADMIN_TOKEN)',
      );
    }
    const escola = await this.prisma.school.findUnique({
      where: { id: schoolId },
      select: { name: true, maxInstances: true, blocked: true },
    });
    if (!escola) throw new NotFoundException('escola não encontrada');
    if (escola.blocked) {
      throw new BadRequestException('escola bloqueada: fale com o suporte para liberar');
    }
    const existentes = await this.prisma.whatsappInstance.count({ where: { schoolId } });
    if (existentes >= escola.maxInstances) {
      throw new BadRequestException(
        `o plano libera ${escola.maxInstances} ${escola.maxInstances === 1 ? 'chip' : 'chips'}; ` +
          'remova um número ou fale com o suporte para ampliar',
      );
    }

    const nome = `notifica-${apelido(escola.name)}-${schoolId.slice(0, 8)}-${existentes + 1}`;
    const criada = await this.uazapi.criarInstancia(nome);
    this.log.log(`escola ${schoolId}: instância ${nome} criada na UAZAPI`);
    return this.prisma.whatsappInstance.create({
      data: {
        schoolId,
        name: nome,
        externalId: criada.id,
        baseUrl: this.uazapi.baseUrl,
        token: criada.token,
        label: label ?? null,
        status: 'connecting',
      },
    });
  }

  private async exigir(schoolId: string, id: string): Promise<WhatsappInstance> {
    const chip = await this.prisma.whatsappInstance.findFirst({ where: { id, schoolId } });
    if (!chip) throw new NotFoundException('chip não encontrado nesta escola');
    return chip;
  }

  private gravarEstado(chip: WhatsappInstance, estado: EstadoInstancia) {
    const conectando = estado.status === 'connected';
    return this.prisma.whatsappInstance.update({
      where: { id: chip.id },
      data: {
        status: estado.status,
        phone: estado.numero ?? (conectando ? chip.phone : null),
        profileName: estado.perfil ?? (conectando ? chip.profileName : null),
        connectedAt: conectando ? (chip.connectedAt ?? new Date()) : null,
      },
    });
  }
}

function paraPainel(c: WhatsappInstance): ChipPainel {
  return {
    id: c.id,
    nome: c.name,
    label: c.label,
    status: c.status,
    conectado: c.status === 'connected',
    numero: c.phone,
    perfil: c.profileName,
    conectado_em: c.connectedAt,
    ultimo_envio: c.lastUsedAt,
  };
}

/** "Escola Municipal Ávila" -> "escola-municipal-avila". */
export function apelido(nome: string): string {
  return nome
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 30);
}
