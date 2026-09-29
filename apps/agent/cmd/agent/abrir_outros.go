//go:build !windows

package main

import "fmt"

func abrirAlvo(string) error { return fmt.Errorf("abrir arquivo só está disponível no Windows") }
