# Criar o banco oficial do Conecta Notifica

Dois arquivos, nesta ordem. Testados: aplicados num Postgres limpo, o
Prisma reconhece o banco como migrado e as travas de idempotência
(evento e mensagem duplicados) funcionam.

## 1. No servidor, como superusuário — uma vez

Troque a senha dentro do arquivo antes de rodar.

```sh
psql -h SEU_HOST -U postgres -f 01-servidor.sql
```

Cria o role `conecta_app` e o database `conecta_notifica`.

## 2. No banco novo, como conecta_app

```sh
psql -h SEU_HOST -U conecta_app -d conecta_notifica -f 02-schema.sql
```

Cria os 2 enums, as 10 tabelas, chaves e índices — e registra a migration
na tabela `_prisma_migrations`, para um futuro `prisma migrate deploy`
enxergar o banco como já migrado em vez de tentar recriar tudo.

## 3. Apontar a aplicação

No `.env` da API:

```
DATABASE_URL="postgresql://conecta_app:SUA-SENHA@SEU_HOST:5432/conecta_notifica"
JWT_SECRET="uma-chave-longa-e-aleatoria"
```

Conferir: `npx prisma migrate status` → *Database schema is up to date!*

## 4. Criar a primeira escola

```sh
npm run criar-escola -- "Nome da Escola" direcao@escola.com.br
```

Imprime, uma única vez: senha do painel, API key do agente e o caminho do
webhook da UAZAPI. A API key é o que vai no `config.yaml` do agente.

## Daqui em diante

Mudanças no schema **não** se fazem por SQL manual: altere
`prisma/schema.prisma`, gere a migration em dev (`npx prisma migrate dev`)
e aplique no servidor com `npm run migrate:deploy`.
