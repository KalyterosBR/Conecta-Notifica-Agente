// Package banco fala com o SQL Server da escola. Acesso é sempre somente
// leitura: nenhuma consulta aqui escreve na base da catraca.
package banco

import (
	"context"
	"database/sql"
	"fmt"
	"strconv"
	"strings"

	"github.com/conecta/notifica-agent/internal/config"
	"github.com/conecta/notifica-agent/internal/modelo"
	_ "github.com/microsoft/go-mssqldb"
)

// Colunas que a consulta de eventos precisa devolver. O nome é comparado em
// caixa baixa, a ordem não importa e "Nome" é opcional.
const (
	consultaEventosPorCodigo = `
SELECT TOP (@limite)
       m.Codigo, m.CodigoPessoa, m.Inners, m.Origem,
       m.Complemento, m.Cartao, m.DataHora, m.CodigoLocal
  FROM dbo.Marcacao AS m WITH (NOLOCK)
 WHERE m.Codigo > @cursor
 ORDER BY m.Codigo ASC`

	consultaEventosPorDataHora = `
SELECT TOP (@limite)
       m.Codigo, m.CodigoPessoa, m.Inners, m.Origem,
       m.Complemento, m.Cartao, m.DataHora, m.CodigoLocal
  FROM dbo.Marcacao AS m WITH (NOLOCK)
 WHERE m.DataHora > @cursor
 ORDER BY m.DataHora ASC, m.Codigo ASC`
)

type Repo struct {
	db  *sql.DB
	cfg *config.Config
	// modoCursor resolvido: "codigo" ou "datahora".
	modoCursor string
}

func Abrir(ctx context.Context, cfg *config.Config) (*Repo, error) {
	db, err := sql.Open("sqlserver", cfg.Banco.String())
	if err != nil {
		return nil, fmt.Errorf("abrindo conexão: %w", err)
	}
	db.SetMaxOpenConns(3)
	db.SetMaxIdleConns(1)
	if err := db.PingContext(ctx); err != nil {
		db.Close()
		return nil, fmt.Errorf("conectando em %s: %w", cfg.Banco.Redigido(), err)
	}
	return &Repo{db: db, cfg: cfg}, nil
}

func (r *Repo) Fechar() error { return r.db.Close() }

func (r *Repo) Ping(ctx context.Context) error { return r.db.PingContext(ctx) }

// ModoCursor resolve "auto" olhando se dbo.Marcacao.Codigo é IDENTITY. Sendo
// identity, ele cresce na ordem de inserção e pega até marcação antiga que o
// equipamento descarregou depois — é o cursor preferido. Caso contrário
// caímos em DataHora, que exige varredura periódica da janela recente.
func (r *Repo) ModoCursor(ctx context.Context) string {
	if r.modoCursor != "" {
		return r.modoCursor
	}
	r.modoCursor = r.cfg.Coleta.Cursor
	if r.modoCursor != "auto" {
		return r.modoCursor
	}
	var ident sql.NullInt64
	err := r.db.QueryRowContext(ctx,
		`SELECT COLUMNPROPERTY(OBJECT_ID('dbo.Marcacao'), 'Codigo', 'IsIdentity')`).Scan(&ident)
	if err == nil && ident.Valid && ident.Int64 == 1 {
		r.modoCursor = "codigo"
	} else {
		r.modoCursor = "datahora"
	}
	return r.modoCursor
}

// MaiorCodigo devolve o maior Codigo já gravado, usado para posicionar o
// cursor em "inicio_em: agora".
func (r *Repo) MaiorCodigo(ctx context.Context) (string, error) {
	var v sql.NullInt64
	err := r.db.QueryRowContext(ctx, `SELECT MAX(Codigo) FROM dbo.Marcacao WITH (NOLOCK)`).Scan(&v)
	if err != nil {
		return "0", err
	}
	if !v.Valid {
		return "0", nil
	}
	return strconv.FormatInt(v.Int64, 10), nil
}

// BuscarMarcacoes lê uma página de marcações a partir do cursor.
func (r *Repo) BuscarMarcacoes(ctx context.Context, cursor string, limite int) ([]modelo.Marcacao, error) {
	consulta := strings.TrimSpace(r.cfg.Consultas.Eventos)
	modo := r.ModoCursor(ctx)
	if consulta == "" {
		if modo == "codigo" {
			consulta = consultaEventosPorCodigo
		} else {
			consulta = consultaEventosPorDataHora
		}
	}

	var pCursor any = cursor
	if modo == "codigo" {
		n, err := strconv.ParseInt(cursor, 10, 64)
		if err != nil {
			n = 0
		}
		pCursor = n
	}

	rows, err := r.db.QueryContext(ctx, consulta,
		sql.Named("limite", limite),
		sql.Named("cursor", pCursor),
	)
	if err != nil {
		return nil, fmt.Errorf("consultando marcações: %w", err)
	}
	defer rows.Close()

	cols, err := rows.Columns()
	if err != nil {
		return nil, err
	}
	var out []modelo.Marcacao
	for rows.Next() {
		vals := make([]sql.NullString, len(cols))
		ptrs := make([]any, len(cols))
		for i := range vals {
			ptrs[i] = &vals[i]
		}
		if err := rows.Scan(ptrs...); err != nil {
			return nil, fmt.Errorf("lendo linha de marcação: %w", err)
		}
		var m modelo.Marcacao
		for i, c := range cols {
			v := strings.TrimSpace(vals[i].String)
			switch strings.ToLower(c) {
			case "codigo":
				m.Codigo = v
			case "codigopessoa":
				m.CodigoPessoa = v
			case "inners":
				m.Inners = v
			case "origem":
				m.Origem = v
			case "complemento":
				m.Complemento = v
			case "cartao":
				m.Cartao = v
			case "datahora":
				m.DataHora = v
			case "codigolocal":
				m.CodigoLocal = v
			case "nome":
				m.Nome = v
			}
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

// BuscarAlunos roda a consulta de cadastro definida no config. Sem consulta
// configurada devolve nil — o nome da tabela de pessoas muda conforme a
// instalação, então nunca chutamos um SELECT aqui.
func (r *Repo) BuscarAlunos(ctx context.Context) ([]modelo.Aluno, error) {
	consulta := strings.TrimSpace(r.cfg.Consultas.Alunos)
	if consulta == "" {
		return nil, nil
	}
	rows, err := r.db.QueryContext(ctx, consulta)
	if err != nil {
		return nil, fmt.Errorf("consultando alunos: %w", err)
	}
	defer rows.Close()

	cols, err := rows.Columns()
	if err != nil {
		return nil, err
	}
	var out []modelo.Aluno
	for rows.Next() {
		vals := make([]sql.NullString, len(cols))
		ptrs := make([]any, len(cols))
		for i := range vals {
			ptrs[i] = &vals[i]
		}
		if err := rows.Scan(ptrs...); err != nil {
			return nil, err
		}
		a := modelo.Aluno{Ativo: true}
		for i, c := range cols {
			v := strings.TrimSpace(vals[i].String)
			switch strings.ToLower(c) {
			case "external_id", "codigo", "codigopessoa":
				a.IDExterno = v
			case "name", "nome":
				a.Nome = v
			case "class_name", "turma", "departamento", "setor":
				a.Turma = v
			case "card", "cartao":
				a.Cartao = v
			case "active", "ativo":
				a.Ativo = v != "" && v != "0" && !strings.EqualFold(v, "false") && !strings.EqualFold(v, "n")
			}
		}
		if a.IDExterno == "" {
			continue
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

// CodigoDesde devolve o Codigo imediatamente anterior à primeira marcação com
// DataHora >= datahora, para posicionar o cursor por data quando o modo é
// codigo.
func (r *Repo) CodigoDesde(ctx context.Context, datahora string) (string, error) {
	var v sql.NullInt64
	err := r.db.QueryRowContext(ctx,
		`SELECT MIN(Codigo) FROM dbo.Marcacao WITH (NOLOCK) WHERE DataHora >= @p1`,
		sql.Named("p1", datahora)).Scan(&v)
	if err != nil {
		return "0", err
	}
	if !v.Valid {
		// Nada nesse período ainda: começa do fim para não reprocessar o histórico.
		return r.MaiorCodigo(ctx)
	}
	return strconv.FormatInt(v.Int64-1, 10), nil
}
