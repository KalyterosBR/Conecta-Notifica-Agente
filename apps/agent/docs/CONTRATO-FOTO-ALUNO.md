# Contrato — foto do aluno

O agente lê a foto em `dbo.Pessoas.foto` (JPEG, assinatura `FFD8FF`) e envia uma pessoa por vez. O site ainda não recebe nem exibe essa imagem. Este arquivo é o contrato para implementar isso no painel.

O comando é manual. O serviço Windows não envia foto sozinho.

```text
notifica-core.exe sincronizar-fotos -config config.yaml
```

Antes, o cadastro precisa existir no painel (`sincronizar-alunos`). O `external_id` da foto é `dbo.Pessoas.Codigo`, o mesmo código da sincronização de alunos.

A consulta no SQL é somente leitura:

```sql
SELECT CONVERT(varchar(40), Codigo), foto
  FROM dbo.Pessoas
 WHERE foto IS NOT NULL AND DATALENGTH(foto) > 0
 ORDER BY Codigo
```

Nas amostras desta base, o arquivo é JFIF de cerca de 34 a 49 KB.

## O que o painel precisa aceitar

`POST /v1/agent/students/{external_id}/photo`

Mesma autenticação dos outros endpoints do agente: `Authorization: Bearer <api_key>`.

```json
{
  "sha256": "hex minúsculo do SHA-256 dos bytes do JPEG, não do base64",
  "data_base64": "base64 padrão, sem quebra de linha"
}
```

Regras:

- Decodificar o base64 e conferir o SHA-256 com `sha256`. Se não bater, responder **400**.
- Aceitar só JPEG (`FF D8 FF`). Outro formato: **400**.
- Teto de **512 KB** já decodificado. Fora disso: **400**.
- Aluno inexistente nessa escola: **404**. O agente segue para a próxima pessoa.
- Foto nova ou trocada: **200** `{"status":"gravada"}`.
- O mesmo `sha256` já gravado: **200** `{"status":"igual"}`. Não regravar.
- **401/403** interrompe o comando. Outro erro também interrompe.
- Não colocar a imagem no `POST /v1/agent/students/sync`. Esse lote continua só com código, nome, turma, cartão e ativo.

Guardar os bytes fora da listagem de alunos, para a lista não carregar a foto de todo mundo.

## O que a tela precisa mostrar

- Na ficha e na lista, um indicador `tem_foto`.
- `GET /v1/painel/alunos/{id}/foto` devolve `image/jpeg`, só para a escola logada, sem a imagem no JSON da lista.
- Se não houver foto, manter o avatar gerado pelo nome.
- A foto fica no perfil. Ela não entra na mensagem de WhatsApp.
