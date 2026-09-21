# Conecta Notifica

SaaS que avisa o responsável no WhatsApp quando o aluno entra ou sai da escola,
lendo os giros da catraca direto do SQL Server local.

```
Escola (Windows)                        VPS
┌────────────────────┐   HTTPS   ┌──────────────────────────┐
│ SQL Server da      │  eventos  │ API (NestJS) + worker    │──▶ UAZAPI ──▶ WhatsApp
│ catraca            │  em lote  │ Postgres · Redis/BullMQ  │      do responsável
│   ▲ polling        │ ────────▶ │ Painel (Next.js)         │
│ Agente (Go, svc)   │           └──────────────────────────┘
└────────────────────┘
```

| Pasta | O que é |
|---|---|
| [apps/api](apps/api) | API NestJS: recepção dos eventos, regras de envio, filas, provedores de WhatsApp, API do painel |
| [apps/web](apps/web) | Painel da escola em Next.js |
| [apps/agent](apps/agent) | Agente Go que roda como serviço Windows dentro da escola |
| [deploy](deploy) | Publicação na VPS: nginx, systemd e scripts |
| [files/conecta-notifica.md](files/conecta-notifica.md) | Documento do produto: visão, modelo de dados, telas, tema |

## Rodar em desenvolvimento

```sh
cd apps/api && npm install && npx prisma migrate dev && npx ts-node prisma/seed.ts
cd apps/api && npm run db:dev      # terminal 1 — Postgres embutido :5433
cd apps/api && npm run start:dev   # terminal 2 — API :3001
cd apps/web && npm install && npm run dev   # terminal 3 — painel :3000
```

O seed imprime o login do painel e a API key do agente. Detalhes em
[apps/api/README.md](apps/api/README.md) e [apps/agent/README.md](apps/agent/README.md).

## Publicar

A VPS roda Easypanel: o deploy é ele puxando este repositório e buildando os
Dockerfiles de [apps/api](apps/api/Dockerfile) e [apps/web](apps/web/Dockerfile).
Passo a passo dos serviços, variáveis e da primeira escola:
[deploy/LEIA-ME.md](deploy/LEIA-ME.md).

## Testes

```sh
cd apps/api && npm test     # services da API
cd apps/agent && go test ./...
```

## Segredos

Nada de credencial no repositório. Em produção os segredos ficam em
`/opt/conecta-notifica/api.env`, gerados na própria VPS; em desenvolvimento,
em `apps/api/.env` (fora do git, veja `.env.example`).
