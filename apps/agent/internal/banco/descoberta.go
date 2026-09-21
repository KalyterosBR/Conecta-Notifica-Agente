package banco

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"text/tabwriter"
)

type bloco struct {
	titulo string
	sql    string
	nota   string
}

// blocos são as perguntas que precisamos responder olhando a base real da
// escola antes de fechar o config: qual o cursor, como a direção
// (entrada/saída) está codificada e onde fica o cadastro de pessoas.
var blocos = []bloco{
	{
		titulo: "Colunas de dbo.Marcacao",
		nota:   "Confirme tipos e veja se Codigo é IDENTITY (coluna EhIdentity = 1).",
		sql: `SELECT c.name AS Coluna, t.name AS Tipo, c.max_length AS Tamanho,
             c.is_nullable AS Nulo,
             COLUMNPROPERTY(c.object_id, c.name, 'IsIdentity') AS EhIdentity
        FROM sys.columns c
        JOIN sys.types t ON t.user_type_id = c.user_type_id
       WHERE c.object_id = OBJECT_ID('dbo.Marcacao')
       ORDER BY c.column_id`,
	},
	{
		titulo: "Volume e janela de dbo.Marcacao",
		nota:   "O formato de DataHora define coleta.formato_datahora (12 chars = YYMMDDHHMMSS).",
		sql: `SELECT COUNT(*) AS Linhas, MIN(DataHora) AS MenorDataHora,
             MAX(DataHora) AS MaiorDataHora, MAX(Codigo) AS MaiorCodigo
        FROM dbo.Marcacao WITH (NOLOCK)`,
	},
	{
		titulo: "Últimas 10 marcações",
		sql: `SELECT TOP 10 Codigo, CodigoPessoa, Inners, Origem, Complemento,
             Cartao, DataHora, Original, CodigoLocal
        FROM dbo.Marcacao WITH (NOLOCK)
       ORDER BY DataHora DESC`,
	},
	{
		titulo: "Valores distintos de Origem",
		nota:   "Candidato a direcao.modo = origem, se separar entrada de saída.",
		sql: `SELECT Origem, COUNT(*) AS Qtd FROM dbo.Marcacao WITH (NOLOCK)
       GROUP BY Origem ORDER BY Qtd DESC`,
	},
	{
		titulo: "Valores distintos de Complemento",
		sql: `SELECT Complemento, COUNT(*) AS Qtd FROM dbo.Marcacao WITH (NOLOCK)
       GROUP BY Complemento ORDER BY Qtd DESC`,
	},
	{
		titulo: "Valores distintos de CodigoLocal",
		nota:   "Cruze com dbo.Locais abaixo para montar direcao.mapa.",
		sql: `SELECT CodigoLocal, COUNT(*) AS Qtd FROM dbo.Marcacao WITH (NOLOCK)
       GROUP BY CodigoLocal ORDER BY Qtd DESC`,
	},
	{
		titulo: "Valores distintos de Inners (equipamento)",
		sql: `SELECT Inners, COUNT(*) AS Qtd FROM dbo.Marcacao WITH (NOLOCK)
       GROUP BY Inners ORDER BY Qtd DESC`,
	},
	{
		titulo: "dbo.Locais",
		nota:   "O nome do local costuma dizer o sentido (ex.: PORTARIA ENTRADA).",
		sql:    `SELECT TOP 50 * FROM dbo.Locais WITH (NOLOCK)`,
	},
	{
		titulo: "dbo.Inners",
		sql:    `SELECT TOP 50 * FROM dbo.Inners WITH (NOLOCK)`,
	},
	{
		titulo: "Tabelas candidatas ao cadastro de pessoas",
		nota:   "A FK Marcacao.CodigoPessoa aponta para uma delas. Use em consultas.alunos.",
		sql: `SELECT s.name AS Schema_, t.name AS Tabela,
             (SELECT SUM(p.rows) FROM sys.partitions p
               WHERE p.object_id = t.object_id AND p.index_id IN (0,1)) AS Linhas
        FROM sys.tables t JOIN sys.schemas s ON s.schema_id = t.schema_id
       WHERE t.name LIKE '%Pesso%' OR t.name LIKE '%Aluno%'
          OR t.name LIKE '%Funcion%' OR t.name LIKE '%Cadastr%'
       ORDER BY t.name`,
	},
	{
		titulo: "FK real de Marcacao.CodigoPessoa",
		sql: `SELECT fk.name AS FK, OBJECT_NAME(fk.parent_object_id) AS Tabela,
             OBJECT_NAME(fk.referenced_object_id) AS TabelaReferenciada
        FROM sys.foreign_keys fk
       WHERE fk.parent_object_id = OBJECT_ID('dbo.Marcacao')`,
	},
}

// Descobrir roda as consultas de reconhecimento e devolve um relatório em
// texto. Nenhuma delas escreve nada.
func (r *Repo) Descobrir(ctx context.Context) string {
	var sb strings.Builder
	fmt.Fprintf(&sb, "Descoberta do banco — %s\n", r.cfg.Banco.Redigido())
	fmt.Fprintf(&sb, "Cursor resolvido: %s\n", r.ModoCursor(ctx))

	for _, b := range blocos {
		fmt.Fprintf(&sb, "\n== %s ==\n", b.titulo)
		if b.nota != "" {
			fmt.Fprintf(&sb, "   (%s)\n", b.nota)
		}
		texto, err := r.tabela(ctx, b.sql)
		if err != nil {
			fmt.Fprintf(&sb, "   ! %v\n", err)
			continue
		}
		sb.WriteString(texto)
	}
	return sb.String()
}

func (r *Repo) tabela(ctx context.Context, consulta string) (string, error) {
	rows, err := r.db.QueryContext(ctx, consulta)
	if err != nil {
		return "", err
	}
	defer rows.Close()

	cols, err := rows.Columns()
	if err != nil {
		return "", err
	}
	var sb strings.Builder
	w := tabwriter.NewWriter(&sb, 0, 0, 2, ' ', 0)
	fmt.Fprintln(w, "  "+strings.Join(cols, "\t"))

	n := 0
	for rows.Next() {
		vals := make([]sql.NullString, len(cols))
		ptrs := make([]any, len(cols))
		for i := range vals {
			ptrs[i] = &vals[i]
		}
		if err := rows.Scan(ptrs...); err != nil {
			return "", err
		}
		campos := make([]string, len(cols))
		for i, v := range vals {
			if !v.Valid {
				campos[i] = "NULL"
				continue
			}
			campos[i] = strings.TrimSpace(v.String)
		}
		fmt.Fprintln(w, "  "+strings.Join(campos, "\t"))
		n++
		if n >= 60 {
			fmt.Fprintln(w, "  ...")
			break
		}
	}
	if err := rows.Err(); err != nil {
		return "", err
	}
	if n == 0 {
		return "  (sem linhas)\n", nil
	}
	w.Flush()
	return sb.String(), nil
}
