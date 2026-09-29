VERSAO ?= $(shell git describe --tags --always 2>/dev/null || echo dev)
LDFLAGS := -s -w -X main.Versao=$(VERSAO)

.PHONY: build resources windows gui-windows instalador tidy vet test limpar

build:
	go build -ldflags "$(LDFLAGS)" -o bin/notifica-agent ./cmd/agent

resources:
	cd cmd/agent && go run github.com/josephspurrier/goversioninfo/cmd/goversioninfo@v1.5.0 -64 -o resource_windows_amd64.syso versioninfo.json

# Núcleo operacional distribuído ao lado da Central C#. Sem -s -w de
# propósito: binário com símbolos dispara bem menos falso positivo no
# Defender/SmartScreen.
windows: resources
	GOOS=windows GOARCH=amd64 CGO_ENABLED=0 \
	go build -ldflags "-H=windowsgui -X main.Versao=$(VERSAO)" -o bin/notifica-core.exe ./cmd/agent

gui-windows:
	dotnet publish gui/ConectaNotificaAgente.csproj -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -o bin/gui-publish
	cp bin/gui-publish/ConectaNotificaAgente.exe bin/ConectaNotificaAgente.exe

# Instalador do Windows. Só compila em Windows com Inno Setup 6 instalado;
# no dia a dia quem gera é o CI (.github/workflows/agente.yml).
instalador: windows gui-windows
	iscc instalador/conecta-notifica.iss /DVersao=$(VERSAO)

tidy:
	go mod tidy

vet:
	go vet ./...

test:
	go test ./...

limpar:
	rm -rf bin

# Assinatura do executável (rodar num Windows com o certificado, ou via
# assinatura em nuvem do provedor). Elimina SmartScreen com o tempo e
# libera o Smart App Control de imediato.
#   signtool sign /fd SHA256 /td SHA256 /tr http://timestamp.digicert.com \
#     /a bin\notifica-agent.exe
# Com Azure Trusted Signing: usar a action/CLI `trusted-signing-cli` no CI.
