# API Conecta Notifica (NestJS)

Recebe os dados do agente instalado na escola, grava com dedupe idempotente e
enfileira as notificações para o worker de WhatsApp (próxima etapa).

## Endpoints do agente

Todos sob `POST /v1/agent/*`, autenticados por `Authorization: Bearer <api_key>`
([chave-api.guard.ts](src/agente/chave-api.guard.ts) — sha256 contra
`agent_api_keys.key_hash`, chave em claro nunca é guardada).

| Endpoint | Faz | Responde |
|---|---|---|
| `/v1/agent/events` | grava `access_events`; o unique `(school_id, external_event_id)` transforma reenvio em `duplicates`; aluno desconhecido é criado como pendente; cada evento aceito vira job na fila `notificacoes` | `{ accepted, duplicates }` |
| `/v1/agent/students/sync` | upsert por `(school_id, external_id)`; com `full: true` desativa quem saiu do cadastro (nunca apaga) preservando pendências `cartao:` | `{ upserted }` |
| `/v1/agent/heartbeat` | atualiza `last_seen_at` + status completo em `agent_api_keys.last_status` | `204` |

Regras herdadas do contrato do agente (ver `apps/agent/README.md`):
- Payload inválido responde **400** (o agente descarta o lote e segue);
  erro interno responde 5xx (o agente mantém na fila e reenvia).
- Evento **nunca** é descartado por falta de cadastro: cartão sem pessoa vira
  aluno `cartao:<n>` pendente de responsável.
- O job da fila usa `jobId = accessEventId`: reprocessar nunca duplica.

## Rodar em dev

```sh
docker compose up -d                # Postgres + Redis (na raiz do repo)
cp .env.example .env
npm install
npx prisma migrate dev --name init  # cria as tabelas
npx ts-node prisma/seed.ts          # escola demo + API key (copie a chave)
npm run start:dev                   # sobe em :3001
```

Fechando o ciclo com o agente Go:

```sh
# apps/agent/config.yaml -> saas.base_url: http://localhost:3001
#                           saas.api_key: <chave do seed>
./bin/notifica-agent testar
```

Sem `REDIS_URL`, a fila vira no-op com aviso — os eventos continuam gravados
em `access_events` e podem ser reprocessados quando o worker existir.

## Testes

`npm test` — services testados sobre um fake em memória do Prisma
([fake-prisma.spec-util.ts](src/agente/fake-prisma.spec-util.ts)) que
reproduz os uniques; não precisa de banco.

## Worker de envio

`npm run worker:dev` (processo separado da API; exige `REDIS_URL`). Consome a
fila `notificacoes` e aplica as regras do doc §2.4 antes de disparar
([notificador.service.ts](src/notificacoes/notificador.service.ts)):

1. fim de semana → só com `notify_weekends`;
2. janela de horário da escola (`window_start`–`window_end`, no fuso dela);
3. dedupe: mesmo aluno + mesma direção dentro de `dedupe_minutes`;
4. opt-in obrigatório do responsável (LGPD) + toggles entrada/saída do vínculo;
5. sem responsável elegível → evento fica como pendência, nada é apagado.

O envio é idempotente em dois níveis: o job usa `jobId = accessEventId` e a
tabela `messages` tem unique `(access_event_id, guardian_id)` — retry de job
pula quem já está `SENT` e reprocessa só as falhas. Rate limit conservador no
worker (20 msg/min por padrão; `WORKER_MAX_POR_JANELA` / `WORKER_JANELA_MS`).

Provedores atrás da interface `MessageProvider`
([provedor.interface.ts](src/provedores/provedor.interface.ts)): a escolha sai
de `schools.provider_config` — `{ "provider": "uazapi", "webhook_token": "...",
"uazapi": { "base_url": "https://xxx.uazapi.com", "token": "..." } }`. Sem
config, as mensagens ficam `FAILED` ("provedor não configurado") e podem ser
reenviadas quando o onboarding do WhatsApp terminar. `CloudApiProvider` entra
depois pela mesma interface.

## Webhook de status

`POST /v1/webhooks/uazapi/:token` — o token por escola vem de
`provider_config.webhook_token` (o seed gera um). Aceita os formatos usuais da
UAZAPI (status texto ou ack numérico, corpo direto ou em `data`), atualiza
`sent → delivered → read / failed` e nunca regride status (um `delivered`
atrasado não sobrescreve `read`).

## API do painel

Login em `POST /v1/auth/login` `{ email, password }` → `{ token, user }`
(JWT 12h; senha com scrypt, sem dependência nativa). Demais rotas exigem
`Authorization: Bearer <token>` ([painel.guard.ts](src/auth/painel.guard.ts)) e
operam sempre no tenant do usuário.

| Rota | Faz |
|---|---|
| `GET /v1/painel/visao-geral` | agente online (heartbeat < 5 min), WhatsApp conectado, métricas do dia no fuso da escola, alunos sem responsável, últimos 10 acessos |
| `GET /v1/painel/alunos?busca=&sem_responsavel=1&pagina=` | lista com flag de pendência |
| `GET /v1/painel/alunos/:id` | detalhe: responsáveis (toggles + opt-in) e histórico com nº de avisos |
| `POST /v1/painel/responsaveis` | cria com `opt_in` datado (LGPD) e vincula a 1+ alunos |
| `PATCH /v1/painel/responsaveis/:id` | edita; `opt_in: false` registra opt-out |
| `PATCH /v1/painel/alunos/:alunoId/responsaveis/:id` | toggles entrada/saída do vínculo |
| `GET /v1/painel/envios?status=&de=&ate=&pagina=` | log de mensagens com erro e tentativas |
| `POST /v1/painel/envios/:id/reenviar` | só `failed`: volta a `queued` e re-enfileira |
| `GET /v1/painel/modelos` | modelos de entrada/saída com `personalizado` (false = texto padrão do sistema), o padrão e as variáveis aceitas |
| `PUT /v1/painel/modelos/:tipo` | `in` ou `out`; recusa variável fora de `{responsavel} {aluno} {hora} {escola}` |
| `DELETE /v1/painel/modelos/:tipo` | restaura o padrão apagando a linha da escola |
| `GET /v1/painel/configuracoes` | regras + agente + WhatsApp (token da instância nunca retorna) |
| `PATCH /v1/painel/configuracoes/regras` | dedupe, janela, fins de semana |
| `POST /v1/painel/configuracoes/whatsapp` | onboarding: conecta a instância UAZAPI, preserva `webhook_token` |
| `POST /v1/painel/configuracoes/agente/regenerar-chave` | revoga a chave atual e devolve a nova (única vez em claro) |

Seed cria o login `direcao@escolademo.dev` / `demo1234`. Env: `JWT_SECRET`
(obrigatório em produção; default só de dev).

Modelos de mensagem: escola sem linha em `message_templates` usa o
`TEMPLATE_PADRAO` do worker — por isso nem o seed nem o `criar-escola` gravam
o texto padrão, e "restaurar padrão" apaga a linha em vez de regravá-la. Assim
uma mudança no padrão do sistema alcança todas as escolas que não editaram.

## Próximas etapas

- [ ] Lista geral de responsáveis + importação por planilha (a tela do painel
      ainda manda cadastrar pela ficha do aluno).
- [ ] Relatórios (acessos por dia, entregas por semana, ranking de turmas).
- [ ] Telas de admin interno (lista de escolas, impersonar, planos).
- [ ] `CloudApiProvider` (API oficial) para o plano superior.
- [ ] Convite de opt-in disparado pelo sistema (hoje o texto da tela de Modelos
      é um rascunho que a escola copia à mão).

### Conectar o WhatsApp por QR code

A escola conecta o próprio número pelo painel, sem ver token nenhum. A API usa
a conta UAZAPI do SaaS (`UAZAPI_URL` + `UAZAPI_ADMIN_TOKEN`) para criar **uma
instância por escola** na primeira tentativa e guarda o token dela em
`schools.provider_config`.

| Rota | O que faz |
|---|---|
| `POST /v1/painel/configuracoes/whatsapp/conectar` | Cria a instância se ainda não existir e inicia a conexão. Sem corpo devolve `qrcode` (data URI, vale 2 min); com `{"telefone":"+55..."}` devolve `paircode` de 8 dígitos (vale 5 min). |
| `GET /v1/painel/configuracoes/whatsapp/status` | Polling enquanto o código está na tela. Ao conectar, grava número e perfil. |
| `POST /v1/painel/configuracoes/whatsapp/desconectar` | Solta o número; a instância continua existindo para reconectar. |

O webhook de status é apontado sozinho para
`PUBLIC_API_URL/v1/webhooks/uazapi/<webhook_token>`, com os eventos
`messages_update` e `connection`.

O `admintoken` só é exigido para **criar** a instância. Escola que já tem uma
(cadastrada na mão) reconecta pelo QR sem ele, e a chamada vai para o servidor
dela — o `base_url` guardado na config, não o do SaaS. Por isso
`qr_disponivel` é `podeCriarInstancia || escola já tem token`; só quando os
dois são falsos o painel volta ao formulário de `base_url` + `token`.

## Responsáveis

| Rota | O que faz |
|---|---|
| `GET /v1/painel/responsaveis?busca=&sem_opt_in=&pagina=` | Lista da escola, com os alunos de cada um |
| `POST /v1/painel/responsaveis/importar` | Importação em lote (planilha) |
| `POST /v1/painel/responsaveis/:id/alunos` | Vincula a mais um aluno |
| `DELETE /v1/painel/responsaveis/:id/alunos/:alunoId` | Desfaz o vínculo, sem apagar a pessoa |

A importação casa pelo **`external_id` do aluno** — o mesmo código da catraca —,
então a escola exporta a planilha do sistema de matrícula e só acrescenta as
colunas do responsável. Duas decisões que evitam estrago:

- **Telefone repetido na escola é a mesma pessoa.** Um responsável com dois
  filhos vira um cadastro com dois vínculos; duplicar mandaria a mensagem duas
  vezes para o mesmo celular.
- **Linha ruim não derruba a importação.** Cada uma volta com o motivo
  (`aluno X não existe`, `telefone inválido: ...`) e as boas entram. Reimportar
  a planilha corrigida não duplica o que já entrou.

`normalizarTelefone` (`src/painel/util.ts`) aceita o que a secretaria digita —
`(81) 99999-0000`, `81999990000`, `+55 81 99999 0000` — e **recusa** o que não
dá para confiar, como número sem DDD, em vez de gravar algo que nunca receberia.

## Onboarding

`GET /v1/painel/onboarding` devolve os três passos do doc §4 na ordem em que
dependem um do outro: instalar o agente, conectar o WhatsApp, cadastrar os
responsáveis.

**Nenhum passo é marcado por clique** — cada um é deduzido do estado real
(houve heartbeat? existe chip conectado? sobrou aluno sem responsável?), então
recarregar a tela nunca mente sobre o que falta, e o passo não reabre porque
alguém apertou o botão errado.

Duas decisões que evitam passo que fecha ou abre na hora errada:

- **Agente que já falou alguma vez fecha o passo, mesmo offline agora.**
  Reiniciar o serviço na escola não pode reabrir uma etapa vencida.
- **Zero aluno e zero sem responsável não é "tudo pronto"** — é "nada chegou".
  O passo dos responsáveis só fecha com aluno sincronizado.

## Impersonar

`POST /v1/admin/escolas/:id/impersonar` devolve um token de painel daquela
escola, válido por 30 minutos e com a claim `impersonando`. O `sub` continua
sendo o operador, então o que for feito ali é rastreável até quem entrou, e o
painel mostra uma faixa preta em toda tela enquanto a sessão durar.

## Alerta de agente mudo

O risco do doc §2.5: o agente para, a catraca continua girando e ninguém é
avisado — a escola descobre pela reclamação de um pai. O worker varre de
`ALERTA_INTERVALO_MS` em `ALERTA_INTERVALO_MS` (5 min) e avisa quem passou de
`ALERTA_AGENTE_MINUTOS` (20) sem heartbeat.

Quatro decisões que evitam alerta que se aprende a ignorar:

- **Quem nunca bateu está por instalar, não mudo.** Alertar sobre escola
  recém-criada viraria ruído em toda venda nova.
- **Só dentro da janela de funcionamento da escola** (a mesma do envio).
  Agente parado às 3h não é urgência; acordar alguém por isso ensina a
  silenciar o alerta.
- **Uma vez por queda.** `agent_api_keys.alerted_at` marca que o aviso saiu;
  a varredura seguinte não repete.
- **Escola bloqueada não alerta** — o agente parado ali é o esperado.

Quando volta, sai um `agente_voltou` e a marca é limpa, para ninguém caçar um
problema que já se resolveu.

O destino é um **webhook** (`ALERTAS_WEBHOOK_URL`), não e-mail: a VPS já roda
um n8n, e mandar o JSON para lá deixa o canal (e-mail, WhatsApp, Telegram) ser
decidido sem código novo nem senha de SMTP guardada aqui. Sem a variável, o
alerta fica no log e na tela do admin, que lista os mudos em
`GET /v1/admin/agentes-mudos`.

## Back-office interno (`/v1/admin`)

Quem entra é o operador da Conecta: usuário **sem escola vinculada**
(`users.school_id` nulo) e `role = admin`, criado por
`npx ts-node scripts/criar-admin.ts "Nome" email@dominio.com.br`. O
`AdminGuard` recusa qualquer token de escola, mesmo válido.

| Rota | O que faz |
|---|---|
| `GET /v1/admin/resumo` | Escolas, bloqueadas, em atraso, sem nota, mensagens do mês |
| `GET /v1/admin/escolas?busca=` | Lista com uso e saúde de cada cliente |
| `GET /v1/admin/escolas/:id` | Ficha: contrato, chips, usuários, últimas mensagens |
| `POST /v1/admin/escolas` | Cria a escola e devolve senha e API key **uma única vez** |
| `PATCH /v1/admin/escolas/:id` | CNPJ, plano, teto de alunos, teto de chips, observações |
| `POST /v1/admin/escolas/:id/bloqueio` | Liga e desliga o cliente |
| `PATCH /v1/admin/escolas/:id/cobranca` | Status do pagamento e nota fiscal |

### O que o contrato controla, de verdade

- **`max_students`** — o sync do agente atualiza quem já existe, mas para de
  criar aluno novo ao bater o teto e responde `{ upserted, ignorados, limite }`.
  Reduzir o plano nunca apaga quem já estava dentro.
- **`max_instances`** — quantos chips a escola pode conectar por QR code.
  Cada um é uma linha em `whatsapp_instances`, e o envio faz rodízio entre os
  conectados (o parado há mais tempo vai primeiro), que é a defesa do doc §2.5
  contra concentrar volume num número só.
- **`blocked`** — bloqueio comercial. O giro continua sendo gravado e
  aparecendo no painel da escola; o que não sai é o aviso no WhatsApp
  (`NotificadorService` devolve `bloqueado`), e nenhum chip novo pode ser
  conectado. Religar volta a notificar do próximo giro em diante, sem
  reprocessar o passado.

### Financeiro

`billing_status`, `invoice_issued`, `last_invoice_at` e `conta_azul_id` são um
**espelho**: hoje o operador preenche na ficha, e `billing_synced_at` marca
quando foi. Quando a integração com o Conta Azul entrar, é o mesmo
`PATCH .../cobranca` que ela vai alimentar — nada além da origem do dado muda.
