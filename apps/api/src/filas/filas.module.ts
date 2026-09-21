import { Module } from '@nestjs/common';
import { NotificacoesQueue } from './notificacoes.queue';

@Module({
  providers: [NotificacoesQueue],
  exports: [NotificacoesQueue],
})
export class FilasModule {}
