// Cria uma escola no banco oficial, com usuário do painel e API key do agente.
// Uso:
//   DATABASE_URL="postgresql://..." npx ts-node scripts/criar-escola.ts \
//       "Nome da Escola" direcao@escola.com.br
// A senha e a API key são geradas e mostradas UMA ÚNICA VEZ.
import { PrismaClient } from '@prisma/client';
import { createHash, randomBytes } from 'node:crypto';
import { gerarHashSenha } from '../src/auth/senha';

const prisma = new PrismaClient();

async function main() {
  const [nome, email] = process.argv.slice(2);
  if (!nome || !email) {
    console.error('uso: criar-escola.ts "Nome da Escola" email@dominio.com.br');
    process.exit(1);
  }

  const senha = randomBytes(6).toString('base64url');
  const apiKey = 'cn_' + randomBytes(24).toString('hex');
  const webhookToken = randomBytes(16).toString('hex');

  const escola = await prisma.school.create({
    data: {
      name: nome,
      providerConfig: { provider: 'uazapi', webhook_token: webhookToken },
      settings: { create: {} },
      // Sem linha em message_templates a escola usa o TEMPLATE_PADRAO do
      // sistema; a tela de Modelos só grava quando a escola personaliza.
      apiKeys: {
        create: { keyHash: createHash('sha256').update(apiKey).digest('hex') },
      },
      users: {
        create: {
          name: 'Direção',
          email,
          passwordHash: gerarHashSenha(senha),
        },
      },
    },
  });

  console.log('\n=========================================================');
  console.log(' ESCOLA CRIADA — guarde estes dados, não aparecem de novo');
  console.log('=========================================================');
  console.log(' Escola .......:', escola.name);
  console.log(' School ID ....:', escola.id);
  console.log('');
  console.log(' PAINEL');
  console.log('   e-mail .....:', email);
  console.log('   senha ......:', senha);
  console.log('');
  console.log(' AGENTE (config.yaml da escola)');
  console.log('   api_key ....:', apiKey);
  console.log('');
  console.log(' WEBHOOK UAZAPI');
  console.log('   caminho ....: /v1/webhooks/uazapi/' + webhookToken);
  console.log('=========================================================\n');
}

main()
  .catch((e) => {
    console.error('erro:', e.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
