// Package banco fala com o SQL Server da escola. Acesso é sempre somente
// leitura: nenhuma consulta aqui escreve na base da catraca.
package banco

import (
	"context"
	"database/sql"
	"fmt"
	"regexp"
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
	if consulta != "" {
		if err := validarConsultaSomenteLeitura(consulta); err != nil {
			return nil, fmt.Errorf("consulta de eventos: %w", err)
		}
	}
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
	if err := validarConsultaSomenteLeitura(consulta); err != nil {
		return nil, fmt.Errorf("consulta de alunos: %w", err)
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

// ConsultaAlunosSugerida descobre a tabela ligada a Marcacao.CodigoPessoa e
// monta um SELECT somente de leitura quando o esquema tem Codigo e Nome.
// Não interpreta colunas de validade: nesses casos pede revisão explícita.
func (r *Repo) ConsultaAlunosSugerida(ctx context.Context) (string, string, error) {
	var schema, tabela string
	err := r.db.QueryRowContext(ctx, `
SELECT TOP (1) rs.name, rt.name
  FROM sys.foreign_keys fk
  JOIN sys.foreign_key_columns fkc ON fkc.constraint_object_id = fk.object_id
  JOIN sys.columns pc ON pc.object_id = fkc.parent_object_id AND pc.column_id = fkc.parent_column_id
  JOIN sys.tables rt ON rt.object_id = fkc.referenced_object_id
  JOIN sys.schemas rs ON rs.schema_id = rt.schema_id
 WHERE fk.parent_object_id = OBJECT_ID(N'dbo.Marcacao')
   AND pc.name = N'CodigoPessoa'
 ORDER BY CASE WHEN rs.name = N'dbo' AND rt.name = N'Pessoas' THEN 0 ELSE 1 END, rs.name, rt.name`).Scan(&schema, &tabela)
	if err != nil {
		// Algumas instalações não declaram a FK. Só usamos dbo.Pessoas se ela
		// existir; caso contrário, pedimos descoberta/manual sem inventar tabela.
		err = r.db.QueryRowContext(ctx, `SELECT s.name, t.name FROM sys.tables t JOIN sys.schemas s ON s.schema_id=t.schema_id WHERE s.name=N'dbo' AND t.name=N'Pessoas'`).Scan(&schema, &tabela)
		if err != nil {
			return "", "Não encontrei tabela referenciada pela FK de Marcacao.CodigoPessoa nem dbo.Pessoas.", fmt.Errorf("não foi possível identificar a tabela de pessoas: %w", err)
		}
	}

	rows, err := r.db.QueryContext(ctx, `
SELECT c.name FROM sys.columns c
JOIN sys.tables t ON t.object_id=c.object_id
JOIN sys.schemas s ON s.schema_id=t.schema_id
WHERE s.name=@schema AND t.name=@tabela`, sql.Named("schema", schema), sql.Named("tabela", tabela))
	if err != nil {
		return "", "", fmt.Errorf("lendo colunas do cadastro: %w", err)
	}
	defer rows.Close()
	colunas := map[string]string{}
	for rows.Next() {
		var nome string
		if err := rows.Scan(&nome); err != nil {
			return "", "", err
		}
		colunas[strings.ToLower(nome)] = nome
	}
	if err := rows.Err(); err != nil {
		return "", "", err
	}
	pegar := func(opcoes ...string) string {
		for _, op := range opcoes {
			if v := colunas[strings.ToLower(op)]; v != "" {
				return v
			}
		}
		return ""
	}
	codigo, nome := pegar("Codigo", "Id", "IDPessoa", "CodigoPessoa"), pegar("Nome", "NomeCompleto", "Pessoa")
	if codigo == "" || nome == "" {
		return "", "", fmt.Errorf("a tabela %s.%s não tem colunas reconhecidas para identificador e nome; revise o esquema manualmente", schema, tabela)
	}
	ident := func(v string) string { return "[" + strings.ReplaceAll(v, "]", "]]" ) + "]" }
	// Evita interpretar Status/validade de forma ambígua. Uma coluna Ativo
	// explícita pode ser mapeada; demais casos mantêm active=1 para revisão.
	campos := []string{"p." + ident(codigo) + " AS external_id", "p." + ident(nome) + " AS nome"}
	if turma := pegar("Turma", "Departamento", "Setor"); turma != "" {
		campos = append(campos, "p."+ident(turma)+" AS turma")
	} else {
		campos = append(campos, "'' AS turma")
	}
	if cartao := pegar("Cartao", "Cartão"); cartao != "" {
		campos = append(campos, "p."+ident(cartao)+" AS cartao")
	} else {
		campos = append(campos, "'' AS cartao")
	}
	if ativo := pegar("Ativo"); ativo != "" {
		campos = append(campos, "p."+ident(ativo)+" AS ativo")
	} else {
		campos = append(campos, "1 AS ativo")
	}
	consulta := "SELECT " + strings.Join(campos, ",\n       ") + "\n  FROM " + ident(schema) + "." + ident(tabela) + " AS p"
	aviso := fmt.Sprintf("Tabela reconhecida: %s.%s. Revise a regra de validade antes de ativar sincronização automática.", schema, tabela)
	if pegar("DataInicio") != "" || pegar("DataFim") != "" || pegar("ControlaValidade") != "" {
		aviso += " Foram encontradas colunas de validade, cuja interpretação não será presumida."
	}
	return consulta, aviso, nil
}

// ValidarConsultaAlunosCompilacao confirma permissões e colunas sem retornar
// dados de pessoas: TOP (0) compila a consulta e não entrega linhas.
func (r *Repo) ValidarConsultaAlunosCompilacao(ctx context.Context, consulta string) error {
	if err := validarConsultaSomenteLeitura(consulta); err != nil {
		return err
	}
	rows, err := r.db.QueryContext(ctx, "SELECT TOP (0) * FROM ("+consulta+") AS consulta_alunos_validacao")
	if err != nil {
		return fmt.Errorf("validando consulta sem ler registros: %w", err)
	}
	return rows.Close()
}

var palavrasDeEscrita = regexp.MustCompile(`(?i)\b(insert|update|delete|merge|exec|execute|into|create|alter|drop|truncate|grant|revoke|deny|backup|restore|dbcc)\b`)

// validarConsultaSomenteLeitura limita as consultas configuráveis a um único
// SELECT simples. O usuário SQL deve continuar com permissão somente de
// leitura; esta validação é uma segunda barreira contra SQL de escrita.
func validarConsultaSomenteLeitura(consulta string) error {
	consulta = strings.TrimSpace(consulta)
	if !strings.HasPrefix(strings.ToLower(consulta), "select ") {
		return fmt.Errorf("somente uma consulta SELECT é permitida")
	}
	if strings.ContainsAny(consulta, ";") || strings.Contains(consulta, "--") || strings.Contains(consulta, "/*") || strings.Contains(consulta, "*/") {
		return fmt.Errorf("a consulta não pode conter comandos múltiplos nem comentários SQL")
	}
	if palavrasDeEscrita.MatchString(consulta) {
		return fmt.Errorf("a consulta contém palavra reservada que não é permitida em leitura")
	}
	return nil
}

// ValidarConsultaSomenteLeitura valida SQL configurável sem abrir conexão.
func ValidarConsultaSomenteLeitura(consulta string) error {
	return validarConsultaSomenteLeitura(consulta)
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
