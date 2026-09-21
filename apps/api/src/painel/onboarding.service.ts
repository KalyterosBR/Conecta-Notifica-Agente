import { Injectable } from '@nestjs/common';
import { ContextoUsuario } from '../auth/painel.guard';
import { PrismaService } from '../prisma/prisma.service';
import { InstanciasService } from '../provedores/instancias.service';

/** Um agente é considerado online com heartbeat nos últimos 90s. */
const AGENTE_ONLINE_MS = 90_000;

/**
 * Estado do onboarding (doc §4, tela 1). Três passos, na ordem em que
 * dependem um do outro: sem agente não há aluno; sem aluno não faz sentido
 * cadastrar responsável; sem WhatsApp nada sai.
 *
 * Nenhum passo é "marcado como feito" por clique — cada um é deduzido do
 * estado real, então recarregar a tela nunca mente sobre o que falta.
 */
@Injectable()
export class OnboardingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly instancias: InstanciasService,
  ) {}

  async estado(u: ContextoUsuario) {
    const [escola, chave, chips, alunos, semResponsavel, comResponsavel] = await Promise.all([
      this.prisma.school.findUnique({
        where: { id: u.schoolId },
        select: { name: true, maxInstances: true, blocked: true },
      }),
      this.prisma.agentApiKey.findFirst({
        where: { schoolId: u.schoolId, revokedAt: null },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true, lastSeenAt: true },
      }),
      this.instancias.listar(u.schoolId),
      this.prisma.student.count({ where: { schoolId: u.schoolId, active: true } }),
      this.prisma.student.count({
        where: { schoolId: u.schoolId, active: true, guardians: { none: {} } },
      }),
      this.prisma.guardian.count({ where: { schoolId: u.schoolId } }),
    ]);

    const agenteOnline =
      !!chave?.lastSeenAt && Date.now() - chave.lastSeenAt.getTime() < AGENTE_ONLINE_MS;
    // "Já falou alguma vez" é o que conclui o passo: o agente pode estar
    // reiniciando na hora em que a direção abre a tela.
    const agenteConectou = !!chave?.lastSeenAt;
    const whatsappConectado = chips.some((c) => c.conectado);

    const passos = [
      {
        id: 'agente',
        titulo: 'Instalar o agente na escola',
        concluido: agenteConectou,
        detalhe: agenteOnline
          ? 'Agente online, enviando os giros'
          : agenteConectou
            ? `Último sinal em ${chave!.lastSeenAt!.toISOString()}`
            : 'Ainda não recebemos nenhum sinal deste agente',
      },
      {
        id: 'whatsapp',
        titulo: 'Conectar o WhatsApp',
        concluido: whatsappConectado,
        detalhe: whatsappConectado
          ? `${chips.filter((c) => c.conectado).length} número(s) conectado(s)`
          : 'Nenhum número conectado — nada é enviado até aqui',
      },
      {
        id: 'responsaveis',
        titulo: 'Cadastrar os responsáveis',
        // Cadastrar todo mundo pode levar dias; o passo fecha quando a escola
        // já tem responsável para a maioria dos alunos sincronizados.
        concluido: alunos > 0 && semResponsavel === 0,
        detalhe:
          alunos === 0
            ? 'Aguardando a primeira sincronização de alunos'
            : semResponsavel === 0
              ? 'Todos os alunos têm responsável'
              : `${semResponsavel} de ${alunos} alunos ainda sem responsável`,
      },
    ];

    return {
      escola: escola?.name ?? '',
      bloqueado: escola?.blocked ?? false,
      passos,
      concluido: passos.every((p) => p.concluido),
      agente: {
        chave_criada_em: chave?.createdAt ?? null,
        last_seen_at: chave?.lastSeenAt ?? null,
        online: agenteOnline,
      },
      whatsapp: {
        chips,
        pode_adicionar: chips.length < (escola?.maxInstances ?? 1) && !escola?.blocked,
      },
      alunos: { total: alunos, sem_responsavel: semResponsavel, responsaveis: comResponsavel },
      // O agente precisa deste endereço no config.yaml; melhor mostrar do que
      // deixar a escola adivinhar.
      url_agente: process.env.PUBLIC_API_URL ?? null,
    };
  }
}
