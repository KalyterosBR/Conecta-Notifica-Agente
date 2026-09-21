import { Body, Controller, HttpCode, Param, Post } from '@nestjs/common';
import { WebhooksService } from './webhooks.service';

@Controller('v1/webhooks')
export class WebhooksController {
  constructor(private readonly service: WebhooksService) {}

  /** Callback de status da UAZAPI. O token é gerado por escola no onboarding. */
  @Post('uazapi/:token')
  @HttpCode(200)
  uazapi(@Param('token') token: string, @Body() corpo: unknown) {
    return this.service.processarUazapi(token, corpo);
  }
}
