// Package modelo define as estruturas trocadas entre o agente e o SaaS.
package modelo

import "time"

// Marcacao é uma linha crua de dbo.Marcacao. Todos os campos vêm como texto
// porque a consulta é sobrescrevível pelo config e o tipo de cada coluna pode
// variar entre versões do software da catraca.
type Marcacao struct {
	Codigo       string
	CodigoPessoa string
	Inners       string
	Origem       string
	Complemento  string
	Cartao       string
	DataHora     string
	CodigoLocal  string
	Nome         string // opcional, só quando a consulta faz join com a tabela de pessoas
}

// ChaveNatural reproduz a PK composta de dbo.Marcacao
// (Inners, Complemento, Cartao, DataHora). É o external_event_id enviado ao
// SaaS e a base do dedupe idempotente do lado do servidor.
func (m Marcacao) ChaveNatural() string {
	return m.Inners + "|" + m.Complemento + "|" + m.Cartao + "|" + m.DataHora
}

// Evento é o payload que o SaaS recebe.
type Evento struct {
	IDExterno      string    `json:"external_event_id"`
	AlunoIDExterno string    `json:"external_student_id"`
	NomeAluno      string    `json:"student_name,omitempty"`
	Direcao        string    `json:"direction"` // in | out
	OcorridoEm     time.Time `json:"occurred_at"`
	Cartao         string    `json:"card,omitempty"`
	Equipamento    string    `json:"device_id,omitempty"`
	Local          string    `json:"location_id,omitempty"`
}

// Aluno é a linha da sincronização de cadastro.
type Aluno struct {
	IDExterno string `json:"external_id"`
	Nome      string `json:"name"`
	Turma     string `json:"class_name,omitempty"`
	Cartao    string `json:"card,omitempty"`
	Ativo     bool   `json:"active"`
}

// Heartbeat informa ao painel que o agente está vivo.
type Heartbeat struct {
	Versao        string    `json:"version"`
	Cursor        string    `json:"cursor"`
	Pendentes     int       `json:"pending"`
	BancoOK       bool      `json:"db_ok"`
	UltimoErro    string    `json:"last_error,omitempty"`
	UltimoEventoEm time.Time `json:"last_event_at,omitempty"`
	EnviadosHoje  int64     `json:"sent_today"`
}

// RespostaLote é o retorno de POST /v1/agent/events.
type RespostaLote struct {
	Aceitos    int `json:"accepted"`
	Duplicados int `json:"duplicates"`
}
