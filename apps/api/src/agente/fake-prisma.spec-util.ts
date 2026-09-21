// Fake em memória da fatia do Prisma que os services do agente usam.
// Reproduz o comportamento que importa: os uniques
// (school_id, external_event_id) e (school_id, external_id).
import { Prisma } from '@prisma/client';

let seq = 0;
const uuid = () => `id-${++seq}`;

interface AlunoFake {
  id: string;
  schoolId: string;
  externalId: string;
  name: string;
  className?: string | null;
  card?: string | null;
  active: boolean;
  syncedAt: Date;
}

interface EventoFake {
  id: string;
  schoolId: string;
  studentId: string;
  externalEventId: string;
  direction: string;
  occurredAt: Date;
}

function conflitoUnique(): never {
  throw new Prisma.PrismaClientKnownRequestError('unique', {
    code: 'P2002',
    clientVersion: 'fake',
  });
}

export class FakePrisma {
  alunos: AlunoFake[] = [];
  eventos: EventoFake[] = [];
  chaves: { id: string; lastSeenAt?: Date; lastStatus?: unknown }[] = [];
  /** Teto de alunos do contrato; null = sem teto, que é o padrão dos cenários. */
  maxStudents: number | null = null;

  school = {
    findUnique: async () => ({ maxStudents: this.maxStudents }),
  };

  student = {
    findMany: async ({ where }: any) =>
      this.alunos
        .filter(
          (s) =>
            s.schoolId === where.schoolId &&
            (!where.externalId || !where.externalId.in || where.externalId.in.includes(s.externalId)),
        )
        .map((s) => ({ ...s })),

    upsert: async ({ where, create, update }: any) => {
      const { schoolId, externalId } = where.schoolId_externalId;
      const atual = this.alunos.find(
        (s) => s.schoolId === schoolId && s.externalId === externalId,
      );
      if (atual) {
        Object.assign(atual, update);
        return { ...atual };
      }
      const novo: AlunoFake = {
        id: uuid(),
        active: true,
        syncedAt: new Date(),
        className: null,
        card: null,
        ...create,
      };
      this.alunos.push(novo);
      return { ...novo };
    },

    updateMany: async ({ where, data }: any) => {
      let count = 0;
      for (const s of this.alunos) {
        if (s.schoolId !== where.schoolId) continue;
        if (where.active !== undefined && s.active !== where.active) continue;
        if (where.externalId?.notIn && where.externalId.notIn.includes(s.externalId)) continue;
        if (
          where.NOT?.externalId?.startsWith &&
          s.externalId.startsWith(where.NOT.externalId.startsWith)
        )
          continue;
        Object.assign(s, data);
        count++;
      }
      return { count };
    },
  };

  accessEvent = {
    create: async ({ data }: any) => {
      const repetido = this.eventos.some(
        (e) =>
          e.schoolId === data.schoolId &&
          e.externalEventId === data.externalEventId,
      );
      if (repetido) conflitoUnique();
      const novo: EventoFake = { id: uuid(), ...data };
      this.eventos.push(novo);
      return { id: novo.id };
    },
  };

  agentApiKey = {
    findFirst: async ({ where }: any) => {
      const c = this.chaves.find((k: any) => k.keyHash === where.keyHash && !k.revokedAt);
      return c ? { id: (c as any).id, schoolId: (c as any).schoolId } : null;
    },
    update: async ({ where, data }: any) => {
      const c = this.chaves.find((k) => k.id === where.id);
      if (!c) throw new Error('chave não encontrada');
      Object.assign(c, data);
      return { ...c };
    },
  };
}

export class FakeFila {
  enfileirados: { accessEventId: string; schoolId: string }[] = [];
  async enfileirar(ts: { accessEventId: string; schoolId: string }[]) {
    this.enfileirados.push(...ts);
  }
}

// ---------------------------------------------------------------------------
// Extensões usadas pelo notificador e pelos webhooks.

interface MensagemFake {
  id: string;
  accessEventId: string;
  guardianId: string;
  provider: string;
  status: string;
  providerMessageId?: string | null;
  attempts: number;
  error?: string | null;
  sentAt?: Date | null;
  deliveredAt?: Date | null;
}

export interface CenarioEscola {
  id: string;
  name: string;
  timezone: string;
  providerConfig?: unknown;
  /** Bloqueio comercial do admin interno. */
  blocked?: boolean;
  blockedReason?: string | null;
  /** Atalho do cenário: escola sem nenhum chip conectado. */
  semChip?: boolean;
  settings?: Partial<{
    dedupeMinutes: number;
    windowStart: string;
    windowEnd: string;
    notifyWeekends: boolean;
  }> | null;
  templates?: { eventType: string; body: string }[];
}

export interface CenarioVinculo {
  guardian: {
    id: string;
    name: string;
    phoneE164: string;
    optInAt?: Date | null;
    optOutAt?: Date | null;
  };
  notifyEntry?: boolean;
  notifyExit?: boolean;
}

export class FakePrismaNotificacao extends FakePrisma {
  escolas: CenarioEscola[] = [];
  vinculos = new Map<string, CenarioVinculo[]>(); // studentId -> vínculos
  mensagens: MensagemFake[] = [];

  // Preserva o create do FakePrisma (o campo do pai já foi inicializado
  // quando este inicializador roda) e acrescenta as leituras do notificador.
  accessEvent: any = (() => {
    const base = this.accessEvent as any;
    return {
      create: base.create,

      findUnique: async ({ where }: any) => {
        const ev: any = this.eventos.find((e) => e.id === where.id);
        if (!ev) return null;
        const escola = this.escolas.find((s) => s.id === ev.schoolId)!;
        const aluno = this.alunos.find((s) => s.id === ev.studentId)!;
        return {
          ...ev,
          student: {
            ...aluno,
            guardians: (this.vinculos.get(aluno.id) ?? []).map((v) => ({
              notifyEntry: v.notifyEntry ?? true,
              notifyExit: v.notifyExit ?? true,
              guardianId: v.guardian.id,
              guardian: { optInAt: null, optOutAt: null, ...v.guardian },
            })),
          },
          school: {
            ...escola,
            settings: escola.settings ?? null,
            templates: escola.templates ?? [],
          },
        };
      },

      findFirst: async ({ where }: any) => {
        const hit: any = this.eventos.find((e: any) => {
          if (e.schoolId !== where.schoolId) return false;
          if (e.studentId !== where.studentId) return false;
          if (e.direction !== where.direction) return false;
          if (where.NOT?.id && e.id === where.NOT.id) return false;
          if (where.occurredAt?.gte && e.occurredAt < where.occurredAt.gte) return false;
          if (where.occurredAt?.lt && !(e.occurredAt < where.occurredAt.lt)) return false;
          return true;
        });
        return hit ? { id: hit.id } : null;
      },
    };
  })();

  message = {
    upsert: async ({ where, create, update }: any) => {
      const { accessEventId, guardianId } = where.accessEventId_guardianId;
      let m = this.mensagens.find(
        (x) => x.accessEventId === accessEventId && x.guardianId === guardianId,
      );
      if (m) {
        this.aplicar(m, update);
        return { ...m };
      }
      m = { id: uuid(), attempts: 0, status: 'QUEUED', ...create };
      this.mensagens.push(m!);
      return { ...m };
    },
    update: async ({ where, data }: any) => {
      const m = this.mensagens.find((x) => x.id === where.id);
      if (!m) throw new Error('mensagem não encontrada');
      this.aplicar(m, data);
      return { ...m };
    },
    findFirst: async ({ where }: any) => {
      const m = this.mensagens.find((x) => {
        if (x.providerMessageId !== where.providerMessageId) return false;
        if (where.accessEvent?.schoolId) {
          const ev = this.eventos.find((e) => e.id === x.accessEventId);
          if (!ev || ev.schoolId !== where.accessEvent.schoolId) return false;
        }
        return true;
      });
      return m ? { id: m.id, status: m.status } : null;
    },
  };

  // Herda o findUnique do pai e acrescenta a busca do webhook por token.
  override school = {
    findUnique: async () => ({ maxStudents: this.maxStudents }),
    findFirst: async ({ where }: any) => {
      const j = where.providerConfig;
      const hit = this.escolas.find((s) => {
        const cfg = (s.providerConfig ?? {}) as any;
        return cfg[j.path[0]] === j.equals;
      });
      return hit ? { id: hit.id } : null;
    },
  };

  private aplicar(alvo: any, mudancas: any) {
    for (const [k, v] of Object.entries(mudancas ?? {})) {
      if (v && typeof v === 'object' && 'increment' in (v as any)) {
        alvo[k] = (alvo[k] ?? 0) + (v as any).increment;
      } else {
        alvo[k] = v;
      }
    }
  }
}

export class FakeProvedor {
  enviados: { telefone: string; texto: string }[] = [];
  falharPara = new Set<string>();
  readonly nome = 'fake';

  async enviarTexto(telefone: string, texto: string) {
    if (this.falharPara.has(telefone)) throw new Error('provedor caiu');
    this.enviados.push({ telefone, texto });
    return { id: `prov-${this.enviados.length}` };
  }
}
