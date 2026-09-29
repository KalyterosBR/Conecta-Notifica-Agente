# Agente Conecta Notifica

Serviço que roda na máquina da escola, lê as marcações de acesso em
`dbo.Marcacao` no SQL Server da catraca e envia para o SaaS, que resolve
aluno → responsáveis e dispara o WhatsApp.

Binário único, sem runtime para instalar, sem CGO. Acesso ao banco é
**somente leitura**: nenhuma consulta do agente escreve na base da catraca.

## Como funciona

```
dbo.Marcacao ──polling──▶ mapeamento ──▶ fila em disco ──HTTPS──▶ SaaS
  (SQL Server)            direção          (JSONL)                /v1/agent/events
                          + fuso           sobrevive à
                          + dedupe         queda de link
```

Quatro laços independentes: coleta (7s), envio (5s), heartbeat (60s) e —
quando o cursor é por `DataHora` — varredura de marcações atrasadas (10min).

**Nada é enviado sem passar pela fila em disco.** Internet caída só faz a fila
crescer; quando o link volta, o envio retoma exatamente de onde parou.

## O que ainda depende do banco real da escola

O esquema de `dbo.Marcacao` é conhecido (`Codigo`, `CodigoPessoa`, `Inners`,
`Origem`, `Complemento`, `Cartao`, `DataHora varchar(12)`, `Original`,
`CodigoLocal`), mas a direção já é conhecida —
**`Complemento` = 1 entrada, 0 saída**, e esse é o padrão do agente
(`direcao.modo: complemento`, sem precisar de mapa). O que ainda varia por
instalação está resolvido por configuração, não por código:

| Pergunta | Onde responder | Como descobrir |
|---|---|---|
| `Codigo` é IDENTITY? | `coleta.cursor` (`auto` decide sozinho) | `descobrir`, bloco 1 |
| Qual é a tabela de pessoas? | `consultas.alunos` | `descobrir`, bloco 6 |

Rode primeiro:

```sh
notifica-agent descobrir -config config.yaml
```

Ele imprime colunas, volume, amostras, os valores distintos de `Origem`,
`Complemento`, `CodigoLocal` e `Inners`, o conteúdo de `dbo.Locais` e
`dbo.Inners` e as tabelas candidatas ao cadastro. O mesmo está em
[`scripts/descoberta.sql`](scripts/descoberta.sql) para rodar no SSMS.

### Preparar a sincronização de alunos

Na Central, use **Detectar consulta de alunos**. O agente procura a tabela
referenciada por `dbo.Marcacao.CodigoPessoa`, reconhece colunas usuais de
código, nome, turma e cartão, e valida o `SELECT` com `TOP (0)`. Essa validação
confere esquema e permissão sem retornar nomes ou cartões. O comando grava a
consulta apenas no `config.yaml`; não cria usuário, não concede permissões e
não altera tabelas.

A conta SQL precisa ter `SELECT` na tabela encontrada. Se não tiver, peça ao
administrador do SQL Server para conceder somente a leitura necessária. A
sincronização automática fica desligada até a escola revisar a regra de
validade e clicar em **Sincronizar alunos agora** quando desejar. Se a
instalação tiver campos como `DataInicio`, `DataFim` ou `ControlaValidade`, o
agente não presume como interpretá-los: a regra deve ser confirmada antes da
rotina periódica.

## Cursor: por que `Codigo` é melhor que `DataHora`

Catraca que fica offline guarda as marcações e descarrega depois. Essas linhas
entram com `DataHora` **antiga**, já ultrapassada por um cursor por data — e
seriam perdidas para sempre. Sendo `Codigo` uma coluna IDENTITY, ela cresce na
ordem de inserção e pega essas marcações naturalmente.

Quando `Codigo` não é IDENTITY, o agente cai no cursor por `DataHora` e liga a
varredura: a cada `varredura_minutos` relê as últimas `varredura_horas` e
enfileira o que ainda não viu. O cache de deduplicação fica em disco
(`dados/vistos.log`), então reiniciar o serviço não reenvia a janela inteira.

## Instalação na escola

O caminho normal é o **instalador do Windows**: um `.exe` com telas de
"Avançar" que pede o endereço e a chave da escola, os dados do banco, grava o
`config.yaml`, registra o serviço e testa tudo. Passo a passo em
[INSTALACAO.md](INSTALACAO.md); o instalador é gerado pelo CI a cada push em
`apps/agent`.

Antes, no SSMS: criar o usuário de leitura com
[`scripts/usuario-somente-leitura.sql`](scripts/usuario-somente-leitura.sql).

No dia a dia, abra `notifica-agent.exe` com dois cliques: a **Central do
agente** mostra a saúde da integração e permite testar, iniciar/parar o
serviço, abrir a configuração e gerar o diagnóstico sem Prompt de Comando.
O instalador continua sendo o caminho gráfico para a primeira configuração.

Para suporte e automação, continuam disponíveis `descobrir`, `configurar`,
`testar`, `instalar` e `iniciar`; `notifica-agent menu` mantém o menu de texto
legado quando necessário.

Comandos: `painel`, `menu`, `run`, `configurar`, `detectar`, `bandeja`,
`instalar`, `desinstalar`, `iniciar`, `parar`, `status`, `testar`, `descobrir`,
`versao`.

## Contrato com o SaaS

Todas com `Authorization: Bearer <api_key>`.

### `POST /v1/agent/events`

Cabeçalho `Idempotency-Key` por lote. O `external_event_id` reproduz a PK
composta de `dbo.Marcacao` (`Inners|Complemento|Cartao|DataHora`), então
**o servidor precisa deduplicar por `unique (school_id, external_event_id)`** —
é o que torna o reenvio depois de um timeout seguro.

```json
{ "events": [ {
  "external_event_id": "3|0|0000000000012345|260825073015",
  "external_student_id": "77",
  "direction": "in",
  "occurred_at": "2026-08-25T07:30:15-03:00",
  "card": "0000000000012345",
  "device_id": "3",
  "location_id": "1"
} ] }
```

Resposta: `{ "accepted": 1, "duplicates": 0 }`.

Cartão sem pessoa vinculada vira `external_student_id: "cartao:<numero>"` — o
evento nunca é descartado, vira pendência de cadastro no painel.

Status que o agente trata como **definitivos** (descarta o lote e segue, para
um payload ruim não travar a fila): 400, 404, 409, 413, 422. Qualquer outro
erro mantém o lote na fila para a próxima tentativa. 401/403 mantém o lote e
loga a chave rejeitada.

### `POST /v1/agent/students/sync`

```json
{ "full": true, "students": [ { "external_id": "77", "name": "Ana Souza", "class_name": "5A", "active": true } ] }
```

### `POST /v1/agent/heartbeat`

```json
{ "version": "1.0.0", "cursor": "918233", "pending": 0, "db_ok": true,
  "last_event_at": "2026-08-25T07:30:15-03:00", "sent_today": 412 }
```

Alimenta `agent_api_keys.last_seen_at` e o alerta de agente offline.

## Build

```sh
make windows   # bin/notifica-agent.exe (sem CGO, sem strip — ver abaixo)
make test
```

O build Windows não usa `-s -w` e embute manifesto UAC + informações de
fabricante (`cmd/agent/versioninfo.json` → `resource_windows_amd64.syso`):
binário Go stripado e anônimo é o principal gatilho de falso positivo no
Defender/SmartScreen. O **Smart App Control** do Windows 11 só libera
executável **assinado** — o alvo é assinar cada release (ver o alvo de
assinatura no Makefile); até lá, o SAC precisa estar desativado na máquina
(ele já vem inativo em máquinas que não são instalação nova do Win11).

## Arquivos em `dados/`

| Arquivo | Conteúdo |
|---|---|
| `fila.jsonl` | eventos aguardando envio; compactado após 8 MB consumidos |
| `estado.json` | cursor, offset e contadores; gravado com temp+rename |
| `vistos.log` | IDs já enfileirados na janela da varredura |

Apagar a pasta faz o agente recomeçar por `coleta.inicio_em`.
