# Contrato — turma do aluno

O agente envia a turma no mesmo lote dos outros dados do aluno. Não há endpoint novo e não há botão. O serviço repete isso na sincronização de alunos que já existe.

Nesta base do TopPortaria, `dbo.Pessoas` não tem coluna `Turma`. O texto vem do perfil de acesso: `Pessoas.CodigoPerfilAcesso` aponta para o cadastro do perfil, e o agente manda o **nome** desse perfil. O número do perfil não vai para o site.

A leitura é somente SELECT. Quem não tem perfil segue no lote, com a turma vazia.

## O que o agente envia

`POST /v1/agent/students/sync`

Mesma autenticação dos outros endpoints do agente: `Authorization: Bearer <api_key>`.

```json
{
  "full": true,
  "students": [
    {
      "external_id": "77",
      "name": "Ana Souza",
      "class_name": "Manhã",
      "card": "1001",
      "active": true
    }
  ]
}
```

`class_name` é a turma. `external_id` continua sendo `dbo.Pessoas.Codigo`.

Regras:

- Gravar `class_name` em `students.class_name`, no mesmo upsert de nome, cartão e ativo.
- Turma vazia ou campo ausente: mostrar "sem turma". Não apagar o aluno.
- Reenviar o mesmo nome não cria outro aluno. A chave continua `(school_id, external_id)`.
- Não criar rota separada para turma. Ela não entra na mensagem de WhatsApp.

## O que a tela precisa mostrar

O valor de `class_name` aparece como **Turma**:

- na lista de alunos, ao lado do nome e na coluna Turma
- na ficha do aluno
- no relatório de turmas, agrupando os acessos por esse texto

Quem estiver com `class_name` vazio fica como "sem turma", como a tela já faz quando não há valor.
