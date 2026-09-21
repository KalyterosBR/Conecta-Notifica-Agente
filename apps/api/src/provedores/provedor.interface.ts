/**
 * Abstração do canal de WhatsApp (doc §2.2): UAZAPI agora, Cloud API depois.
 * A troca é por configuração do tenant (schools.provider_config), sem tocar
 * no worker.
 */
export interface MessageProvider {
  readonly nome: string;
  /** Envia texto para um telefone E.164 e devolve o id no provedor. */
  enviarTexto(telefoneE164: string, texto: string): Promise<{ id?: string }>;
}

/** Formato do jsonb schools.provider_config. */
export interface ProviderConfig {
  provider?: 'uazapi' | 'cloudapi';
  webhook_token?: string;
  uazapi?: {
    base_url: string;
    token: string;
    /** Preenchidos quando a instância foi criada pelo painel (fluxo do QR). */
    instance_id?: string;
    instance_name?: string;
    /** Número que atendeu ao QR, só para exibição no painel. */
    numero?: string;
    perfil?: string;
  };
}
