import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { InstanciasService } from './instancias.service';
import { ProvedoresService } from './provedores.service';
import { UazapiAdminService } from './uazapi.admin';

@Module({
  imports: [PrismaModule],
  providers: [ProvedoresService, UazapiAdminService, InstanciasService],
  exports: [ProvedoresService, UazapiAdminService, InstanciasService],
})
export class ProvedoresModule {}
