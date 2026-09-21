import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import 'reflect-metadata';
import { AppModule } from './app.module';

async function bootstrap() {
  // Em produção o painel e a API ficam no mesmo host (/ e /api), então
  // CORS_ORIGIN pode até ficar vazio; sem a variável, libera geral — que é o
  // que dev precisa (painel em :3000 chamando :3001).
  const origens = process.env.CORS_ORIGIN?.split(',').map((o) => o.trim()).filter(Boolean);
  const app = await NestFactory.create(AppModule, {
    cors: { origin: origens?.length ? origens : true },
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      // Payload malformado deve virar 400 (o agente descarta e segue),
      // nunca 500 (o agente reenvia para sempre).
      stopAtFirstError: true,
    }),
  );
  // Lotes de até 200 eventos passam folgados em 1 MB.
  app.use(require('express').json({ limit: '1mb' }));
  // Atrás de um proxy que encaminha /api/... sem remover o prefixo (Traefik
  // sem StripPrefix), API_PREFIX=api faz as rotas atenderem em /api/v1/...
  // Se o proxy já remove o prefixo, deixe a variável vazia.
  if (process.env.API_PREFIX) app.setGlobalPrefix(process.env.API_PREFIX);
  await app.listen(Number(process.env.PORT ?? 3001));
}
bootstrap();
