//go:build !windows

// Package bandeja mostra o ícone de status ao lado do relógio do Windows.
package bandeja

import "errors"

// Rodar só existe no Windows; fora dele o comando avisa em vez de fingir.
func Rodar(dirDados, exe, central string) error {
	return errors.New("o ícone ao lado do relógio só existe no Windows")
}
