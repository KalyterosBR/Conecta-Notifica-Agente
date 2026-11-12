# Agente Conecta Notifica

Serviço que roda na máquina da escola, lê as marcações de acesso em
`dbo.Marcacao` no SQL Server da catraca e envia para o SaaS, que resolve
aluno → responsáveis e dispara o WhatsApp.

Binário único, sem runtime para instalar, sem CGO. Acesso ao banco é
**somente leitura**: nenhuma consulta do agente escreve na base da catraca.

## Central e ícone no Windows

A Central e o monitor usam um único ícone na bandeja. Abrir o agente inicia o
monitor caso ele ainda não esteja aberto; clicar no ícone reabre a Central.
Minimizar ou fechar a janela mantém o monitor disponível. **Sair**, no menu do
ícone, encerra a Central e o monitor, preservando o serviço Windows.

O logo recebe um ponto verde quando está conectado e vermelho quando o estado
não está saudável. O monitor consulta o serviço a cada cinco segundos; um
serviço parado não aparece conectado por causa de um estado antigo em disco.

Os ícones têm imagens próprias para 16, 20, 24, 32, 40, 48, 64, 96, 128 e
256 pixels. O monitor escolhe o tamanho conforme a escala da barra de tarefas.
Para regenerar os assets a partir do logo original, execute no Windows
`powershell -ExecutionPolicy Bypass -File scripts\gerar-icones.ps1`; depois
regenere os recursos do núcleo e publique novamente a Central.

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

Para preparar ou diagnosticar a comunicação entre equipamentos Topdata,
TopPortaria, serviços locais e Windows Firewall, consulte o
[Guia de instalação e diagnóstico Topdata](docs/GUIA-INSTALACAO-CATRACAS-TOPDATA.md).
O instalador também coloca esse guia em `docs` e cria um atalho para abri-lo.

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

### Reconexão automática

Quedas temporárias do SQL Server ou do painel geram novas tentativas após
5, 10, 20 e 30 segundos; se a falha continuar, o agente tenta a cada 30 segundos
até recuperar. Depois do sucesso, cada ciclo volta ao intervalo configurado.
O mesmo vale para a sincronização periódica de alunos quando habilitada.
As consultas SQL respeitam `banco.timeout_segundos` (padrão: 15 segundos),
evitando que uma leitura travada bloqueie as próximas tentativas.

A inicialização SQL tenta novamente a cada 30 segundos. Se o trabalho interno
for interrompido inesperadamente, o serviço tenta iniciá-lo novamente com a
espera progressiva. O instalador também configura o Windows para reiniciar o
serviço 30 segundos após falha do processo. **Parar agente** continua sendo uma
parada intencional, sem reinício automático.

As tentativas preservam a fila e o cursor. Erros de autenticação 401/403 mantêm
os eventos e aguardam o intervalo normal: exigem corrigir a chave, não apenas
esperar a reconexão. A sincronização manual é uma operação única; essas
tentativas contínuas atendem ao serviço e à sincronização periódica habilitada.
Os logs registram a próxima tentativa e a recuperação.

### `POST /v1/agent/students/sync`

```json
{ "full": true, "students": [ { "external_id": "77", "name": "Ana Souza", "class_name": "5A", "active": true } ] }
```

`class_name` é a turma. Nesta base ela sai do nome do perfil de acesso (`Pessoas.CodigoPerfilAcesso`), no mesmo ciclo da sincronização de alunos. O que o painel precisa gravar e mostrar está em [docs/CONTRATO-TURMA.md](docs/CONTRATO-TURMA.md).

A foto não entra nesse lote. O comando manual `sincronizar-fotos` envia `dbo.Pessoas.foto` em `POST /v1/agent/students/{external_id}/photo`. O contrato para o painel receber e exibir está em [docs/CONTRATO-FOTO-ALUNO.md](docs/CONTRATO-FOTO-ALUNO.md).

### `POST /v1/agent/students/{external_id}/photo`

```json
{ "sha256": "<sha256 hex dos bytes do JPEG>", "data_base64": "<jpeg em base64>" }
```

Resposta de sucesso: `{"status":"gravada"}` ou `{"status":"igual"}`.

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
