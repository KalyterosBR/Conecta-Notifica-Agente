import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { MessageStatus, Prisma, StatusCobranca } from '@prisma/client';
import { createHash, randomBytes } from 'node:crypto';
import { agenteEstaOnline } from '../agente/status';
import { gerarHashSenha } from '../auth/senha';
import { PrismaService } from '../prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';
import { MonitoramentoService } from '../monitoramento/monitoramento.service';
import { AtualizarEscolaDto, BloquearDto, CobrancaDto, CriarEscolaDto } from './dto';

@Injectable()
export class AdminService {
  private readonly log = new Logger(AdminService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly monitoramento: MonitoramentoService,
    private readonly jwt: JwtService,
  ) {}

  /**
   * Entra no painel como a escola, para o suporte ver o que a direção vê
   * (doc §4). O token é curto e carrega `impersonando`, que o painel usa para
   * avisar na tela — ninguém pode esquecer que está dentro do cliente.
   *
   * Não vira sessão de usuário da escola: o `sub` continua sendo o operador,
   * então qualquer coisa feita aqui é rastreável até quem entrou.
   */
  async impersonar(adminId: string, schoolId: string) {
    const escola = await this.prisma.school.findUnique({
      where: { id: schoolId },
      select: { id: true, name: true },
    });
    if (!escola) throw new NotFoundException('escola não encontrada');
    const admin = await this.prisma.user.findUnique({
      where: { id: adminId },
      select: { name: true },
    });
    const token = await this.jwt.signAsync(
      {
        sub: adminId,
        schoolId: escola.id,
        role: 'admin',
        name: admin?.name ?? 'suporte',
        impersonando: true,
      },
      { expiresIn: '30m' },
    );
    this.log.warn(`admin ${adminId} entrou como a escola ${escola.name} (${escola.id})`);
    return { token, escola: escola.name, expira_em_minutos: 30 };
  }

  /** Agentes que pararam de dar sinal — a falha silenciosa do doc §2.5. */
  agentesMudos() {
    return this.monitoramento.agentesMudos();
  }

  /** Números do topo da tela: quantas escolas, quantas com problema. */
  async resumo() {
    const [escolas, bloqueadas, inadimplentes, semNota, mensagensMes, mudos] = await Promise.all([
      this.prisma.school.count(),
      this.prisma.school.count({ where: { blocked: true } }),
      this.prisma.school.count({
        where: { billingStatus: { in: [StatusCobranca.PENDENTE, StatusCobranca.ATRASADO] } },
      }),
      this.prisma.school.count({ where: { invoiceIssued: false, billingStatus: { not: StatusCobranca.ISENTO } } }),
      this.prisma.message.count({ where: { createdAt: { gte: inicioDoMes() } } }),
      this.monitoramento.agentesMudos(),
    ]);
    return {
      escolas,
      bloqueadas,
      inadimplentes,
      sem_nota: semNota,
      mensagens_mes: mensagensMes,
      agentes_mudos: mudos.length,
    };
  }

  /** Lista com o que o operador precisa para bater o olho e agir. */
  async listar(busca?: string) {
    const where: Prisma.SchoolWhereInput = busca
      ? {
          OR: [
            { name: { contains: busca, mode: 'insensitive' } },
            { cnpj: { contains: soDigitos(busca) || busca } },
          ],
        }
      : {};
    const escolas = await this.prisma.school.findMany({ where, orderBy: { name: 'asc' } });
    return { escolas: await Promise.all(escolas.map((e) => this.comMetricas(e))) };
  }

  async detalhe(id: string) {
    const escola = await this.prisma.school.findUnique({
      where: { id },
      include: {
        users: { select: { id: true, name: true, email: true, role: true } },
        instances: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!escola) throw new NotFoundException('escola não encontrada');

    const base = await this.comMetricas(escola);
    const ultimos = await this.prisma.message.findMany({
      where: { accessEvent: { schoolId: id } },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: { status: true, createdAt: true, error: true },
    });
    return {
      ...base,
      observacoes: escola.notes,
      conta_azul_id: escola.contaAzulId,
      criada_em: escola.createdAt,
      usuarios: escola.users,
      chips: escola.instances.map((c) => ({
        id: c.id,
        nome: c.name,
        label: c.label,
        status: c.status,
        numero: c.phone,
        perfil: c.profileName,
        conectado_em: c.connectedAt,
        ultimo_envio: c.lastUsedAt,
      })),
      ultimas_mensagens: ultimos,
    };
  }

  async criar(dto: CriarEscolaDto) {
    const cnpj = dto.cnpj ? soDigitos(dto.cnpj) : undefined;
    if (cnpj && cnpj.length !== 14) throw new BadRequestException('CNPJ deve ter 14 dígitos');
    if (await this.prisma.user.findUnique({ where: { email: dto.email } })) {
      throw new ConflictException('já existe usuário com este e-mail');
    }
    if (cnpj && (await this.prisma.school.findUnique({ where: { cnpj } }))) {
      throw new ConflictException('já existe escola com este CNPJ');
    }

    // Senha e chave aparecem uma única vez, como no criar-escola.ts.
    const senha = randomBytes(6).toString('base64url');
    const apiKey = 'cn_' + randomBytes(24).toString('hex');
    const escola = await this.prisma.school.create({
      data: {
        name: dto.nome,
        cnpj,
        plan: dto.plano ?? 'basico',
        maxStudents: dto.max_alunos ?? null,
        maxInstances: dto.max_chips ?? 1,
        providerConfig: { provider: 'uazapi', webhook_token: randomBytes(16).toString('hex') },
        settings: { create: {} },
        apiKeys: { create: { keyHash: createHash('sha256').update(apiKey).digest('hex') } },
        users: { create: { name: 'Direção', email: dto.email, passwordHash: gerarHashSenha(senha) } },
      },
    });
    return { id: escola.id, nome: escola.name, email: dto.email, senha, api_key: apiKey };
  }

  async atualizar(id: string, dto: AtualizarEscolaDto) {
    await this.exigir(id);
    const cnpj = dto.cnpj === undefined ? undefined : soDigitos(dto.cnpj);
    if (cnpj !== undefined && cnpj.length !== 14) {
      throw new BadRequestException('CNPJ deve ter 14 dígitos');
    }
    if (cnpj) {
      const outro = await this.prisma.school.findUnique({ where: { cnpj } });
      if (outro && outro.id !== id) throw new ConflictException('CNPJ já usado por outra escola');
    }
    // max_alunos = 0 significa "sem teto"; é como o formulário limpa o campo.
    const maxStudents =
      dto.max_alunos === undefined ? undefined : dto.max_alunos ? dto.max_alunos : null;
    const escola = await this.prisma.school.update({
      where: { id },
      data: {
        name: dto.nome,
        cnpj,
        plan: dto.plano,
        maxStudents,
        maxInstances: dto.max_chips,
        notes: dto.observacoes,
        contaAzulId: dto.conta_azul_id,
      },
    });
    return this.comMetricas(escola);
  }

  /**
   * Liga e desliga o cliente. Bloqueado, o evento continua sendo gravado e
   * aparecendo no painel — só o aviso no WhatsApp não sai, e nenhum chip novo
   * pode ser conectado. Religar volta a notificar do próximo giro em diante.
   */
  async bloquear(id: string, dto: BloquearDto) {
    await this.exigir(id);
    const escola = await this.prisma.school.update({
      where: { id },
      data: {
        blocked: dto.bloqueado,
        blockedReason: dto.bloqueado ? (dto.motivo ?? 'bloqueio administrativo') : null,
        blockedAt: dto.bloqueado ? new Date() : null,
      },
    });
    return this.comMetricas(escola);
  }

  /**
   * Espelho do financeiro. Hoje é o operador quem informa; quando a
   * integração com o Conta Azul entrar, é este mesmo método que ela alimenta
   * (por isso `billingSyncedAt` marca sempre a última atualização).
   */
  async cobranca(id: string, dto: CobrancaDto) {
    await this.exigir(id);
    const escola = await this.prisma.school.update({
      where: { id },
      data: {
        billingStatus: dto.status ? (dto.status.toUpperCase() as StatusCobranca) : undefined,
        invoiceIssued: dto.nota_emitida,
        lastInvoiceAt:
          dto.data_nota !== undefined
            ? dto.data_nota
              ? new Date(dto.data_nota)
              : null
            : dto.nota_emitida
              ? new Date()
              : undefined,
        billingSyncedAt: new Date(),
      },
    });
    return this.comMetricas(escola);
  }

  private async exigir(id: string) {
    const escola = await this.prisma.school.findUnique({ where: { id }, select: { id: true } });
    if (!escola) throw new NotFoundException('escola não encontrada');
    return escola;
  }

  /** Saúde e consumo de uma escola, do jeito que a lista precisa mostrar. */
  private async comMetricas(escola: {
    id: string;
    name: string;
    cnpj: string | null;
    plan: string;
    maxStudents: number | null;
    maxInstances: number;
    blocked: boolean;
    blockedReason: string | null;
    blockedAt: Date | null;
    billingStatus: StatusCobranca;
    invoiceIssued: boolean;
    lastInvoiceAt: Date | null;
    billingSyncedAt: Date | null;
  }) {
    const desdeMes = inicioDoMes();
    const [alunos, chips, chipsConectados, chave, mensagensMes, falhasMes] = await Promise.all([
      this.prisma.student.count({ where: { schoolId: escola.id, active: true } }),
      this.prisma.whatsappInstance.count({ where: { schoolId: escola.id } }),
      this.prisma.whatsappInstance.count({ where: { schoolId: escola.id, status: 'connected' } }),
      this.prisma.agentApiKey.findFirst({
        where: { schoolId: escola.id, revokedAt: null },
        orderBy: { createdAt: 'desc' },
        select: { lastSeenAt: true },
      }),
      this.prisma.message.count({
        where: { accessEvent: { schoolId: escola.id }, createdAt: { gte: desdeMes } },
      }),
      this.prisma.message.count({
        where: {
          accessEvent: { schoolId: escola.id },
          createdAt: { gte: desdeMes },
          status: MessageStatus.FAILED,
        },
      }),
    ]);
    const agenteOnline = agenteEstaOnline(chave?.lastSeenAt);

    return {
      id: escola.id,
      nome: escola.name,
      cnpj: escola.cnpj,
      plano: escola.plan,
      bloqueado: escola.blocked,
      motivo_bloqueio: escola.blockedReason,
      bloqueado_em: escola.blockedAt,
      contrato: {
        max_alunos: escola.maxStudents,
        max_chips: escola.maxInstances,
      },
      uso: {
        alunos,
        chips,
        chips_conectados: chipsConectados,
        mensagens_mes: mensagensMes,
        falhas_mes: falhasMes,
        // Estourou o teto? Acontece se o admin reduzir o plano depois.
        alunos_acima_do_teto: escola.maxStudents !== null && alunos > escola.maxStudents,
      },
      agente: { online: agenteOnline, last_seen_at: chave?.lastSeenAt ?? null },
      cobranca: {
        status: escola.billingStatus.toLowerCase(),
        nota_emitida: escola.invoiceIssued,
        data_nota: escola.lastInvoiceAt,
        atualizado_em: escola.billingSyncedAt,
      },
      // Verde só quando tudo o que precisa estar de pé está de pé.
      saudavel:
        !escola.blocked && agenteOnline && chipsConectados > 0 && escola.billingStatus !== StatusCobranca.ATRASADO,
    };
  }
}

function inicioDoMes(): Date {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function soDigitos(v: string): string {
  return v.replace(/\D/g, '');
}
