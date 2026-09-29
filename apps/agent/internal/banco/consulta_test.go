package banco

import "testing"

func TestValidarConsultaSomenteLeitura(t *testing.T) {
	for _, consulta := range []string{
		"SELECT Codigo AS external_id, Nome AS nome FROM dbo.Pessoas",
		" select Codigo FROM dbo.Marcacao WHERE Codigo > @cursor ",
	} {
		if err := validarConsultaSomenteLeitura(consulta); err != nil {
			t.Errorf("consulta de leitura foi rejeitada: %v", err)
		}
	}
	for _, consulta := range []string{
		"UPDATE dbo.Pessoas SET Nome = 'x'",
		"SELECT Codigo FROM dbo.Marcacao; DELETE dbo.Marcacao",
		"SELECT Codigo INTO dbo.Copia FROM dbo.Marcacao",
		"SELECT Codigo FROM dbo.Marcacao -- anotação",
		"WITH C AS (SELECT Codigo FROM dbo.Marcacao) SELECT Codigo FROM C",
	} {
		if err := validarConsultaSomenteLeitura(consulta); err == nil {
			t.Errorf("consulta potencialmente gravável foi aceita: %q", consulta)
		}
	}
}
