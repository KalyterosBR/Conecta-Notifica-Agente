import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AdminGuard, ContextoAdmin } from './admin.guard';
import { AdminService } from './admin.service';
import { AtualizarEscolaDto, BloquearDto, CobrancaDto, CriarEscolaDto } from './dto';

/** Back-office interno: contratos, limites, bloqueio e financeiro (doc §4). */
@Controller('v1/admin')
@UseGuards(AdminGuard)
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('resumo')
  resumo() {
    return this.admin.resumo();
  }

  @Get('agentes-mudos')
  agentesMudos() {
    return this.admin.agentesMudos();
  }

  @Get('escolas')
  listar(@Query('busca') busca?: string) {
    return this.admin.listar(busca?.trim() || undefined);
  }

  @Get('escolas/:id')
  detalhe(@Param('id') id: string) {
    return this.admin.detalhe(id);
  }

  @Post('escolas')
  @HttpCode(201)
  criar(@Body() dto: CriarEscolaDto) {
    return this.admin.criar(dto);
  }

  @Patch('escolas/:id')
  atualizar(@Param('id') id: string, @Body() dto: AtualizarEscolaDto) {
    return this.admin.atualizar(id, dto);
  }

  @Post('escolas/:id/bloqueio')
  @HttpCode(200)
  bloquear(@Param('id') id: string, @Body() dto: BloquearDto) {
    return this.admin.bloquear(id, dto);
  }

  @Post('escolas/:id/impersonar')
  @HttpCode(200)
  impersonar(@Req() req: { admin: ContextoAdmin }, @Param('id') id: string) {
    return this.admin.impersonar(req.admin.id, id);
  }

  @Patch('escolas/:id/cobranca')
  cobranca(@Param('id') id: string, @Body() dto: CobrancaDto) {
    return this.admin.cobranca(id, dto);
  }
}
