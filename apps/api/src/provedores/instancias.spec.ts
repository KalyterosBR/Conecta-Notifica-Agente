import { BadRequestException } from '@nestjs/common';
import { InstanciasService } from './instancias.service';
import { EstadoInstancia, UazapiAdminService } from './uazapi.admin';

class UazapiFake extends UazapiAdminService {
  criadas: string[] = [];
  servidores: Array<string | undefined> = [];
  estado: EstadoInstancia = { status: 'connecting', conectado: false, qrcode: 'QR' };

  override get podeCriarInstancia() {
    return true;
  }
  override get baseUrl() {
    return 'https://conta.uazapi.com';
  }
  override async criarInstancia(nome: string) {
    this.criadas.push(nome);
    return { token: `tok-${this.criadas.length}`, id: `inst-${this.criadas.length}` };
  }
  override async conectar(_t: string, _tel?: string, servidor?: string) {
    this.servidores.push(servidor);
    return this.estado;
  }
  override async status() {
    return this.estado;
  }
  override async desconectar() {}
}

/** Prisma de mentira com as tabelas que o serviço toca. */
function montar(escola: Partial<{ maxInstances: number; blocked: boolean; name: string }> = {}) {
  const dados = { id: 'esc-1', name: 'Escola Ávila', maxInstances: 1, blocked: false, ...escola };
  const chips: any[] = [];
  const prisma = {
    school: { findUnique: async () => ({ ...dados }) },
    whatsappInstance: {
      findMany: async ({ where }: any) => chips.filter((c) => c.schoolId === where.schoolId),
      count: async ({ where }: any) => chips.filter((c) => c.schoolId === where.schoolId).length,
      create: async ({ data }: any) => {
        const c = { id: `chip-${chips.length + 1}`, createdAt: new Date(chips.length), lastUsedAt: null, phone: null, profileName: null, connectedAt: null, ...data };
        chips.push(c);
        return c;
      },
      findFirst: async ({ where, orderBy }: any) => {
        let lista = chips.filter((c) => c.schoolId === where.schoolId);
        if (where.id) lista = lista.filter((c) => c.id === where.id);
        if (where.status) lista = lista.filter((c) => c.status === where.status);
        if (orderBy) {
          // Rodízio: nulls primeiro, depois o mais antigo.
          lista = [...lista].sort((a, b) => {
            const x = a.lastUsedAt?.getTime() ?? -1;
            const y = b.lastUsedAt?.getTime() ?? -1;
            return x - y;
          });
        }
        return lista[0] ?? null;
      },
      findUnique: async ({ where }: any) => chips.find((c) => c.id === where.id) ?? null,
      update: async ({ where, data }: any) => {
        const c = chips.find((x) => x.id === where.id);
        Object.assign(c, data);
        return c;
      },
    },
  };
  const uazapi = new UazapiFake();
  return { chips, uazapi, service: new InstanciasService(prisma as any, uazapi) };
}

describe('InstanciasService — chips da escola', () => {
  it('primeiro chip é criado com nome derivado da escola e já entra conectando', async () => {
    const { uazapi, service, chips } = montar();
    const r = await service.iniciarConexao('esc-1', {});

    expect(uazapi.criadas).toEqual(['notifica-escola-avila-esc-1-1']);
    expect(r.estado.qrcode).toBe('QR');
    expect(chips[0].token).toBe('tok-1');
    // A conexão vai para o servidor onde a instância foi criada.
    expect(uazapi.servidores).toEqual(['https://conta.uazapi.com']);
  });

  it('o teto de chips do contrato é respeitado', async () => {
    const { service } = montar({ maxInstances: 2 });
    await service.iniciarConexao('esc-1', {});
    await service.iniciarConexao('esc-1', {});
    await expect(service.iniciarConexao('esc-1', {})).rejects.toThrow(/libera 2 chips/);
  });

  it('escola bloqueada não consegue adicionar chip', async () => {
    const { service } = montar({ blocked: true });
    await expect(service.iniciarConexao('esc-1', {})).rejects.toThrow(BadRequestException);
  });

  it('reconectar um chip existente não cria outro', async () => {
    const { uazapi, service, chips } = montar();
    await service.iniciarConexao('esc-1', {});
    await service.iniciarConexao('esc-1', { instanciaId: chips[0].id });
    expect(uazapi.criadas).toHaveLength(1);
  });

  it('ao conectar, número e perfil ficam gravados no chip', async () => {
    const { uazapi, service, chips } = montar();
    await service.iniciarConexao('esc-1', {});
    uazapi.estado = { status: 'connected', conectado: true, numero: '5581999990000', perfil: 'Escola' };
    const r = await service.status('esc-1', chips[0].id);

    expect(r.chip.conectado).toBe(true);
    expect(r.chip.numero).toBe('5581999990000');
    expect(chips[0].connectedAt).toBeInstanceOf(Date);
  });

  it('envio usa só chip conectado, e roda entre eles', async () => {
    const { service, chips } = montar({ maxInstances: 2 });
    await service.iniciarConexao('esc-1', {});
    await service.iniciarConexao('esc-1', {});
    expect(await service.paraEnvio('esc-1')).toBeNull(); // nenhum conectado ainda

    chips[0].status = 'connected';
    chips[1].status = 'connected';
    const primeiro = await service.paraEnvio('esc-1');
    expect(primeiro!.id).toBe(chips[0].id);

    await service.registrarUso(chips[0].id);
    const segundo = await service.paraEnvio('esc-1');
    expect(segundo!.id).toBe(chips[1].id);
  });

  it('chip de outra escola não é alcançável', async () => {
    const { service, chips } = montar();
    await service.iniciarConexao('esc-1', {});
    await expect(service.status('esc-2', chips[0].id)).rejects.toThrow(/não encontrado/);
  });
});
