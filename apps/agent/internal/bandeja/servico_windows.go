//go:build windows

package bandeja

import (
	"errors"
	"time"

	"github.com/conecta/notifica-agent/internal/estado"
	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/svc"
	"golang.org/x/sys/windows/svc/mgr"
)

func consultarServico() (svc.State, error) {
	// O monitor só precisa consultar. Não pedir acesso para iniciar/parar.
	h, err := windows.OpenSCManager(nil, nil, windows.SC_MANAGER_CONNECT)
	if err != nil {
		return 0, err
	}
	m := &mgr.Mgr{Handle: h}
	defer m.Disconnect()
	nome, err := windows.UTF16PtrFromString("ConectaNotificaAgent")
	if err != nil {
		return 0, err
	}
	sh, err := windows.OpenService(h, nome, windows.SERVICE_QUERY_STATUS)
	if err != nil {
		return 0, err
	}
	s := &mgr.Service{Handle: sh}
	defer s.Close()
	st, err := s.Query()
	return st.State, err
}

func resumoMonitor(e estado.Estado, erroEstado error, servico svc.State, erroServico error, agora time.Time) (string, bool) {
	if errors.Is(erroServico, windows.ERROR_SERVICE_DOES_NOT_EXIST) {
		return "Desconectado — serviço não instalado", false
	}
	if erroServico != nil {
		return "Não foi possível verificar o serviço", false
	}
	if servico != svc.Running {
		return "Desconectado — serviço parado ou em transição", false
	}
	if erroEstado != nil {
		return "Aguardando atualização do estado do agente", false
	}
	return e.Resumo(agora, limiteFrescor)
}
