# Versões e distribuição do Agente Conecta Notifica

Este projeto mantém dois canais distintos para evitar que uma compilação de
validação seja confundida com o instalador usado pelas escolas.

## Canais

| Canal | Como é gerado | Identificação | Uso |
| --- | --- | --- | --- |
| Teste | Push em `main` que altera `apps/agent` ou execução manual do workflow | `ConectaNotifica-Agente-TESTE-<versão>-dev.<execução>.<tentativa>.<commit>` | Validação interna; não distribuir como versão oficial |
| Oficial | Release GitHub publicada com tag `vX.Y.Z` correspondente a `apps/agent/VERSION` | `ConectaNotifica-Agente-X.Y.Z.exe` | Distribuição para escolas |

Os artefatos de teste ficam na execução do workflow do GitHub Actions. Eles não
são anexados à página de releases e não aparecem como atualização oficial. A
página de releases contém apenas instaladores oficiais publicados.

## Publicar uma versão oficial

1. Valide as mudanças e os artefatos do canal de teste.
2. Atualize `VERSION` para a próxima versão estável SemVer (`MAJOR.MINOR.PATCH`)
   e faça commit dessa alteração junto com o código aprovado.
3. Crie uma release GitHub com uma tag exatamente igual a `v<VERSION>`, por
   exemplo, `v1.0.5` para `VERSION=1.0.5`.
4. Publique a release. O workflow roda os testes, valida a tag e a versão,
   compila o instalador e anexa o `.exe` à release.
5. Confira se o arquivo oficial aparece na release antes de compartilhar o
   link de download.

Uma tag que não corresponda a `VERSION`, uma versão fora do formato `X.Y.Z` ou
uma compilação com testes falhos não pode gerar um instalador oficial.

## Identificar o que está instalado

- O instalador oficial não tem `TESTE` nem `-dev` no nome.
- Builds de validação sempre têm `TESTE` no nome do artefato e `-dev` na
  versão mostrada pelo agente.
- A Central e o painel mostram a versão informada pelo núcleo do agente. Em
  relatórios, guarde essa versão junto com o nome do arquivo instalador e a
  data da instalação.
- A ação **Verificar atualização** consulta releases publicadas; não instala
  nada automaticamente.

## Builds locais

Ao compilar localmente, informe uma versão de desenvolvimento explícita, por
exemplo `make instalador VERSAO=1.0.5-dev.local`. Não use a versão estável em
desenvolvimento: isso faria uma build de teste parecer igual à distribuição.
