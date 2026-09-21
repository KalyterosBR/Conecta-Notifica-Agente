import { MessageProvider } from './provedor.interface';

/**
 * UAZAPI: uma instância (número) por escola. O token identifica a instância.
 * POST {base_url}/send/text  { number, text }  com header token.
 */
export class UazapiProvider implements MessageProvider {
  readonly nome = 'uazapi';

  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
  ) {}

  async enviarTexto(telefoneE164: string, texto: string): Promise<{ id?: string }> {
    const resp = await fetch(`${this.baseUrl.replace(/\/$/, '')}/send/text`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        token: this.token,
      },
      body: JSON.stringify({
        // UAZAPI espera o número sem o "+".
        number: telefoneE164.replace(/^\+/, ''),
        text: texto,
      }),
      signal: AbortSignal.timeout(20_000),
    });
    const corpo = await resp.text();
    if (!resp.ok) {
      throw new Error(`uazapi ${resp.status}: ${corpo.slice(0, 300)}`);
    }
    try {
      const json = JSON.parse(corpo);
      // O id do envio aparece como id / messageid conforme a versão.
      return { id: json?.id ?? json?.messageid ?? json?.key?.id };
    } catch {
      return {};
    }
  }
}
