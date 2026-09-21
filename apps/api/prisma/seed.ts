// Cria uma escola de demonstração com API key para fechar o ciclo com o
// agente em dev: npx ts-node prisma/seed.ts
import { PrismaClient } from '@prisma/client';
import { createHash, randomBytes } from 'node:crypto';
import { gerarHashSenha } from '../src/auth/senha';

const prisma = new PrismaClient();

async function main() {
  const chave = 'cn_' + randomBytes(24).toString('hex');
  const webhookToken = randomBytes(16).toString('hex');
  const escola = await prisma.school.create({
    data: {
      name: 'Escola Demo',
      // Preencha uazapi.base_url e uazapi.token ao conectar o WhatsApp.
      providerConfig: { provider: 'uazapi', webhook_token: webhookToken },
      settings: { create: {} },
      // Sem linha em message_templates a escola usa o TEMPLATE_PADRAO do
      // sistema; a tela de Modelos só grava quando a escola personaliza.
      apiKeys: {
        create: { keyHash: createHash('sha256').update(chave).digest('hex') },
      },
    },
  });
  await prisma.user.create({
    data: {
      schoolId: escola.id,
      name: 'Direção Demo',
      email: 'direcao@escolademo.dev',
      passwordHash: gerarHashSenha('demo1234'),
    },
  });
  console.log('escola criada:', escola.id);
  console.log('login do painel: direcao@escolademo.dev / demo1234');
  console.log('API key do agente (guarde, não é mostrada de novo):');
  console.log(' ', chave);
  console.log('webhook de status da UAZAPI:');
  console.log('  POST /v1/webhooks/uazapi/' + webhookToken);
}

main().finally(() => prisma.$disconnect());
