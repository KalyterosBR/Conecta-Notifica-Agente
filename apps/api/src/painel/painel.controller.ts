import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ContextoUsuario, PainelGuard } from '../auth/painel.guard';
import { AlunosPainelService } from './alunos-painel.service';
import { ConfiguracoesService } from './configuracoes.service';
import {
  AtualizarRegrasDto,
  AtualizarResponsavelDto,
  AtualizarVinculoDto,
  ConectarWhatsappDto,
  DesconectarChipDto,
  IniciarConexaoDto,
  CriarResponsavelDto,
  FiltroAlunosDto,
  FiltroEnviosDto,
  FiltroRelatorioDto,
  FiltroResponsaveisDto,
  ImportarResponsaveisDto,
  SalvarModeloDto,
  VincularDto,
} from './dto';
import { EnviosService } from './envios.service';
import { ModelosService } from './modelos.service';
import { OnboardingService } from './onboarding.service';
import { RelatoriosService } from './relatorios.service';
import { ResponsaveisService } from './responsaveis.service';
import { VisaoGeralService } from './visao-geral.service';

type Req_ = { usuario: ContextoUsuario };

/** API do painel da escola (telas do doc §4, recorte do MVP). */
@Controller('v1/painel')
@UseGuards(PainelGuard)
export class PainelController {
  constructor(
    private readonly visaoGeral: VisaoGeralService,
    private readonly alunos: AlunosPainelService,
    private readonly responsaveis: ResponsaveisService,
    private readonly envios: EnviosService,
    private readonly configuracoes: ConfiguracoesService,
    private readonly modelos: ModelosService,
    private readonly relatorios_: RelatoriosService,
    private readonly onboarding_: OnboardingService,
  ) {}

  // -- Visão geral -----------------------------------------------------------
  @Get('visao-geral')
  resumo(@Req() req: Req_) {
    return this.visaoGeral.resumo(req.usuario);
  }

  // -- Alunos ---------------------------------------------------------------
  @Get('alunos')
  listarAlunos(@Req() req: Req_, @Query() f: FiltroAlunosDto) {
    return this.alunos.listar(req.usuario, f);
  }

  @Get('alunos/:id')
  detalheAluno(@Req() req: Req_, @Param('id') id: string) {
    return this.alunos.detalhe(req.usuario, id);
  }

  @Patch('alunos/:alunoId/responsaveis/:id')
  atualizarVinculo(
    @Req() req: Req_,
    @Param('alunoId') alunoId: string,
    @Param('id') id: string,
    @Body() dto: AtualizarVinculoDto,
  ) {
    return this.responsaveis.atualizarVinculo(req.usuario, alunoId, id, dto);
  }

  // -- Onboarding ------------------------------------------------------------
  @Get('onboarding')
  onboarding(@Req() req: Req_) {
    return this.onboarding_.estado(req.usuario);
  }

  // -- Relatórios ------------------------------------------------------------
  @Get('relatorios')
  relatorios(@Req() req: Req_, @Query() f: FiltroRelatorioDto) {
    return this.relatorios_.consolidado(req.usuario, f);
  }

  // -- Responsáveis ----------------------------------------------------------
  @Get('responsaveis')
  listarResponsaveis(@Req() req: Req_, @Query() f: FiltroResponsaveisDto) {
    return this.responsaveis.listar(req.usuario, f);
  }

  @Post('responsaveis/importar')
  @HttpCode(200)
  importarResponsaveis(@Req() req: Req_, @Body() dto: ImportarResponsaveisDto) {
    return this.responsaveis.importar(req.usuario, dto);
  }

  @Post('responsaveis/:id/alunos')
  @HttpCode(200)
  vincularAluno(@Req() req: Req_, @Param('id') id: string, @Body() dto: VincularDto) {
    return this.responsaveis.vincular(req.usuario, id, dto);
  }

  @Delete('responsaveis/:id/alunos/:alunoId')
  @HttpCode(200)
  desvincularAluno(
    @Req() req: Req_,
    @Param('id') id: string,
    @Param('alunoId') alunoId: string,
  ) {
    return this.responsaveis.desvincular(req.usuario, id, alunoId);
  }

  @Post('responsaveis')
  criarResponsavel(@Req() req: Req_, @Body() dto: CriarResponsavelDto) {
    return this.responsaveis.criar(req.usuario, dto);
  }

  @Patch('responsaveis/:id')
  atualizarResponsavel(
    @Req() req: Req_,
    @Param('id') id: string,
    @Body() dto: AtualizarResponsavelDto,
  ) {
    return this.responsaveis.atualizar(req.usuario, id, dto);
  }

  // -- Envios ----------------------------------------------------------------
  @Get('envios')
  listarEnvios(@Req() req: Req_, @Query() f: FiltroEnviosDto) {
    return this.envios.listar(req.usuario, f);
  }

  @Post('envios/:id/reenviar')
  @HttpCode(200)
  reenviar(@Req() req: Req_, @Param('id') id: string) {
    return this.envios.reenviar(req.usuario, id);
  }

  // -- Modelos de mensagem ---------------------------------------------------
  @Get('modelos')
  listarModelos(@Req() req: Req_) {
    return this.modelos.listar(req.usuario);
  }

  @Put('modelos/:tipo')
  salvarModelo(@Req() req: Req_, @Param('tipo') tipo: string, @Body() dto: SalvarModeloDto) {
    return this.modelos.salvar(req.usuario, tipo, dto);
  }

  /** Volta ao texto padrão do sistema (apaga o modelo da escola). */
  @Delete('modelos/:tipo')
  restaurarModelo(@Req() req: Req_, @Param('tipo') tipo: string) {
    return this.modelos.restaurar(req.usuario, tipo);
  }

  // -- Configurações ---------------------------------------------------------
  @Get('configuracoes')
  configuracao(@Req() req: Req_) {
    return this.configuracoes.obter(req.usuario);
  }

  @Patch('configuracoes/regras')
  atualizarRegras(@Req() req: Req_, @Body() dto: AtualizarRegrasDto) {
    return this.configuracoes.atualizarRegras(req.usuario, dto);
  }

  @Post('configuracoes/whatsapp')
  @HttpCode(200)
  conectarWhatsapp(@Req() req: Req_, @Body() dto: ConectarWhatsappDto) {
    return this.configuracoes.conectarWhatsapp(req.usuario, dto);
  }

  // Onboarding por QR code: a escola conecta o próprio número sem ver token.
  @Post('configuracoes/whatsapp/conectar')
  @HttpCode(200)
  iniciarConexaoWhatsapp(@Req() req: Req_, @Body() dto: IniciarConexaoDto) {
    return this.configuracoes.iniciarConexaoWhatsapp(req.usuario, dto);
  }

  @Get('configuracoes/whatsapp/status')
  statusWhatsapp(@Req() req: Req_, @Query('instancia_id') instanciaId?: string) {
    return this.configuracoes.statusWhatsapp(req.usuario, instanciaId);
  }

  @Post('configuracoes/whatsapp/desconectar')
  @HttpCode(200)
  desconectarWhatsapp(@Req() req: Req_, @Body() dto: DesconectarChipDto) {
    return this.configuracoes.desconectarWhatsapp(req.usuario, dto.instancia_id);
  }

  @Post('configuracoes/agente/regenerar-chave')
  @HttpCode(200)
  regenerarChave(@Req() req: Req_) {
    return this.configuracoes.regenerarChaveAgente(req.usuario);
  }
}
