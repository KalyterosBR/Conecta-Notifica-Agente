import { Module } from '@nestjs/common';
import { ProvedoresModule } from '../provedores/provedores.module';
import { NotificadorService } from './notificador.service';

@Module({
  imports: [ProvedoresModule],
  providers: [NotificadorService],
  exports: [NotificadorService],
})
export class NotificacoesModule {}
