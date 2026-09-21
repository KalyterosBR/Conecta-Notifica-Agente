//go:build windows

package instalador

import (
	"fmt"
	"os/exec"

	// Garante o SSPI (login com a conta do Windows) no driver.
	_ "github.com/microsoft/go-mssqldb/integratedauth/winsspi"
	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/registry"
)

const raizSQL = `SOFTWARE\Microsoft\Microsoft SQL Server`

func elevado() bool {
	return windows.GetCurrentProcessToken().IsElevated()
}

// listarInstancias lê as instâncias locais do registro
// (Instance Names\SQL: nome -> id, ex. SQLEXPRESS -> MSSQL16.SQLEXPRESS).
func listarInstancias() []string {
	for _, acesso := range []uint32{
		registry.READ | registry.WOW64_64KEY,
		registry.READ | registry.WOW64_32KEY,
	} {
		k, err := registry.OpenKey(registry.LOCAL_MACHINE, raizSQL+`\Instance Names\SQL`, acesso)
		if err != nil {
			continue
		}
		nomes, err := k.ReadValueNames(0)
		k.Close()
		if err == nil && len(nomes) > 0 {
			return nomes
		}
	}
	return nil
}

func idDaInstancia(instancia string) string {
	for _, acesso := range []uint32{
		registry.READ | registry.WOW64_64KEY,
		registry.READ | registry.WOW64_32KEY,
	} {
		k, err := registry.OpenKey(registry.LOCAL_MACHINE, raizSQL+`\Instance Names\SQL`, acesso)
		if err != nil {
			continue
		}
		id, _, err := k.GetStringValue(instancia)
		k.Close()
		if err == nil {
			return id
		}
	}
	return ""
}

// prepararServidor garante, direto no registro: TCP habilitado, porta
// dinâmica ativa e autenticação mista (LoginMode = 2). Devolve se algo
// mudou (aí precisa reiniciar o serviço) e avisos para o usuário.
func prepararServidor(instancia string) (mudou bool, avisos []string) {
	id := idDaInstancia(instancia)
	if id == "" {
		return false, []string{"instância não encontrada no registro; configure TCP/autenticação pelo SQL Server Configuration Manager."}
	}
	abrir := func(sub string) (registry.Key, error) {
		return registry.OpenKey(registry.LOCAL_MACHINE,
			fmt.Sprintf(`%s\%s\%s`, raizSQL, id, sub), registry.READ|registry.WRITE)
	}

	// autenticação mista
	if k, err := abrir(`MSSQLServer`); err == nil {
		if v, _, err := k.GetIntegerValue("LoginMode"); err != nil || v != 2 {
			if err := k.SetDWordValue("LoginMode", 2); err == nil {
				mudou = true
				avisos = append(avisos, "autenticação mista habilitada (era só Windows).")
			} else {
				avisos = append(avisos, "não consegui habilitar autenticação mista: "+err.Error())
			}
		}
		k.Close()
	} else {
		avisos = append(avisos, "sem acesso ao registro do SQL Server: "+err.Error())
	}

	// TCP habilitado
	if k, err := abrir(`MSSQLServer\SuperSocketNetLib\Tcp`); err == nil {
		if v, _, err := k.GetIntegerValue("Enabled"); err != nil || v != 1 {
			if err := k.SetDWordValue("Enabled", 1); err == nil {
				mudou = true
				avisos = append(avisos, "protocolo TCP/IP habilitado (estava desligado).")
			} else {
				avisos = append(avisos, "não consegui habilitar TCP/IP: "+err.Error())
			}
		}
		k.Close()
	}

	// porta dinâmica ativa (o agente descobre via SQL Browser)
	if k, err := abrir(`MSSQLServer\SuperSocketNetLib\Tcp\IPAll`); err == nil {
		din, _, _ := k.GetStringValue("TcpDynamicPorts")
		fixa, _, _ := k.GetStringValue("TcpPort")
		if din == "" && fixa == "" {
			if err := k.SetStringValue("TcpDynamicPorts", "0"); err == nil {
				mudou = true
				avisos = append(avisos, "porta dinâmica ativada.")
			}
		}
		k.Close()
	}

	// SQL Browser: necessário para instância nomeada com porta dinâmica
	if instancia != "MSSQLSERVER" {
		exec.Command("sc", "config", "SQLBrowser", "start=", "auto").Run()
		if err := exec.Command("net", "start", "SQLBrowser").Run(); err == nil {
			avisos = append(avisos, "serviço SQL Browser iniciado.")
		}
	}
	return mudou, avisos
}

func nomeServico(instancia string) string {
	if instancia == "MSSQLSERVER" {
		return "MSSQLSERVER"
	}
	return "MSSQL$" + instancia
}

func reiniciarSQLServer(instancia string) []string {
	svc := nomeServico(instancia)
	var avisos []string
	if out, err := exec.Command("net", "stop", svc, "/y").CombinedOutput(); err != nil {
		avisos = append(avisos, "parar "+svc+": "+string(out))
	}
	if out, err := exec.Command("net", "start", svc).CombinedOutput(); err != nil {
		avisos = append(avisos, "iniciar "+svc+": "+string(out))
	} else {
		avisos = append(avisos, "SQL Server reiniciado.")
	}
	return avisos
}

// dsnIntegrado monta a conexão com a conta do Windows (SSPI).
func dsnIntegrado(servidor, instancia string, porta int) string {
	host := servidor
	if instancia != "" {
		host = servidor + `\` + instancia
	} else if porta > 0 {
		host = fmt.Sprintf("%s,%d", servidor, porta)
	}
	return fmt.Sprintf(
		"server=%s;database=master;trusted_connection=yes;encrypt=disable;app name=Conecta Notifica Instalador;connection timeout=10",
		host)
}
