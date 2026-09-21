# AGENTS.md — Conecta Notifica

## Escopo e segurança

- Projeto independente do Conecta Acesso. Não apontar este agente ao backend do Conecta Acesso sem um adaptador específico.
- O endereço documentado é `https://painel.conectapontoeacesso.com.br`, com API em `https://painel.conectapontoeacesso.com.br/api`.
- Nunca versionar binários, `config.yaml`, chaves `cn_*`, senhas SQL ou logs. A cópia importada pode conter arquivos `:Zone.Identifier` do Windows.
- O agente é exclusivamente leitor do TopPortaria: jamais criar, alterar ou excluir dados no SQL Server.

## TopAcesso / TopPortaria

- A origem de eventos é `dbo.Marcacao`. `Codigo` é `IDENTITY`, portanto é o cursor obrigatório/preferencial. `CodigoPessoa` possui a FK `FK_Marcacao_Pessoa` para `dbo.Pessoas`.
- O diagnóstico também pode ler `dbo.Locais`, `dbo.Inners` e o catálogo `sys.*`. A tabela de pessoas só deve ser consultada por uma query explícita em `consultas.alunos`.
- A tabela `dbo.Pessoas` tem, entre outras, `Codigo`, `Nome`, `Cartao`, `DataInicio`, `DataFim` e `ControlaValidade`.
- A base operacional é `TopPortaria`; a base `CONECTANOTIFICA` não contém `dbo.Marcacao`.
- A conta local `notifica_ro` possui somente `SELECT` em `dbo.Marcacao` e `dbo.Pessoas`. Não ampliar permissões sem necessidade.
- A base de teste tinha um cadastro com `ControlaValidade=0` e datas vazias. A query atual envia `Pessoas.Codigo` como `external_id`, `Nome`, `Cartao` e `ativo=1`. Antes de atender bases com validade, definir uma regra validada para `DataInicio`, `DataFim` e `ControlaValidade`; não presumir o formato das datas `varchar`.
- Não copiar automaticamente o uso de `WITH (NOLOCK)` de outras referências. Avaliar isolamento, timeout e repetição de forma apropriada à auditoria.

## Ambiente Windows validado em 18/09/2026

- O SSMS conectou à instância `DESKTOP-8UC3DN3\\CONECTANOTIFICA` por Autenticação do Windows com `Confiar no certificado do servidor`; o certificado local não possui cadeia confiável.
- Go `1.27.0` foi instalado e o agente foi compilado em `C:\\Users\\Conecta\\Desktop\\conecta-notifica-main\\apps\\agent` com `go build -o bin\\notifica-agent.exe .\\cmd\\agent`.
- A configuração efetiva é `apps\\agent\\bin\\config.yaml`; o `config.yaml` vazio na raiz de `apps\\agent` não é usado pelo executável. Ela seleciona `TopPortaria` e habilita `consultas.sincronizar_alunos` a cada 60 minutos.
- `notifica-agent.exe testar -config .\\bin\\config.yaml` foi aprovado: banco conectado, cursor por código, zero marcações de amostra, um cadastro lido e SaaS respondendo. Esse comando não envia o cadastro.
- A execução manual `notifica-agent.exe run -config .\\bin\\config.yaml` sincronizou um cadastro com sucesso para o painel.
- Ao encerrar, o agente manual permaneceu em execução no CMD. Não iniciar o serviço `ConectaNotificaAgent` enquanto esse processo estiver ativo, pois ambos disputam `bin\\dados\\vistos.log`. Para operação persistente, parar primeiro o processo manual e confirmar que o serviço usa a mesma configuração em `bin\\config.yaml`.
- Ainda falta gerar uma marcação física/de teste e validar o envio de evento; não havia marcações no diagnóstico.

## Próximos cuidados

- Manter cursor persistente por `Codigo`, outbox durável e reenvio idempotente para não perder eventos em quedas de internet, API ou reinício.
- Para cada marcação, normalizar pessoa/cartão, data e hora no fuso local, `Inners`, `CodigoLocal` e sentido. O mapeamento de `Complemento` deve ser configurável e confirmado na instalação real.
- Expor diagnóstico seguro: estado do banco, cursor, pendências, último evento e erros recuperáveis, sem DSN, senha ou outros segredos.
