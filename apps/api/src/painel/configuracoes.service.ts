import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { ContextoUsuario } from '../auth/painel.guard';
import { PrismaService } from '../prisma/prisma.service';
import { ProviderConfig } from '../provedores/provedor.interface';
import { InstanciasService } from '../provedores/instancias.service';
import { UazapiAdminService } from '../provedores/uazapi.admin';
import { AtualizarRegrasDto, ConectarWhatsappDto, IniciarConexaoDto } from './dto';

@Injectable()
export class ConfiguracoesService {
  private readonly log = new Logger(ConfiguracoesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly uazapi: UazapiAdminService,
    private readonly instancias: InstanciasService,
  ) {}

  async obter(u: ContextoUsuario) {
    const escola = await this.prisma.school.findUnique({
      where: { id: u.schoolId },
      include: { settings: true },
    });
    const chave = await this.prisma.agentApiKey.findFirst({
      where: { schoolId: u.schoolId, revokedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    const cfg = (escola!.providerConfig ?? {}) as ProviderConfig;
    const chips = await this.instancias.listar(u.schoolId);
    const alunos = await this.prisma.student.count({ where: { schoolId: u.schoolId } });
    return {
      escola: { name: escola!.name, timezone: escola!.timezone, plan: escola!.plan },
      // O que o contrato libera — a escola vê o teto, o admin é quem muda.
      contrato: {
        max_alunos: escola!.maxStudents,
        alunos_cadastrados: alunos,
        max_chips: escola!.maxInstances,
        bloqueado: escola!.blocked,
        motivo_bloqueio: escola!.blockedReason,
      },
      regras: {
        dedupe_minutes: escola!.settings?.dedupeMinutes ?? 3,
        window_start: escola!.settings?.windowStart ?? '06:00',
        window_end: escola!.settings?.windowEnd ?? '19:30',
        notify_weekends: escola!.settings?.notifyWeekends ?? false,
      },
      agente: {
        chave_criada_em: chave?.createdAt ?? null,
        last_seen_at: chave?.lastSeenAt ?? null,
      },
      whatsapp: {
        provider: cfg.provider ?? 'uazapi',
        // Conectado = pelo menos um chip pronto para enviar.
        conectado: chips.some((c) => c.conectado),
        chips,
        pode_adicionar: chips.length < escola!.maxInstances && !escola!.blocked,
        // token nunca volta ao painel; só sinalizamos que existe.
        webhook_token: cfg.webhook_token ?? null,
        // O painel mostra o QR quando dá para criar a instância (conta do
        // SaaS) ou quando a escola já tem uma — reconectar dispensa admintoken.
        qr_disponivel: this.uazapi.podeCriarInstancia || chips.length > 0,
      },
    };
  }

  async atualizarRegras(u: ContextoUsuario, dto: AtualizarRegrasDto) {
    const dados = {
      dedupeMinutes: dto.dedupe_minutes,
      windowStart: dto.window_start,
      windowEnd: dto.window_end,
      notifyWeekends: dto.notify_weekends,
    };
    await this.prisma.schoolSettings.upsert({
      where: { schoolId: u.schoolId },
      create: { schoolId: u.schoolId, ...limpar(dados) },
      update: limpar(dados),
    });
    return { ok: true };
  }

  /** Onboarding: conecta a instância UAZAPI da escola. */
  async conectarWhatsapp(u: ContextoUsuario, dto: ConectarWhatsappDto) {
    const escola = await this.prisma.school.findUnique({ where: { id: u.schoolId } });
    const atual = (escola!.providerConfig ?? {}) as ProviderConfig;
    const webhookToken = atual.webhook_token ?? randomBytes(16).toString('hex');
    if (!atual.webhook_token) {
      await this.prisma.school.update({
        where: { id: u.schoolId },
        data: { providerConfig: { ...atual, provider: 'uazapi', webhook_token: webhookToken } as object },
      });
    }
    // Instância pronta, cadastrada à mão: vira um chip como qualquer outro,
    // para o rodízio e o painel enxergarem tudo pelo mesmo lugar.
    const chip = await this.prisma.whatsappInstance.upsert({
      where: { schoolId_name: { schoolId: u.schoolId, name: 'manual-1' } },
      create: {
        schoolId: u.schoolId,
        name: 'manual-1',
        label: 'cadastrado manualmente',
        baseUrl: dto.base_url,
        token: dto.token,
        status: 'connected',
      },
      update: { baseUrl: dto.base_url, token: dto.token, status: 'connected' },
    });
    await this.apontarWebhook(u.schoolId, chip.id);
    return { ok: true, webhook_token: webhookToken };
  }

  /**
   * Onboarding por QR code. Sem `instancia_id` acrescenta mais um chip — até o
   * teto do contrato; com ele, reconecta o chip informado.
   */
  async iniciarConexaoWhatsapp(u: ContextoUsuario, dto: IniciarConexaoDto) {
    const { chip, estado } = await this.instancias.iniciarConexao(u.schoolId, {
      telefone: dto.telefone,
      instanciaId: dto.instancia_id,
      label: dto.label,
    });
    await this.apontarWebhook(u.schoolId, chip.id);
    return { chip, ...this.resposta(estado) };
  }

  /** Polling do painel enquanto o código está na tela. */
  async statusWhatsapp(u: ContextoUsuario, instanciaId?: string) {
    const chips = await this.instancias.listar(u.schoolId);
    const alvo = instanciaId ?? chips.at(-1)?.id;
    if (!alvo) return { status: 'sem_instancia', conectado: false, chips };
    const { chip, estado } = await this.instancias.status(u.schoolId, alvo);
    return { chip, ...this.resposta(estado) };
  }

  /** Solta o número; o chip continua existindo para reconectar com novo QR. */
  async desconectarWhatsapp(u: ContextoUsuario, instanciaId?: string) {
    const chips = await this.instancias.listar(u.schoolId);
    const alvo = instanciaId ?? chips.find((c) => c.conectado)?.id;
    if (!alvo) throw new BadRequestException('nenhum chip conectado');
    return { chip: await this.instancias.desconectar(u.schoolId, alvo) };
  }

  private resposta(estado: { status: string; conectado: boolean; qrcode?: string; paircode?: string; numero?: string; perfil?: string; foto?: string }) {
    return {
      status: estado.status,
      conectado: estado.conectado,
      // Já no formato que a tag <img> aceita.
      qrcode: estado.qrcode ? paraDataUri(estado.qrcode) : null,
      paircode: estado.paircode ?? null,
      numero: estado.numero ?? null,
      perfil: estado.perfil ?? null,
      foto: estado.foto ?? null,
    };
  }

  /** Aponta os eventos do chip para o nosso webhook de status. */
  private async apontarWebhook(schoolId: string, chipId: string) {
    const base = process.env.PUBLIC_API_URL?.replace(/\/$/, '');
    if (!base) return;
    const chip = await this.prisma.whatsappInstance.findUnique({ where: { id: chipId } });
    if (!chip) return;
    const escola = await this.prisma.school.findUnique({ where: { id: schoolId } });
    const cfg = (escola!.providerConfig ?? {}) as ProviderConfig;
    const webhookToken = cfg.webhook_token ?? randomBytes(16).toString('hex');
    try {
      await this.uazapi.registrarWebhook(
        chip.token,
        `${base}/v1/webhooks/uazapi/${webhookToken}`,
        chip.baseUrl,
      );
      if (!cfg.webhook_token) {
        await this.prisma.school.update({
          where: { id: schoolId },
          data: { providerConfig: { ...cfg, webhook_token: webhookToken } as object },
        });
      }
    } catch (e) {
      this.log.warn(`escola ${schoolId}: webhook não registrado — ${e instanceof Error ? e.message : e}`);
    }
  }

  private async salvarConfig(
    schoolId: string,
    atual: ProviderConfig,
    uazapi: NonNullable<ProviderConfig['uazapi']>,
  ) {
    const novo: ProviderConfig = {
      ...atual,
      provider: 'uazapi',
      webhook_token: atual.webhook_token ?? randomBytes(16).toString('hex'),
      uazapi,
    };
    await this.prisma.school.update({
      where: { id: schoolId },
      data: { providerConfig: novo as object },
    });
  }

  /** Regenera a API key do agente; a antiga é revogada na hora. */
  async regenerarChaveAgente(u: ContextoUsuario) {
    const chave = 'cn_' + randomBytes(24).toString('hex');
    await this.prisma.agentApiKey.updateMany({
      where: { schoolId: u.schoolId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await this.prisma.agentApiKey.create({
      data: {
        schoolId: u.schoolId,
        keyHash: createHash('sha256').update(chave).digest('hex'),
      },
    });
    // Única vez que a chave aparece em claro.
    return { api_key: chave };
  }
}

function limpar<T extends object>(o: T): T {
  return Object.fromEntries(
    Object.entries(o).filter(([, v]) => v !== undefined),
  ) as T;
}

/** "Escola Municipal Y" -> "escola-municipal-y", para o nome da instância. */
function apelido(nome: string): string {
  return nome
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 30);
}

/** A UAZAPI ora devolve o base64 puro, ora já com o prefixo data:. */
function paraDataUri(qr: string): string {
  return qr.startsWith('data:') ? qr : `data:image/png;base64,${qr}`;
}
