# Instalar o agente na máquina da escola (Windows)

## O caminho normal: o instalador

Baixe o instalador oficial `ConectaNotifica-Agente-<versão>.exe` na página de
releases do GitHub, copie para a máquina da escola e dê dois cliques. Não use
artefatos identificados como `TESTE` ou versões com `-dev`: são compilações de
validação. Veja [VERSOES.md](VERSOES.md) para o processo de publicação.
São quatro telas de "Avançar":

1. **Pasta** — `C:\ConectaNotifica` por padrão.
2. **Conta da escola** — o endereço do Conecta Notifica e a **chave da
   escola** (`cn_...`), que estão no painel em *Primeiros passos*. A chave
   aparece uma vez só; se perdeu, gere outra lá.
3. **Banco da catraca** — **já vem preenchido**. Ao abrir a tela, o
   instalador procura as instâncias do SQL Server no registro do Windows e,
   com a conta de quem está instalando, lista os bancos que têm a tabela
   `dbo.Marcacao` — a assinatura do banco da catraca. Instância, servidor,
   porta e banco chegam escolhidos; os combos deixam trocar. Mudou a
   instância? "Procurar bancos" recarrega a lista daquela instância.
4. **Usuário de leitura** — `notifica_ro` e a senha, na mesma tela.

Há ainda a opção de deixar o **ícone de status ao lado do relógio**, que sobe
com o Windows.

Ao concluir, o instalador grava o `config.yaml`, registra o serviço do
Windows, inicia e testa banco e SaaS. Se o teste falhar, ele avisa e **deixa a
instalação de pé**: o serviço tenta de novo sozinho quando a rede voltar.

> **Antes**, no SSMS: rode `scripts\usuario-somente-leitura.sql` para criar o
> usuário de leitura. O agente nunca escreve no banco da catraca.

Desinstalar pelo Painel de Controle para o serviço e o remove.

## Se preferir na mão

O `.exe` do agente sozinho também resolve: dois cliques abrem a **Central do
agente**, com status, teste de conexões, controles do serviço e diagnóstico.
Para a primeira configuração use o instalador; o menu de texto continua
disponível como `notifica-agent.exe menu` para suporte. Para script, o modo
não interativo:

```bat
notifica-agent configurar ^
  -url https://painel.conectapontoeacesso.com.br/api ^
  -api-key cn_xxxxxxxx ^
  -escola "Escola Municipal X" ^
  -servidor localhost -instancia SQLEXPRESS ^
  -database CatracaDB -usuario notifica_ro -senha "..." ^
  -testar
notifica-agent instalar
notifica-agent iniciar
```

`configurar` valida antes de escrever (chave sem `cn_`, endereço sem
`https://`, instância e porta ambas vazias) e guarda um `.bak` do arquivo
anterior — reconfigurar não custa a configuração que funcionava.

## O ícone ao lado do relógio

`notifica-agent bandeja` abre o monitor: um ícone na área de notificação que
mostra, no tooltip e no menu do botão direito, se o agente está conectado,
quantos giros estão na fila e quantos saíram hoje. Duplo clique ou a opção
"Abrir central do agente" abre a Central C# instalada; builds sem a Central
continuam usando o painel local no navegador como fallback. O menu também tem
"Abrir a pasta do agente", "Testar conexões" e "Sair".

Ele **não** fala com o banco nem com o SaaS: lê o `dados/estado.json` que o
serviço publica a cada heartbeat. Por isso funciona mesmo com o serviço
rodando na sessão 0, onde nada pode ser desenhado na tela — e por isso um
arquivo velho aparece como "serviço parado" em vez de "conectado".

## Conferir depois

- `notifica-agent status` — estado do serviço.
- `notifica-agent detectar` — lista as instâncias e os bancos com marcações.
- `notifica-agent testar` — banco e SaaS, com a mensagem exata do que falhou.
- No painel, *Primeiros passos*: o passo do agente fecha sozinho no primeiro
  sinal que chegar.
- `logs\agente.log` na pasta de instalação.

## Compilar o instalador

Precisa de Windows com [Inno Setup 6](https://jrsoftware.org/isdl.php):

```bat
make windows
iscc instalador\conecta-notifica.iss /DVersao=1.0.0
```

O CI faz isso a cada push em `apps/agent` e a cada release publicada
(`.github/workflows/agente.yml`).

---

## Apêndice: teste em rede local

## Antes de ir para a escola

Na sua máquina (esta), deixe rodando:

```sh
cd apps/api && npm run db:dev      # terminal 1 — Postgres embutido
cd apps/api && npm run start:dev   # terminal 2 — API em :3001
cd apps/web && npm run dev         # terminal 3 — painel em :3000
```

Abra http://localhost:3000 e entre com `direcao@escolademo.dev` /
`demo1234`. Deixe a **Visão geral** aberta — é nela que o giro vai aparecer.

> Para um teste na rede local, o agente aponta para o IP desta máquina
> (`ipconfig getifaddr en0`) na porta 3001, e o firewall do macOS precisa
> liberar conexões de entrada para o node. Em produção o agente usa a URL
> fixa da VPS — veja `deploy/LEIA-ME.md`.

## Na máquina Windows da escola

1. **Copiar arquivos** — crie `C:\ConectaNotifica\` e copie para lá:
   - `apps/agent/bin/notifica-agent.exe`
   - `apps/agent/config.example.yaml` renomeado para `config.yaml`

2. **Usuário de banco somente leitura** — no SSMS, rode
   `scripts/usuario-somente-leitura.sql` (ajuste o nome do database e a
   senha antes).

3. **Preencher o `config.yaml`** — o mínimo:

   ```yaml
   escola:
     nome: "Nome da Escola"

   banco:
     servidor: "localhost"
     instancia: "SQLEXPRESS"        # ou porta: 1433, conforme a instalação
     database: "NomeDoBancoDaCatraca"
     usuario: "notifica_ro"
     senha: "a-senha-do-passo-2"

   saas:
     base_url: "https://painel.conectapontoeacesso.com.br/api"
     api_key: "cn_..."   # a chave impressa pelo `npm run criar-escola`
   ```

   (Em teste na rede local: `base_url: "http://SEU-IP:3001"` e a chave do
   seed, que o `prisma/seed.ts` imprime ao rodar.)

   A direção do giro já vem certa por padrão (Complemento 1 = entrada,
   0 = saída).

4. **Reconhecer o banco** (prompt de comando em `C:\ConectaNotifica`):

   ```bat
   notifica-agent.exe descobrir -config config.yaml > descoberta.txt
   ```

   Confira no `descoberta.txt`: se `Codigo` é IDENTITY (bloco 1) e o
   formato do `DataHora` (bloco 2 — 12 caracteres = YYMMDDHHMMSS, que é o
   padrão). Traga esse arquivo: ele fecha as duas pendências que restam.

5. **Testar a ponta a ponta**:

   ```bat
   notifica-agent.exe testar -config config.yaml
   ```

   Deve imprimir `banco ok`, `marcações ok` e `saas ok`. Nesse momento o
   card **Agente** da Visão geral já fica verde (heartbeat).

6. **Rodar e ver o giro chegar** — primeiro em primeiro plano, para ver o log:

   ```bat
   notifica-agent.exe run -config config.yaml
   ```

   Passe um cartão na catraca: em até ~12s (polling 7s + envio 5s) o acesso
   aparece em **Últimos acessos** na tela inicial, e o contador "giros hoje"
   sobe. O aluno do cartão é criado automaticamente como pendência.

7. **Instalar como serviço** (prompt como **Administrador**), quando o teste
   estiver ok:

   ```bat
   notifica-agent.exe instalar -config C:\ConectaNotifica\config.yaml
   notifica-agent.exe iniciar
   notifica-agent.exe status
   ```

   O serviço sobe sozinho com o Windows e reconecta se o SQL Server demorar.

## Se algo não aparecer

| Sintoma | Onde olhar |
|---|---|
| `testar` falha no banco | credencial/instância no `config.yaml`; TCP/IP habilitado no SQL Server Configuration Manager |
| `testar` falha no saas | IP certo? firewall do macOS? as duas máquinas na mesma rede? |
| Agente online mas nada chega | `coleta.inicio_em: agora` só pega giros novos — passe um cartão **depois** de subir o agente |
| Giro não vira notificação | esperado por enquanto: WhatsApp ainda não conectado (fica `FAILED` para reenvio) |
| Log do serviço | `C:\ConectaNotifica\logs\agente.log` |

O buffer local fica em `C:\ConectaNotifica\dados\` — internet caiu, nada se
perde; apagou a pasta, o agente recomeça de agora.
