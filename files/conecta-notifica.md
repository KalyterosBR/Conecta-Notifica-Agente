# Conecta Notifica

SaaS de notificação via WhatsApp para escolas: avisa o responsável quando o aluno entra ou sai da instituição, a partir dos registros de acesso das catracas.

## 1. Visão geral

**Problema:** o software de controle de acesso (revendido por nós) registra entradas e saídas no SQL Server local da escola, mas não comunica os responsáveis.

**Solução:** um agente local lê esses registros e envia para o SaaS, que resolve aluno → responsáveis → telefones e dispara a mensagem no WhatsApp.

**Provedor de WhatsApp:** UAZAPI no início, com abstração para migrar para a API oficial (Cloud API) depois.

**Posicionamento comercial:** upsell natural na venda do software da catraca. Cobrança mensal por escola, em faixas de alunos (até 200, até 500, etc.). A API oficial justifica um plano superior.

## 2. Arquitetura

```
┌──────────────────────────┐        HTTPS        ┌──────────────────────────┐
│  Escola (Windows)        │  ───────────────▶  │  SaaS                    │
│  ┌────────────────────┐  │   eventos em lote   │  API (NestJS)            │
│  │ SQL Server Express │  │   sync de alunos    │  Postgres + Redis/BullMQ │
│  └────────▲───────────┘  │                     │  Worker de envio         │
│           │ polling      │                     │  Painel (Next.js)        │
│  ┌────────┴───────────┐  │                     └────────────┬─────────────┘
│  │ Agente (Go, svc)   │  │                                  │ UAZAPI / Cloud API
│  └────────────────────┘  │                                  ▼
└──────────────────────────┘                         WhatsApp do responsável
```

### 2.1 Agente local (Go)
- Binário único, roda como serviço Windows (`kardianos/service`), conecta no SQL Server com `go-mssqldb`.
- Usuário de banco **somente leitura**.
- Polling a cada 5–10 s na tabela de eventos, incremental por último ID ou timestamp processado.
- Sync periódico da tabela de alunos (ID externo + nome + turma) para o SaaS.
- Buffer local (SQLite ou fila em arquivo) para quando a internet cair; reenvio idempotente.
- Autenticação por API key da escola; envia heartbeat para o painel mostrar "agente online".
- Payload de evento: `{ external_event_id, external_student_id, student_name, direction: "in" | "out", occurred_at }`.
- Alternativa futura: Change Tracking do SQL Server (polling já resolve o MVP).

### 2.2 Backend (NestJS + Postgres + Redis)
- Multi-tenant: cada escola é um tenant.
- Recebe eventos, faz dedupe, resolve responsáveis, monta mensagem pelo template e enfileira.
- Worker consome a fila e dispara via provedor, com rate limit por instância.
- Recebe webhooks do provedor para atualizar status (enviado, entregue, lido, falhou).
- Interface `MessageProvider` com implementações `UazapiProvider` e, depois, `CloudApiProvider`. Troca por configuração do tenant.

### 2.3 Painel (Next.js)
- Painel da escola (produto) e admin interno (tenants, cobrança, impersonar).

### 2.4 Regras de negócio antes do envio
- Dedupe: ignorar o mesmo aluno na mesma direção dentro de N minutos (configurável).
- Janela de horário: não notificar fora do horário definido pela escola.
- Fins de semana e feriados configuráveis.
- Opt-in do responsável obrigatório (LGPD). Sem opt-in, não envia.
- Aluno sem responsável: evento é salvo e aparece como pendência, nunca descartado.

### 2.5 Riscos
- Banimento de número com API não oficial: um número por escola, chip aquecido, rate limit conservador, aviso contratual.
- LGPD: consentimento registrado com data, opção de opt-out, retenção definida.
- Agente offline sem ninguém perceber: heartbeat + alerta no painel e por e-mail.

## 3. Modelo de dados (Postgres)

| Tabela | Campos principais | Observações |
|---|---|---|
| `schools` | id, name, plan, timezone, provider_config (jsonb), created_at | tenant |
| `users` | id, school_id (null = admin), name, email, password_hash, role | usuários do painel |
| `agent_api_keys` | id, school_id, key_hash, label, last_seen_at, revoked_at | heartbeat alimenta `last_seen_at` |
| `students` | id, school_id, external_id, name, class_name, active, synced_at | unique (school_id, external_id) |
| `guardians` | id, school_id, name, phone_e164, relation, opt_in_at, opt_out_at | telefone em E.164 |
| `student_guardians` | student_id, guardian_id, notify_entry, notify_exit, is_primary | N:N |
| `access_events` | id, school_id, student_id, external_event_id, direction, occurred_at, received_at | unique (school_id, external_event_id) |
| `messages` | id, access_event_id, guardian_id, provider, status, provider_message_id, attempts, error, sent_at, delivered_at | status: queued, sent, delivered, read, failed |
| `message_templates` | id, school_id, event_type, body | variáveis `{responsavel}`, `{aluno}`, `{hora}`, `{escola}` |
| `school_settings` | school_id, dedupe_minutes, window_start, window_end, notify_weekends | |

### Vínculo catraca ↔ SaaS
A chave é `students.external_id`. O agente sincroniza alunos automaticamente; a escola só cadastra os responsáveis em cima da lista já preenchida. Evento de aluno desconhecido cria o aluno como "pendente de responsável".

## 4. Telas

### Painel da escola
1. **Login / onboarding** — wizard: instalar agente (mostra API key) → conectar WhatsApp (QR code) → revisar alunos sincronizados.
2. **Visão geral** — status do agente e do WhatsApp, métricas do dia (eventos, enviados, entregues, falhas), alerta de alunos sem responsável, últimos acessos em tempo real.
3. **Alunos** — lista com busca e filtro "sem responsável". Detalhe: dados da catraca (somente leitura), responsáveis com toggles entrada/saída e opt-in, histórico de acessos com quantos avisos saíram.
4. **Responsáveis** — cadastro, vínculo com um ou mais alunos, importação por planilha.
5. **Envios** — log com filtros por data e status, motivo da falha, reenviar.
6. **Modelos** — editor de template por tipo de evento com preview em balão de WhatsApp.
7. **Configurações** — WhatsApp (instância, reconectar), agente (regenerar chave, intervalo), regras (janela, dedupe, fins de semana), usuários.

### Admin
- Lista de escolas (plano, alunos, agente online, WhatsApp conectado, mensagens no mês).
- Detalhe da escola com impersonar.
- Planos e cobrança.

### MVP
Login, onboarding, visão geral, alunos (com responsáveis dentro), envios, configurações. Responsáveis como tela separada e modelos ficam para a segunda rodada.

## 5. Tema visual

Referência: dashboards com cards grandes flutuando, sidebar pintada com cor forte e formas lúdicas, cores de ação em blocos. Mockup em `entrou-mockup.html` (nome antigo).

### Tokens
```
--ink:#1C1F3A  --ink-2:#5B6078  --ink-3:#9094AB
--paper:#F3F1EC  --card:#FFFFFF  --line:#E9E6DF
--brand:#2B3AD8  --brand-deep:#1D2AA8  --brand-soft:#E8EAFB
--sky:#3F8CFF  --sky-soft:#E4EEFF      → agente / entrada-saída
--mint:#2FC28B --mint-soft:#E1F7EE     → WhatsApp / sucesso
--coral:#FF6B4A --coral-soft:#FFE9E3   → atenção / falha
--sun:#FFC53D  --sun-soft:#FFF3D6      → dica / pendência
--radius: 22px (cards), 14px (controles), 32px (shell)
--shadow: 0 14px 40px rgba(28,31,58,.08)
```
- Fontes: Plus Jakarta Sans (títulos e números), Nunito (corpo).
- Sidebar azul-índigo com blobs amarelo, coral e verde no rodapé; item ativo em branco.
- Fundo bege quente, cards brancos com borda 1.5px.
- Linhas de tabela com fundo pastel conforme o estado (verde entregue, coral falha, amarelo pendência).
- Evitar o verde exato do WhatsApp como cor principal.

## 6. Estrutura do repositório

```
conecta-notifica/
├── apps/
│   ├── web/      Next.js — painel da escola + admin
│   ├── api/      NestJS — API, filas, provedores WhatsApp
│   └── agent/    Go — serviço Windows (SQL Server → SaaS)
├── packages/
│   ├── ui/       design system (tokens acima + componentes)
│   └── shared/   tipos e contratos da API
├── docker-compose.yml   Postgres + Redis
└── docs/
```

Stack: Node/TypeScript, NestJS, Prisma ou Drizzle, Postgres, Redis + BullMQ, Next.js, Go.

## 7. Próximos passos

- [ ] Levantar o schema do SQL Server: tabela de alunos e tabela de eventos (ID incremental ou timestamp? direção explícita?).
- [ ] Definir query de polling e payload final do agente.
- [ ] Criar o monorepo e o `apps/web` com as telas mockadas no tema acima.
- [ ] Criar conta e instância na UAZAPI para testes.
- [ ] Definir nome, logo e domínio (Conecta Notifica).

## 8. Pendências e decisões em aberto

- Telefone do responsável não existe no banco da catraca: cadastro fica no SaaS (pode haver mais de um responsável por aluno).
- Como a escola vai coletar o opt-in: no ato da matrícula, por link, ou mensagem inicial de confirmação?
- Dedupe padrão: 2 min? 5 min?
- Horário padrão de notificação por escola.
