package banco

import (
	"testing"

	"github.com/conecta/notifica-agent/internal/modelo"
)

func TestMesclarTurmaPerfil(t *testing.T) {
	alunos := []modelo.Aluno{
		{IDExterno: "1", Turma: ""},
		{IDExterno: "2", Turma: "já preenchida"},
		{IDExterno: "3", Turma: "  "},
		{IDExterno: "4", Turma: ""},
	}
	n := mesclarTurmaPerfil(alunos, map[string]string{
		"1": "Manhã",
		"2": "Não usar",
		"3": "Integral",
	})
	if n != 2 {
		t.Fatalf("preenchidas = %d, esperado 2", n)
	}
	if alunos[0].Turma != "Manhã" || alunos[1].Turma != "já preenchida" || alunos[2].Turma != "Integral" || alunos[3].Turma != "" {
		t.Fatalf("resultado inesperado: %+v", alunos)
	}
}

func TestConsultaComPerfilContinuaSomenteLeitura(t *testing.T) {
	consulta := `SELECT p.[Codigo] AS external_id, p.[Nome] AS nome, per.[Descricao] AS turma, p.[Cartao] AS cartao, 1 AS ativo
  FROM [dbo].[Pessoas] AS p
  LEFT JOIN [dbo].[PerfilAcesso] AS per ON per.[Codigo] = p.[CodigoPerfilAcesso]`
	if err := validarConsultaSomenteLeitura(consulta); err != nil {
		t.Fatal(err)
	}
}

func TestEscolherColunaPerfil(t *testing.T) {
	colunas := map[string]string{"codigo": "Codigo", "descricao": "Descricao"}
	if got := escolherColuna(colunas, "Nome", "Descricao"); got != "Descricao" {
		t.Fatalf("nome = %q", got)
	}
	if got := escolherColuna(colunas, "Nome"); got != "" {
		t.Fatalf("coluna ausente deveria ser vazia, veio %q", got)
	}
}
