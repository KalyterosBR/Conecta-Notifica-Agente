// Postgres embutido para desenvolvimento — sem Docker nem instalação global.
// npm run db:dev   (fica rodando; Ctrl+C encerra)
const EmbeddedPostgres = require('embedded-postgres').default ?? require('embedded-postgres');
const { existsSync, mkdirSync } = require('node:fs');
const { join } = require('node:path');

const dir = join(__dirname, '..', '.devdb');
mkdirSync(dir, { recursive: true });

async function main() {
  const pg = new EmbeddedPostgres({
    databaseDir: dir,
    user: 'conecta',
    password: 'conecta',
    port: 5433,
    persistent: true,
  });

  const primeiraVez = !existsSync(join(dir, 'PG_VERSION'));
  if (primeiraVez) {
    console.log('inicializando banco de dev em', dir);
    await pg.initialise();
  }
  await pg.start();
  if (primeiraVez) {
    await pg.createDatabase('conecta_notifica');
  }
  console.log('postgres de dev pronto em localhost:5433 (db conecta_notifica)');
  console.log('Ctrl+C para encerrar');

  const parar = async () => {
    await pg.stop();
    process.exit(0);
  };
  process.on('SIGINT', parar);
  process.on('SIGTERM', parar);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
