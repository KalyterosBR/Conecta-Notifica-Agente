import { Module } from '@nestjs/common';
import { AlertasCanal } from './alertas.canal';
import { MonitoramentoService } from './monitoramento.service';

@Module({
  providers: [AlertasCanal, MonitoramentoService],
  exports: [MonitoramentoService],
})
export class MonitoramentoModule {}
