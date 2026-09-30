import { Injectable } from '@nestjs/common';
import { agenteEstaOnline } from '../agente/status';
import { ContextoUsuario } from '../auth/painel.guard';
import { PrismaService } from '../prisma/prisma.service';
import { InstanciasService } from '../provedores/instancias.service';

const URL_API_OFICIAL = 'https://painel.conectapontoeacesso.com.br/api';

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
    const [
      escola,
      chave,
      chips,
      alunos,
      sincronizados,
      aguardandoSincronizacao,
      semResponsavel,
      comResponsavel,
    ] = await Promise.all([
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
        where: {
          schoolId: u.schoolId,
          active: true,
          NOT: { externalId: { startsWith: 'cartao:' } },
        },
      }),
      this.prisma.student.count({
        where: { schoolId: u.schoolId, active: true, externalId: { startsWith: 'cartao:' } },
      }),
      this.prisma.student.count({
        where: { schoolId: u.schoolId, active: true, guardians: { none: {} } },
      }),
      this.prisma.guardian.count({ where: { schoolId: u.schoolId } }),
    ]);

    const agenteOnline = agenteEstaOnline(chave?.lastSeenAt);
    // Primeiros passos sempre entrega o endpoint oficial para configuração do
    // agente. PUBLIC_API_URL continua reservado ao webhook de status.
    const urlAgente = URL_API_OFICIAL;
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
          ? 'Agente online'
          : agenteConectou
            ? 'Instalado anteriormente, mas está sem comunicação recente'
            : 'Ainda não recebemos o primeiro sinal deste agente',
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
        concluido: alunos > 0 && semResponsavel === 0 && aguardandoSincronizacao === 0,
        detalhe:
          alunos === 0
            ? 'Aguardando a primeira sincronização de alunos'
            : aguardandoSincronizacao > 0
              ? `${sincronizados} sincronizados da catraca · ${aguardandoSincronizacao} aguardando cadastro completo`
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
      alunos: {
        total: alunos,
        sincronizados,
        aguardando_sincronizacao: aguardandoSincronizacao,
        sem_responsavel: semResponsavel,
        responsaveis: comResponsavel,
      },
      // A Central do agente precisa deste endereço; melhor mostrar do que
      // deixar a escola adivinhar.
      url_agente: urlAgente,
    };
  }
}
