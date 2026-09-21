// Package painel implementa a janela de operação do agente.
//
// As ações são recebidas do programa principal para que a interface não tenha
// acesso direto ao banco da catraca nem conheça segredos da configuração.
package painel

type Acoes struct {
	Resumo            func() string
	Testar            func() (string, error)
	InstalarServico   func() error
	IniciarServico    func() error
	PararServico      func() error
	AbrirConfiguracao func() error
	GerarDiagnostico  func() (string, error)
	AbrirPasta        func() error
}
