package banco

import (
	"context"
	"database/sql"
	"fmt"
	"log/slog"
	"strings"

	"github.com/conecta/notifica-agent/internal/modelo"
)

// relacaoPerfil é a tabela cujo nome deve aparecer como turma no painel.
type relacaoPerfil struct {
	schema string
	tabela string
	chave  string
	nome   string
}

// preencherTurmaPeloPerfil copia o nome do perfil de acesso para alunos cuja
// consulta não trouxe turma. A sincronização periódica de alunos já chama
// BuscarAlunos, então não existe ação separada para isso.
func (r *Repo) preencherTurmaPeloPerfil(ctx context.Context, alunos []modelo.Aluno) {
	if !faltaTurma(alunos) {
		return
	}
	rel, err := r.relacaoPerfil(ctx)
	if err != nil {
		slog.Default().Warn("não foi possível localizar o perfil de acesso para a turma", "erro", err)
		return
	}
	if rel.tabela == "" {
		return
	}
	nomes, err := r.nomesPorPerfil(ctx, rel)
	if err != nil {
		slog.Default().Warn("não foi possível ler o nome do perfil de acesso", "erro", err)
		return
	}
	if n := mesclarTurmaPerfil(alunos, nomes); n > 0 {
		slog.Default().Info("turmas preenchidas pelo perfil de acesso", "quantidade", n)
	}
}

func faltaTurma(alunos []modelo.Aluno) bool {
	for i := range alunos {
		if strings.TrimSpace(alunos[i].Turma) == "" && alunos[i].IDExterno != "" {
			return true
		}
	}
	return false
}

func (r *Repo) relacaoPerfil(ctx context.Context) (relacaoPerfil, error) {
	var rel relacaoPerfil
	err := r.db.QueryRowContext(ctx, `
SELECT TOP (1) rs.name, rt.name, rc.name
  FROM sys.foreign_keys fk
  JOIN sys.foreign_key_columns fkc ON fkc.constraint_object_id = fk.object_id
  JOIN sys.columns pc ON pc.object_id = fkc.parent_object_id AND pc.column_id = fkc.parent_column_id
  JOIN sys.columns rc ON rc.object_id = fkc.referenced_object_id AND rc.column_id = fkc.referenced_column_id
  JOIN sys.tables rt ON rt.object_id = fkc.referenced_object_id
  JOIN sys.schemas rs ON rs.schema_id = rt.schema_id
  JOIN sys.tables pt ON pt.object_id = fk.parent_object_id
  JOIN sys.schemas ps ON ps.schema_id = pt.schema_id
 WHERE ps.name = N'dbo' AND pt.name = N'Pessoas'
   AND pc.name = N'CodigoPerfilAcesso'`).Scan(&rel.schema, &rel.tabela, &rel.chave)
	if err != nil && err != sql.ErrNoRows {
		return relacaoPerfil{}, err
	}
	if err == sql.ErrNoRows {
		err = r.db.QueryRowContext(ctx, `
SELECT TOP (1) s.name, t.name
  FROM sys.tables t
  JOIN sys.schemas s ON s.schema_id = t.schema_id
 WHERE s.name = N'dbo' AND t.name LIKE N'%Perfil%'
 ORDER BY CASE t.name
            WHEN N'PerfilAcesso' THEN 0
            WHEN N'PerfisAcesso' THEN 1
            WHEN N'Perfil' THEN 2
            ELSE 3 END, t.name`).Scan(&rel.schema, &rel.tabela)
		if err == sql.ErrNoRows {
			return relacaoPerfil{}, nil
		}
		if err != nil {
			return relacaoPerfil{}, err
		}
	}
	colunas, err := r.colunasTabela(ctx, rel.schema, rel.tabela)
	if err != nil {
		return relacaoPerfil{}, err
	}
	if rel.chave == "" {
		rel.chave = escolherColuna(colunas, "Codigo", "Id", "CodigoPerfil", "CodigoPerfilAcesso")
	}
	rel.nome = escolherColuna(colunas, "Nome", "Descricao", "Descrição", "NomeDisplay")
	if rel.chave == "" || rel.nome == "" {
		return relacaoPerfil{}, nil
	}
	return rel, nil
}

func (r *Repo) colunasTabela(ctx context.Context, schema, tabela string) (map[string]string, error) {
	rows, err := r.db.QueryContext(ctx, `
SELECT c.name
  FROM sys.columns c
  JOIN sys.tables t ON t.object_id = c.object_id
  JOIN sys.schemas s ON s.schema_id = t.schema_id
 WHERE s.name = @schema AND t.name = @tabela`,
		sql.Named("schema", schema), sql.Named("tabela", tabela))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	colunas := map[string]string{}
	for rows.Next() {
		var nome string
		if err := rows.Scan(&nome); err != nil {
			return nil, err
		}
		colunas[strings.ToLower(nome)] = nome
	}
	return colunas, rows.Err()
}

func escolherColuna(colunas map[string]string, opcoes ...string) string {
	for _, op := range opcoes {
		if v := colunas[strings.ToLower(op)]; v != "" {
			return v
		}
	}
	return ""
}

func (r *Repo) nomesPorPerfil(ctx context.Context, rel relacaoPerfil) (map[string]string, error) {
	consulta := fmt.Sprintf(`
SELECT CONVERT(varchar(40), p.Codigo), LTRIM(RTRIM(per.%s))
  FROM dbo.Pessoas AS p
  LEFT JOIN %s.%s AS per ON per.%s = p.CodigoPerfilAcesso
 WHERE per.%s IS NOT NULL AND LTRIM(RTRIM(per.%s)) <> ''`,
		identSQL(rel.nome), identSQL(rel.schema), identSQL(rel.tabela), identSQL(rel.chave), identSQL(rel.nome), identSQL(rel.nome))
	rows, err := r.db.QueryContext(ctx, consulta)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	nomes := map[string]string{}
	for rows.Next() {
		var codigo, nome string
		if err := rows.Scan(&codigo, &nome); err != nil {
			return nil, err
		}
		codigo = strings.TrimSpace(codigo)
		nome = strings.TrimSpace(nome)
		if codigo != "" && nome != "" {
			nomes[codigo] = nome
		}
	}
	return nomes, rows.Err()
}

func identSQL(v string) string {
	return "[" + strings.ReplaceAll(v, "]", "]]") + "]"
}

// mesclarTurmaPerfil preenche só turma vazia. Uma turma já vinda da consulta
// configurada permanece.
func mesclarTurmaPerfil(alunos []modelo.Aluno, nomes map[string]string) int {
	n := 0
	for i := range alunos {
		if strings.TrimSpace(alunos[i].Turma) != "" {
			continue
		}
		nome := strings.TrimSpace(nomes[alunos[i].IDExterno])
		if nome == "" {
			continue
		}
		alunos[i].Turma = nome
		n++
	}
	return n
}
