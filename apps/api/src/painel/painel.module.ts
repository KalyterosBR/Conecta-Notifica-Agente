import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { FilasModule } from '../filas/filas.module';
import { ProvedoresModule } from '../provedores/provedores.module';
import { AlunosPainelService } from './alunos-painel.service';
import { ConfiguracoesService } from './configuracoes.service';
import { EnviosService } from './envios.service';
import { ModelosService } from './modelos.service';
import { PainelController } from './painel.controller';
import { OnboardingService } from './onboarding.service';
import { RelatoriosService } from './relatorios.service';
import { ResponsaveisService } from './responsaveis.service';
import { VisaoGeralService } from './visao-geral.service';

@Module({
  imports: [AuthModule, FilasModule, ProvedoresModule],
  controllers: [PainelController],
  providers: [
    VisaoGeralService,
    AlunosPainelService,
    ResponsaveisService,
    EnviosService,
    ConfiguracoesService,
    ModelosService,
    RelatoriosService,
    OnboardingService,
  ],
})
export class PainelModule {}
