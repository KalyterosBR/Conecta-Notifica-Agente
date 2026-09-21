import { BadGatewayException, Injectable, Logger } from '@nestjs/common';

/**
 * Gerência de instâncias na UAZAPI (spec uazapiGO 2.1.1). É o que permite a
 * escola conectar o próprio número pelo painel, lendo um QR code, sem nunca
 * ver um token.
 *
 * Dois níveis de credencial:
 *  - `admintoken` (nosso, da conta UAZAPI) cria instâncias;
 *  - `token` (da instância, um por escola) conecta, consulta e envia.
 *
 * Endpoints usados: POST /instance/create, POST /instance/connect,
 * GET /instance/status, POST /instance/disconnect, POST /webhook.
 */

export type StatusInstancia = 'disconnected' | 'connecting' | 'connected' | 'hibernated';

export interface EstadoInstancia {
  status: StatusInstancia;
  conectado: boolean;
  /** QR em base64, válido por 2 minutos (só enquanto status = connecting). */
  qrcode?: string;
  /** Código de pareamento, alternativa ao QR; vale 5 minutos. */
  paircode?: string;
  /** Número que atendeu ao QR, quando já conectado. */
  numero?: string;
  perfil?: string;
  foto?: string;
}

@Injectable()
export class UazapiAdminService {
  private readonly log = new Logger(UazapiAdminService.name);

  /** URL do servidor UAZAPI da nossa conta (ex.: https://free.uazapi.com). */
  get baseUrl(): string {
    return (process.env.UAZAPI_URL ?? '').replace(/\/$/, '');
  }

  private get adminToken(): string {
    return process.env.UAZAPI_ADMIN_TOKEN ?? '';
  }

  /**
   * Criar instância exige o admintoken da nossa conta. Conectar, consultar e
   * desconectar não — para isso basta o token da instância, que a escola já
   * tem quando alguém cadastrou a URL e o token na mão.
   */
  get podeCriarInstancia(): boolean {
    return !!this.baseUrl && !!this.adminToken;
  }

  /** Cria a instância da escola e devolve o token dela. */
  async criarInstancia(nome: string): Promise<{ token: string; id?: string }> {
    const json = await this.chamar('POST', '/instance/create', { admintoken: this.adminToken }, { name: nome });
    const token = json?.token ?? json?.instance?.token;
    if (!token) {
      throw new BadGatewayException('UAZAPI não devolveu o token da instância');
    }
    return { token, id: json?.instance?.id };
  }

  /**
   * Começa a conexão. Sem `telefone` devolve QR code; com telefone, devolve
   * código de pareamento (para quem não consegue apontar a câmera).
   */
  async conectar(token: string, telefone?: string, servidor?: string): Promise<EstadoInstancia> {
    const corpo = telefone ? { phone: telefone.replace(/\D/g, '') } : {};
    return this.mapear(await this.chamar('POST', '/instance/connect', { token }, corpo, servidor));
  }

  async status(token: string, servidor?: string): Promise<EstadoInstancia> {
    return this.mapear(await this.chamar('GET', '/instance/status', { token }, undefined, servidor));
  }

  async desconectar(token: string, servidor?: string): Promise<void> {
    await this.chamar('POST', '/instance/disconnect', { token }, {}, servidor);
  }

  /**
   * Aponta os eventos da instância para o nosso webhook. `messages_update`
   * alimenta os status de entrega em Envios; `connection` avisa quando o
   * número cai.
   */
  async registrarWebhook(token: string, url: string, servidor?: string): Promise<void> {
    await this.chamar('POST', '/webhook', { token }, {
      enabled: true,
      url,
      events: ['messages_update', 'connection'],
    }, servidor);
  }

  /** Normaliza as duas formas de resposta (connect e status). */
  private mapear(json: any): EstadoInstancia {
    const inst = json?.instance ?? {};
    const st = json?.status ?? json ?? {};
    const status: StatusInstancia = inst.status ?? (st.connected ? 'connected' : 'disconnected');
    return {
      status,
      conectado: status === 'connected' || !!st.connected,
      qrcode: inst.qrcode || undefined,
      paircode: inst.paircode || undefined,
      numero: inst.owner || undefined,
      perfil: inst.profileName || undefined,
      foto: inst.profilePicUrl || undefined,
    };
  }

  private async chamar(
    metodo: 'GET' | 'POST',
    caminho: string,
    cabecalhos: Record<string, string>,
    corpo?: unknown,
    // A escola pode estar numa instância de outro servidor, cadastrada na mão.
    servidor?: string,
  ): Promise<any> {
    const base = (servidor ?? this.baseUrl).replace(/\/$/, '');
    if (!base) {
      throw new BadGatewayException('UAZAPI_URL não configurada na API');
    }
    let resp: Response;
    try {
      resp = await fetch(`${base}${caminho}`, {
        method: metodo,
        headers: { 'Content-Type': 'application/json', ...cabecalhos },
        body: metodo === 'POST' ? JSON.stringify(corpo ?? {}) : undefined,
        signal: AbortSignal.timeout(20_000),
      });
    } catch (e) {
      // Timeout ou DNS: a UAZAPI está fora, não é erro da escola.
      const causa = e instanceof Error ? e.message : String(e);
      this.log.error(`${metodo} ${caminho}: ${causa}`);
      throw new BadGatewayException(`UAZAPI indisponível: ${causa}`);
    }
    const texto = await resp.text();
    if (!resp.ok) {
      this.log.warn(`${metodo} ${caminho} devolveu ${resp.status}: ${texto.slice(0, 200)}`);
      throw new BadGatewayException(`UAZAPI ${resp.status}: ${texto.slice(0, 200)}`);
    }
    try {
      return texto ? JSON.parse(texto) : {};
    } catch {
      return {};
    }
  }
}
