import { Module } from '@nestjs/common';
import { AdminModule } from './admin/admin.module';
import { AgenteModule } from './agente/agente.module';
import { AuthModule } from './auth/auth.module';
import { PainelModule } from './painel/painel.module';
import { MonitoramentoModule } from './monitoramento/monitoramento.module';
import { NotificacoesModule } from './notificacoes/notificacoes.module';
import { WebhooksModule } from './webhooks/webhooks.module';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [
    PrismaModule,
    AuthModule,
    PainelModule,
    AdminModule,
    AgenteModule,
    NotificacoesModule,
    MonitoramentoModule,
    WebhooksModule,
  ],
})
export class AppModule {}
