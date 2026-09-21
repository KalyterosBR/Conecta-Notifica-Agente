// Package direcao traduz uma linha de dbo.Marcacao no evento que o SaaS
// espera, resolvendo entrada/saída e a data/hora sem fuso da catraca.
package direcao

import (
	"fmt"
	"strings"
	"time"

	"github.com/conecta/notifica-agent/internal/config"
	"github.com/conecta/notifica-agent/internal/modelo"
)

// ErrIgnorada indica marcação que o mapeamento manda descartar.
var ErrIgnorada = fmt.Errorf("marcação ignorada pelo mapeamento de direção")

type Mapeador struct {
	cfg *config.Config
}

func Novo(cfg *config.Config) *Mapeador { return &Mapeador{cfg: cfg} }

// Mapear converte a marcação em evento. Devolve ErrIgnorada quando a regra de
// direção manda descartar, e erro comum quando a linha está inconsistente.
func (m *Mapeador) Mapear(mc modelo.Marcacao) (modelo.Evento, error) {
	quando, err := m.quando(mc.DataHora)
	if err != nil {
		return modelo.Evento{}, err
	}
	if d := m.cfg.Coleta.IgnorarAntesDeDias; d > 0 {
		if quando.Before(time.Now().AddDate(0, 0, -d)) {
			return modelo.Evento{}, ErrIgnorada
		}
	}

	dir, err := m.direcao(mc)
	if err != nil {
		return modelo.Evento{}, err
	}

	aluno := mc.CodigoPessoa
	if aluno == "" || aluno == "0" {
		// Marcação de cartão não vinculado: o SaaS cadastra como pendente em
		// vez de perder o registro.
		aluno = "cartao:" + mc.Cartao
	}

	return modelo.Evento{
		IDExterno:      mc.ChaveNatural(),
		AlunoIDExterno: aluno,
		NomeAluno:      mc.Nome,
		Direcao:        dir,
		OcorridoEm:     quando,
		Cartao:         mc.Cartao,
		Equipamento:    mc.Inners,
		Local:          mc.CodigoLocal,
	}, nil
}

// quando interpreta o varchar(12) de DataHora no fuso da escola.
func (m *Mapeador) quando(bruto string) (time.Time, error) {
	s := strings.TrimSpace(bruto)
	if s == "" {
		return time.Time{}, fmt.Errorf("DataHora vazia")
	}
	t, err := time.ParseInLocation(m.cfg.Coleta.FormatoDataHora, s, m.cfg.Escola.Local())
	if err != nil {
		return time.Time{}, fmt.Errorf("DataHora %q não bate com o formato %q: %w",
			s, m.cfg.Coleta.FormatoDataHora, err)
	}
	return t, nil
}

func (m *Mapeador) direcao(mc modelo.Marcacao) (string, error) {
	d := m.cfg.Direcao
	if d.Modo == "fixo" {
		return d.Padrao, nil
	}

	var chave string
	switch d.Modo {
	case "local":
		chave = mc.CodigoLocal
	case "inner":
		chave = mc.Inners
	case "origem":
		chave = mc.Origem
	case "complemento":
		chave = mc.Complemento
	}

	if v, ok := d.Mapa[chave]; ok {
		if v == "ignorar" {
			return "", ErrIgnorada
		}
		return v, nil
	}
	if d.DescartarSemMapa {
		return "", ErrIgnorada
	}
	return d.Padrao, nil
}
