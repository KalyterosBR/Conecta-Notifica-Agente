# Publicar o Conecta Notifica

São três processos (API, worker e painel) mais Postgres e Redis. O worker é
quem tira da fila e dispara o WhatsApp: sem ele, os giros entram no banco e
nenhuma mensagem sai. Qualquer plataforma escolhida precisa rodar os três.

| Cenário da VPS | Caminho |
|---|---|
| **Com Traefik já rodando** (é o caso hoje) | [`docker compose` + labels](#vps-atras-do-traefik-que-ja-existe) — entra atrás do proxy existente. **É o caminho padrão.** |
| Com Easypanel instalado | [serviços no Easypanel](#servicos-no-easypanel) |
| Sem Docker, à moda antiga | [alternativo-vps-nginx/](alternativo-vps-nginx/) (nginx + systemd + certbot) |

DNS já criado: `notifica.conectapontoeacesso.com.br` → `72.61.221.172`
(reaponte se o servidor novo tiver outro IP).

---

## VPS (atrás do Traefik que já existe)

A VPS `72.61.221.172` roda o Docker Manager da Hostinger: um **Traefik v3**
segura as portas 80/443 e serve outros contêineres (n8n). Nosso stack **não
sobe proxy nenhum** — ele entra atrás desse Traefik, que descobre `api` e `web`
pelas labels do compose e emite o certificado pelo resolver `letsencrypt`.

```sh
git clone git@github.com:DaniloGalmac/conecta-notifica.git /opt/conecta-notifica
cd /opt/conecta-notifica
cp deploy/producao.env.example deploy/producao.env
# preencha DATABASE_URL (Postgres externo), JWT_SECRET (openssl rand -hex 32)
# e confira REDE_TRAEFIK — a rede docker onde o Traefik está:
#   docker inspect traefik-traefik-1 \
#     --format '{{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}'
docker compose -f deploy/docker-compose.prod.yml --env-file deploy/producao.env up -d --build
```

Sobem quatro contêineres: `redis`, `api`, `worker` e `web`. Só `api` e `web`
entram na rede do Traefik; `redis` e `worker` ficam na rede interna, sem porta
publicada. As migrations rodam no start da `api`.

O roteamento é por label: `Host(DOMINIO) && PathPrefix(/api)` vai para a API
com `stripprefix` removendo o `/api` (por isso `API_PREFIX` fica vazio), e
`Host(DOMINIO)` sozinho vai para o painel. Como a regra da API é mais longa, o
Traefik casa ela primeiro.

**O DNS precisa apontar para a VPS antes de subir**: o resolver usa desafio
HTTP, então sem o registro A resolvendo para `72.61.221.172` o Let's Encrypt
não emite o certificado e o domínio responde 404.

O domínio de produção é `painel.conectapontoeacesso.com.br`. O nome
`notifica.` foi abandonado: a Hostinger publica A e AAAA próprios para ele
(TTL 60, `server: hcdn`) e termina o TLS, ignorando o registro A do painel —
o desafio do Let's Encrypt nunca chega ao Traefik. O `app.` do mesmo domínio
aponta para o Render sem interferência, o que prova que a zona respeita os
registros e o problema é aquele nome estar preso a um site da hospedagem.

**O Postgres é externo** (Neon), apontado por `DATABASE_URL`. O usuário do
banco precisa de permissão de `CREATE` no schema, porque o Prisma cria as
tabelas na primeira subida. No Neon, use o endpoint **direto** (sem `-pooler`):
o pooler é PgBouncer em modo transaction, onde o `prisma migrate` não roda e o
runtime exigiria `?pgbouncer=true`.

```sh
docker compose -f deploy/docker-compose.prod.yml logs -f api worker
docker compose -f deploy/docker-compose.prod.yml ps
```

Atualizar depois de um `git push`:

```sh
cd /opt/conecta-notifica && git pull
docker compose -f deploy/docker-compose.prod.yml --env-file deploy/producao.env up -d --build
```

Backup do banco — como ele é externo, o dump sai de um contêiner cliente
usando a mesma `DATABASE_URL`:

```sh
set -a; . /opt/conecta-notifica/deploy/producao.env; set +a
docker run --rm postgres:16-alpine \
  pg_dump "$DATABASE_URL" | gzip > /root/notifica-$(date +%F).sql.gz
```

Criar o operador interno (entra em `/admin`, imprime a senha uma única vez):

```sh
docker compose -f deploy/docker-compose.prod.yml exec api \
  npx ts-node scripts/criar-admin.ts "Seu Nome" voce@empresa.com.br
```

Daí em diante as escolas são criadas pela tela de admin. Pelo terminal também
dá (imprime senha do painel e API key **uma única vez**):

```sh
docker compose -f deploy/docker-compose.prod.yml exec api \
  npx ts-node scripts/criar-escola.ts "Nome da Escola" direcao@escola.com.br
```

---

## Serviços no Easypanel

Se a VPS voltar a ter **Easypanel** (Traefik + Docker nas portas 80/443), não
instale nginx: o deploy é o Easypanel puxando este repositório e buildando os
Dockerfiles.

```
                    ┌─ Traefik (Easypanel, 443, TLS automático) ─┐
notifica.conecta…   │  /      → web    :3000  (Next.js)          │
                    │  /api   → api    :3001  (NestJS)           │
                    └────────────────────────────────────────────┘
                          worker (mesma imagem da api)
                          postgres          redis
```

### 1. Repositório

O Easypanel precisa do repositório no GitHub (ou GitLab). Depois de criar o
remoto:

```sh
git remote add origin git@github.com:SEU-USUARIO/conecta-notifica.git
git push -u origin main
```

Sendo privado, autorize o Easypanel na conta do GitHub (ele oferece o botão de
conectar) ou cadastre a deploy key que ele gera.

### 2. Os serviços

Crie o projeto **conecta-notifica** e, dentro dele, quatro serviços.

#### postgres (template Postgres)

Nome do serviço `db`. Anote a senha; a URL interna fica
`postgres://postgres:SENHA@conecta-notifica_db:5432/postgres`.

#### redis (template Redis)

Nome do serviço `redis` → `redis://conecta-notifica_redis:6379`.
Sem Redis o worker não sobe e nenhuma mensagem sai.

#### api (App)

| Campo | Valor |
|---|---|
| Source | GitHub → este repositório, branch `main` |
| Build | Dockerfile — path `apps/api/Dockerfile`, **contexto `/`** (raiz) |
| Porta | `3001` |
| Domínio | `notifica.conectapontoeacesso.com.br`, path `/api` |

Variáveis de ambiente:

```
DATABASE_URL=postgres://postgres:SENHA@conecta-notifica_db:5432/postgres
REDIS_URL=redis://conecta-notifica_redis:6379
PORT=3001
JWT_SECRET=<openssl rand -hex 32>
CORS_ORIGIN=https://notifica.conectapontoeacesso.com.br
API_PREFIX=api
```

> `API_PREFIX=api` existe porque o Traefik encaminha `/api/...` **sem** remover
> o prefixo: as rotas passam a atender em `/api/v1/...`. Se você marcar um
> *strip path* no domínio, deixe a variável vazia. Testa-se em um comando:
> `curl -o /dev/null -w '%{http_code}' https://notifica.…/api/v1/painel/visao-geral`
> → **401** é o certo (rota existe, faltou token). **404** = a variável está
> no estado errado.

O container roda `prisma migrate deploy` antes de subir, então o banco se cria
sozinho no primeiro deploy.

#### worker (App)

Mesma fonte e mesmo Dockerfile da `api`, **sem domínio e sem porta**. Só muda:

- Comando: `node dist/worker.js`
- Mesmas variáveis de ambiente da `api`

É quem consome a fila e dispara o WhatsApp.

#### web (App)

| Campo | Valor |
|---|---|
| Build | Dockerfile — path `apps/web/Dockerfile`, **contexto `/`** (raiz) |
| Porta | `3000` |
| Domínio | `notifica.conectapontoeacesso.com.br`, path `/` |

Sem variáveis: o painel chama `/api` no mesmo domínio (embutido no build).

O TLS é emitido pelo próprio Easypanel ao salvar o domínio.

### 3. Primeira escola real

No terminal do serviço `api` dentro do Easypanel:

```sh
npm run criar-escola -- "Nome da Escola" direcao@escola.com.br
```

Imprime **uma única vez**: senha do painel, API key do agente e o caminho do
webhook da UAZAPI. Guarde na hora.

No `C:\ConectaNotifica\config.yaml` da escola:

```yaml
saas:
  base_url: "https://notifica.conectapontoeacesso.com.br/api"
  api_key: "cn_..."
```

Essa URL é fixa: não muda mais a cada teste, ao contrário do túnel antigo.

### 4. Conferir que está de pé

```sh
curl -o /dev/null -w '%{http_code}\n' https://notifica.conectapontoeacesso.com.br/api/v1/painel/visao-geral   # 401
curl -o /dev/null -w '%{http_code}\n' https://notifica.conectapontoeacesso.com.br/login                       # 200
```

Depois, no painel: **Configurações → WhatsApp** para conectar a instância
UAZAPI, e o webhook de status apontando para
`https://notifica.conectapontoeacesso.com.br/api/v1/webhooks/uazapi/<token>`.

## Atualizações

`git push` na `main` → *Deploy* no serviço (ou webhook de auto-deploy do
Easypanel). API e worker precisam ser deployados juntos: são a mesma imagem.

## Segurança — conferir no servidor novo

Na VPS antiga a porta **5432 estava aberta para a internet** e o painel do
Easypanel respondia na **3000** pública. No servidor novo, deixe expostas
apenas 22, 80 e 443:

```sh
ufw allow OpenSSH && ufw allow 80,443/tcp && ufw --force enable
ss -tlnp                      # confira quem sobrou escutando
```

O `docker-compose.prod.yml` já não publica porta de banco nem de Redis.

## Alternativa sem Docker

Se um dia a VPS deixar de usar Easypanel, os arquivos em
[alternativo-vps-nginx/](alternativo-vps-nginx/) publicam do jeito clássico
(nginx + systemd + Let's Encrypt): `preparar-vps.sh` e `publicar.sh`. **Não
rode nesta VPS enquanto o Easypanel estiver no ar** — os scripts abortam
sozinhos se detectarem outro servidor na 80/443.
