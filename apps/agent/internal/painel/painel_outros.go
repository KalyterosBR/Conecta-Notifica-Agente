//go:build !windows

package painel

import "errors"

func Rodar(Acoes) error {
	return errors.New("a central gráfica do agente só está disponível no Windows")
}
