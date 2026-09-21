// Cria (ou atualiza) um operador interno: usuário sem escola vinculada, que é
// quem enxerga o back-office em /admin.
//   DATABASE_URL="postgresql://..." npx ts-node scripts/criar-admin.ts \
//       "Danilo" danilo@empresa.com.br
// A senha é gerada e mostrada UMA ÚNICA VEZ.
import { PrismaClient } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { gerarHashSenha } from '../src/auth/senha';

const prisma = new PrismaClient();

async function main() {
  const [nome, email] = process.argv.slice(2);
  if (!nome || !email) {
    console.error('uso: criar-admin.ts "Nome" email@dominio.com.br');
    process.exit(1);
  }
  const senha = randomBytes(6).toString('base64url');
  const usuario = await prisma.user.upsert({
    where: { email },
    create: { name: nome, email, role: 'admin', schoolId: null, passwordHash: gerarHashSenha(senha) },
    update: { name: nome, role: 'admin', schoolId: null, passwordHash: gerarHashSenha(senha) },
  });

  console.log('\n=========================================================');
  console.log(' ADMIN INTERNO — guarde a senha, não aparece de novo');
  console.log('=========================================================');
  console.log(' nome ....:', usuario.name);
  console.log(' e-mail ..:', email);
  console.log(' senha ...:', senha);
  console.log(' entra em : /admin');
  console.log('=========================================================\n');
}

main()
  .catch((e) => {
    console.error('erro:', e.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
