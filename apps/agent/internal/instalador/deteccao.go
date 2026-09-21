package instalador

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"sort"
	"strings"
	"time"
)

// Instancia é um SQL Server encontrado nesta máquina.
type Instancia struct {
	Servidor  string
	Instancia string
	Porta     int
}

// Rotulo é como a instância aparece para quem escolhe.
func (i Instancia) Rotulo() string {
	if i.Instancia != "" {
		return i.Servidor + `\` + i.Instancia
	}
	return fmt.Sprintf("%s,%d", i.Servidor, i.Porta)
}

// Deteccao é o que o instalador do Windows precisa para já vir preenchido.
type Deteccao struct {
	Instancias []Instancia
	// Bancos com a tabela dbo.Marcacao — os candidatos a banco da catraca.
	Bancos []string
	// Melhor palpite, usado como valor inicial dos campos.
	Escolhida Instancia
	Database  string
	// Explica o que não deu certo, sem impedir a instalação manual.
	Aviso string
}

// Detectar varre o registro do Windows atrás de instâncias e, com a conta do
// Windows de quem está instalando, procura os bancos que têm dbo.Marcacao.
//
// Nunca falha: o que não descobrir vira Aviso e a tela pede na mão. É melhor
// preencher três campos de quatro do que exigir os quatro.
func Detectar() Deteccao {
	var d Deteccao
	for _, nome := range listarInstancias() {
		d.Instancias = append(d.Instancias, Instancia{Servidor: "localhost", Instancia: nome})
	}
	if len(d.Instancias) == 0 {
		// Sem instância nomeada ainda pode haver SQL Server na porta padrão.
		d.Instancias = append(d.Instancias, Instancia{Servidor: "localhost", Porta: 1433})
		d.Aviso = "nenhuma instância encontrada no registro; usando localhost:1433 como palpite"
	}
	d.Escolhida = d.Instancias[0]

	// Só uma instância vale a tentativa de conectar: com várias, quem escolhe
	// é a pessoa, e a tela recarrega os bancos quando ela troca.
	d.Bancos, d.Database = bancosDaInstancia(d.Escolhida)
	if len(d.Bancos) == 0 && d.Aviso == "" {
		d.Aviso = "não consegui listar os bancos com a conta do Windows; informe o nome na tela"
	}
	return d
}

// BancosDe expõe a busca para uma instância específica — é o que a tela chama
// quando a pessoa troca a instância no combo.
func BancosDe(i Instancia) ([]string, string) { return bancosDaInstancia(i) }

func bancosDaInstancia(i Instancia) (bancos []string, melhor string) {
	dsn := dsnIntegrado(i.Servidor, i.Instancia, i.Porta)
	if dsn == "" {
		return nil, ""
	}
	db, err := sql.Open("sqlserver", dsn)
	if err != nil {
		return nil, ""
	}
	defer db.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	if err := db.PingContext(ctx); err != nil {
		return nil, ""
	}
	bancos = bancosComMarcacao(ctx, db)
	if len(bancos) > 0 {
		melhor = bancos[0]
	}
	return bancos, melhor
}

// bancosComMarcacao lista os bancos que têm dbo.Marcacao — é a assinatura do
// banco da catraca, e o que separa o banco certo dos outros do servidor.
func bancosComMarcacao(ctx context.Context, db *sql.DB) []string {
	rows, err := db.QueryContext(ctx, `
		SELECT name FROM sys.databases
		 WHERE state = 0 AND database_id > 4 ORDER BY name`)
	if err != nil {
		return nil
	}
	defer rows.Close()
	var nomes []string
	for rows.Next() {
		var n string
		if rows.Scan(&n) == nil {
			nomes = append(nomes, n)
		}
	}

	var comMarcacao []string
	for _, n := range nomes {
		var tem sql.NullInt64
		q := fmt.Sprintf(`SELECT OBJECT_ID('%s.dbo.Marcacao')`, strings.ReplaceAll(n, "'", "''"))
		if db.QueryRowContext(ctx, q).Scan(&tem) == nil && tem.Valid {
			comMarcacao = append(comMarcacao, n)
		}
	}
	sort.Strings(comMarcacao)
	return comMarcacao
}

// EscreverINI grava a detecção no formato que o Inno Setup lê nativamente
// (GetIniString), evitando um parser de JSON no script do instalador.
func (d Deteccao) EscreverINI(caminho string) error {
	var b strings.Builder
	b.WriteString("[deteccao]\n")
	rotulos := make([]string, 0, len(d.Instancias))
	for _, i := range d.Instancias {
		rotulos = append(rotulos, i.Rotulo())
	}
	// Listas separadas por | porque nome de instância não contém a barra.
	b.WriteString("instancias=" + strings.Join(rotulos, "|") + "\n")
	b.WriteString("bancos=" + strings.Join(d.Bancos, "|") + "\n")
	b.WriteString("servidor=" + d.Escolhida.Servidor + "\n")
	b.WriteString("instancia=" + d.Escolhida.Instancia + "\n")
	b.WriteString(fmt.Sprintf("porta=%d\n", d.Escolhida.Porta))
	b.WriteString("database=" + d.Database + "\n")
	b.WriteString("aviso=" + strings.ReplaceAll(d.Aviso, "\n", " ") + "\n")
	return os.WriteFile(caminho, []byte(b.String()), 0o644)
}

// SepararRotulo desfaz o Rotulo: "localhost\SQLEXPRESS" ou "servidor,1433".
func SepararRotulo(s string) Instancia {
	instancia, servidor, porta := separarEndereco(strings.TrimSpace(s))
	return Instancia{Servidor: servidor, Instancia: instancia, Porta: porta}
}
