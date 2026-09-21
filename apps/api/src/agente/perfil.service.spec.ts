import { PerfilAgenteService } from './perfil.service';

describe('PerfilAgenteService', () => {
  it('devolve somente a identidade e a saúde segura da escola da própria chave', async () => {
    const findUnique = jest.fn().mockResolvedValue({
      id: 'esc-1', name: 'Escola Horizonte', timezone: 'America/Sao_Paulo',
      blocked: false, instances: [{ id: 'chip-1' }],
    });
    const service = new PerfilAgenteService({ school: { findUnique } } as any);

    await expect(service.obter({ schoolId: 'esc-1', apiKeyId: 'key-1' })).resolves.toEqual({
      school_id: 'esc-1', school_name: 'Escola Horizonte', timezone: 'America/Sao_Paulo',
      blocked: false, whatsapp_connected: true,
    });
    expect(findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'esc-1' } }));
  });
});
