import { Body, Controller, Get, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import { AlunosService } from './alunos.service';
import { ChaveApiGuard, ContextoAgente } from './chave-api.guard';
import { HeartbeatDto, LoteEventosDto, SyncAlunosDto } from './dto';
import { EventosService, ResultadoLote } from './eventos.service';
import { HeartbeatService } from './heartbeat.service';
import { PerfilAgenteService } from './perfil.service';

/** Endpoints consumidos pelo agente Go instalado na escola. */
@Controller('v1/agent')
@UseGuards(ChaveApiGuard)
export class AgenteController {
  constructor(
    private readonly eventos: EventosService,
    private readonly alunos: AlunosService,
    private readonly heartbeat: HeartbeatService,
    private readonly perfil: PerfilAgenteService,
  ) {}

  @Post('events')
  @HttpCode(200)
  receberEventos(
    @Req() req: { agente: ContextoAgente },
    @Body() lote: LoteEventosDto,
  ): Promise<ResultadoLote> {
    return this.eventos.receberLote(req.agente, lote);
  }

  @Get('profile')
  perfilDaEscola(@Req() req: { agente: ContextoAgente }) {
    return this.perfil.obter(req.agente);
  }

  @Post('students/sync')
  @HttpCode(200)
  sincronizarAlunos(
    @Req() req: { agente: ContextoAgente },
    @Body() dto: SyncAlunosDto,
  ) {
    return this.alunos.sincronizar(req.agente, dto);
  }

  @Post('heartbeat')
  @HttpCode(204)
  async baterCoracao(
    @Req() req: { agente: ContextoAgente },
    @Body() hb: HeartbeatDto,
  ): Promise<void> {
    await this.heartbeat.registrar(req.agente, hb);
  }
}
