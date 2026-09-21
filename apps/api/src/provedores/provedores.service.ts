import { Injectable } from '@nestjs/common';
import { MessageProvider, ProviderConfig } from './provedor.interface';
import { UazapiProvider } from './uazapi.provider';

@Injectable()
export class ProvedoresService {
  /**
   * Resolve o provedor do tenant a partir de schools.provider_config.
   * null = escola ainda não conectou o WhatsApp (onboarding incompleto).
   */
  paraEscola(providerConfig: unknown): MessageProvider | null {
    const cfg = (providerConfig ?? {}) as ProviderConfig;
    if (cfg.provider === 'uazapi' && cfg.uazapi?.base_url && cfg.uazapi?.token) {
      return new UazapiProvider(cfg.uazapi.base_url, cfg.uazapi.token);
    }
    return null;
  }
}
