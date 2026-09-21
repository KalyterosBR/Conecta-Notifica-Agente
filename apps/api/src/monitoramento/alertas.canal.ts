import { Injectable, Logger } from '@nestjs/common';

/** Um aviso operacional para quem cuida do serviço, não para a escola. */
export interface Alerta {
  tipo: 'agente_mudo' | 'agente_voltou';
  escola: { id: string; nome: string };
  mensagem: string;
  /** Minutos desde o último heartbeat, quando aplicável. */
  mudo_ha_minutos?: number;
  em: string;
}

/**
 * Para onde o alerta vai. O log sempre acontece; o webhook só quando
 * `ALERTAS_WEBHOOK_URL` está definido.
 *
 * A escolha do webhook em vez de e-mail é deliberada: a VPS já roda um n8n,
 * e mandar o JSON para lá deixa o destino (e-mail, WhatsApp, Telegram) ser
 * decidido sem mexer no código nem guardar senha de SMTP aqui.
 */
@Injectable()
export class AlertasCanal {
  private readonly log = new Logger(AlertasCanal.name);

  private get url(): string | undefined {
    return process.env.ALERTAS_WEBHOOK_URL || undefined;
  }

  get configurado(): boolean {
    return !!this.url;
  }

  async enviar(alerta: Alerta): Promise<void> {
    // O log é o registro que sempre existe, mesmo sem webhook configurado.
    const linha = `[${alerta.tipo}] ${alerta.escola.nome}: ${alerta.mensagem}`;
    if (alerta.tipo === 'agente_mudo') this.log.warn(linha);
    else this.log.log(linha);

    const url = this.url;
    if (!url) return;
    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(alerta),
        signal: AbortSignal.timeout(10_000),
      });
      if (!resp.ok) {
        this.log.warn(`webhook de alerta devolveu ${resp.status}`);
      }
    } catch (e) {
      // Falhar o aviso não pode derrubar a varredura: o alerta continua no
      // log e no painel do admin.
      this.log.warn(`webhook de alerta falhou: ${e instanceof Error ? e.message : e}`);
    }
  }
}
