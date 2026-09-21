//go:build !windows

package instalador

// Fora do Windows (dev/teste) o assistente roda em modo degradado: sem
// registro, sem serviços e sem autenticação integrada — cai nos caminhos
// manuais, que é exatamente o que queremos exercitar em desenvolvimento.

func elevado() bool                    { return true }
func listarInstancias() []string       { return nil }
func prepararServidor(string) (bool, []string) {
	return false, []string{"preparo automático só existe no Windows."}
}
func reiniciarSQLServer(string) []string { return nil }
func dsnIntegrado(string, string, int) string { return "" }
