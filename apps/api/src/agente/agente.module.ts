import { Module } from '@nestjs/common';
import { FilasModule } from '../filas/filas.module';
import { AgenteController } from './agente.controller';
import { AlunosService } from './alunos.service';
import { EventosService } from './eventos.service';
import { HeartbeatService } from './heartbeat.service';
import { PerfilAgenteService } from './perfil.service';

@Module({
  imports: [FilasModule],
  controllers: [AgenteController],
  providers: [EventosService, AlunosService, HeartbeatService, PerfilAgenteService],
})
export class AgenteModule {}
