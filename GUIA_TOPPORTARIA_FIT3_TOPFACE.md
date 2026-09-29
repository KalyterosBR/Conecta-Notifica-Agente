# Guia técnico: diagnóstico de catracas Topdata e leitores faciais Topdata

Este guia orienta técnicos a investigar problemas de comunicação entre o TopPortaria, o Gerenciador de Inners, catracas Topdata, leitores faciais Topdata, serviços do Windows, SQL Server e Firewall. Os passos descrevem verificações e correções observadas em uma instalação real; portas, telas, nomes de serviço, caminhos e comportamentos podem variar conforme modelo, versão e opções instaladas.

> **Antes de começar:** substitua os valores entre `<...>` pelos dados confirmados no computador atendido. Não copie IPs, nomes de instância, números de série ou caminhos do exemplo sem verificá-los localmente. Os valores do caso original estão reunidos na seção [Referência do caso documentado](#referência-do-caso-documentado).

## 1. Dados a levantar na instalação

Registre os dados abaixo antes de executar os passos. Confirme o IPv4 do servidor com `ipconfig`, os IPs na tela de rede dos equipamentos e os caminhos reais no computador. Evite publicar números de série, nomes de pessoas, endereços ou logs identificáveis em chamados externos.

| Dado | Valor desta instalação |
|---|---|
| IPv4 do servidor na rede dos equipamentos | `<IP_SERVIDOR>` |
| Modelo e IP da catraca Topdata | `<MODELO>` / `<IP_CATRACA>` |
| IP do leitor facial | `<IP_FACIAL>` |
| Porta de comunicação da catraca | `<PORTA_CATRACA>` (no caso documentado: `3570`; confirme para o modelo/instalação) |
| Porta do serviço facial | `7792` (confirme no produto/configuração) |
| Nome do serviço da catraca | `TopPortariaService` (confirme no Windows) |
| Nome do serviço facial | `TopFaceService` (confirme no Windows) |
| Instância SQL Server | `<SERVIDOR>\<INSTANCIA>` |
| Banco do TopPortaria | `<BANCO>` |
| Pasta de instalação TopPortaria | `<PASTA_TOPPORTARIA>` |
| Pasta de instalação TopFace | `<PASTA_TOPFACE>` |

Os exemplos usam portas `3570` e `7792`, nomes de serviço e estrutura de instalação confirmados no caso documentado. Não são valores universais para todo modelo Topdata. Confirme portas, nomes e caminhos na configuração e nos serviços presentes antes de executar comandos que alteram o sistema.

## 2. Diagnóstico rápido

1. No servidor, confirme o endereço IPv4 correto e faça ping no equipamento. Ping testa ICMP, não a disponibilidade da porta TCP.
2. Consulte a porta com `netstat -ano`; identifique o PID e o executável antes de alterar serviços.
3. Verifique estado e caminho dos serviços com `Get-Service` e `sc.exe`.
4. Para o facial, confirme que o serviço escuta na porta e que o equipamento tenta conectar ao IPv4 do servidor.
5. Se a tentativa chega ao servidor mas não estabelece sessão, capture o tráfego com `pktmon` e procure evidência de descarte pelo Firewall.
6. Se há comunicação, mas o facial não aparece associado à catraca, confira o cadastro pela interface do TopPortaria e os logs. Use consultas SQL somente de leitura para investigar.

## 3. Arquitetura e responsabilidades

- No caso documentado, a catraca Fit 3 iniciou conexão com o computador servidor pela TCP `3570`. Confirme para cada modelo e instalação qual equipamento inicia a conexão e qual porta está configurada; o servidor precisa ter o processo correto ativo e aceitar a conexão.
- Somente um processo pode escutar em uma mesma combinação de endereço e porta TCP por vez. No caso documentado, o Gerenciador de Inners usa `Inner.exe` para escutar na `3570` durante manutenção e envio de configurações. Em operação normal, o `TopPortariaService` mantém a catraca on-line e registra eventos. Confirme se esse fluxo se aplica à versão e ao modelo atendidos.
- Para usar o Gerenciador de Inners, pode ser necessário parar temporariamente o `TopPortariaService`. Ao terminar, feche o Gerenciador e inicie novamente o serviço. Não deixe os dois disputarem a porta.
- `TIME_WAIT` representa uma conexão encerrada que aguarda limpeza TCP; não indica, por si só, um processo ocupando a porta. `LISTENING` indica que o servidor aguarda conexões. `ESTABLISHED` indica uma conexão TCP ativa entre os endereços exibidos.
- O leitor facial inicia uma conexão com o `TopFaceService` pela TCP `7792`.
- WSL/Hyper-V podem adicionar interfaces e rotas, mas sua presença isolada não comprova interferência. Não os desative sem evidência relacionada ao problema.

## 4. Diagnóstico da conexão da catraca

Execute no servidor. Troque `<IP_CATRACA>` pelo endereço confirmado do equipamento e `<PORTA_CATRACA>` pela porta TCP configurada. O exemplo do caso usa `3570`.

```cmd
ping <IP_CATRACA>
netstat -ano | findstr :<PORTA_CATRACA>
tasklist /FI "PID eq PID_ENCONTRADO"
```

Substitua `PID_ENCONTRADO` pelo PID numérico exibido no fim da linha do `netstat`. No PowerShell, identifique o processo com:

```powershell
Get-Process -Id PID_ENCONTRADO
Get-CimInstance Win32_Process -Filter "ProcessId=PID_ENCONTRADO" |
    Select-Object ProcessId,Name,ExecutablePath,CommandLine
```

| Evidência | Interpretação | Próxima verificação |
|---|---|---|
| Nenhuma saída para a porta | A busca não encontrou conexão nem escuta | Confirme o servidor, serviço e Gerenciador de Inners |
| `LISTENING` com PID | Um processo aguarda conexões | Identifique o processo; em operação normal, confirme se é o componente esperado do TopPortaria |
| `ESTABLISHED` | Há conexão TCP ativa | Confira endereços local/remoto e o processo proprietário |
| Somente `TIME_WAIT` | Uma conexão anterior foi encerrada | Não trate esse estado sozinho como porta ocupada; procure `LISTENING` e identifique o PID |

Para alternar entre manutenção pelo Gerenciador de Inners e operação normal, abra PowerShell **como administrador**. Confirme o nome do serviço na instalação antes de executar. No caso documentado:

```powershell
Stop-Service TopPortariaService
```

Faça a manutenção no Gerenciador de Inners e feche-o pela própria interface. Depois:

```powershell
Start-Service TopPortariaService
```

Não encerre processos à força como procedimento padrão. Primeiro identifique o processo, tente fechar o programa normalmente e verifique a porta novamente.

## 5. Verificação dos serviços

No PowerShell:

```powershell
Get-Service TopPortariaService,TopFaceService
sc.exe query TopPortariaService
sc.exe query TopFaceService
sc.exe qc TopFaceService
```

Confirme que esses nomes existem na instalação. Use `sc.exe` explicitamente: no PowerShell, `sc` pode ser um alias diferente do utilitário de serviços do Windows. `query` mostra o estado; `qc` exibe a configuração do serviço, incluindo o caminho binário.

| Sintoma | Evidência | Causa possível | Correção/verificação |
|---|---|---|---|
| Catraca não fica on-line | Serviço parado ou porta configurada sem escuta | Serviço parado ou `Inner.exe` usando a porta durante manutenção | Identifique o PID; feche o Gerenciador normalmente e inicie o serviço para operação |
| Facial não fica on-line | Serviço parado e porta `7792` sem escuta | Serviço não iniciou, caminho inválido ou configuração incompleta | Consulte estado, caminho e logs; valide o executável e a configuração SQL |

## 6. Exemplo de falha no caminho do TopFaceService

Na instalação documentada, o serviço foi registrado com um diretório `TopFace` duplicado:

```text
C:\Program Files (x86)\Topdata\TopAcesso\TopFace\TopFace\Servico\TopFace.exe
```

O caminho existente naquela instalação era:

```text
C:\Program Files (x86)\Topdata\TopAcesso\TopFace\Servico\TopFace.exe
```

O caminho inválido correspondia a serviço parado, erro 2 (arquivo não encontrado) e ausência de `LISTENING` em `7792`. Esses sintomas, em outra instalação, não provam por si só a mesma causa. Confirme primeiro o caminho real e o valor de `BINARY_PATH_NAME` mostrado por `sc.exe qc`.

Teste o caminho que foi confirmado no computador atendido:

```powershell
Test-Path "<CAMINHO_COMPLETO_DO_TOPFACE.EXE>"
```

Se o executável existir, mas o serviço estiver registrado com caminho incorreto, a correção abaixo altera a configuração do serviço. Use PowerShell **como administrador** e substitua o caminho pelo caminho confirmado naquela máquina. O exemplo corresponde ao caso documentado:

```powershell
$TopFaceServico = Get-CimInstance Win32_Service -Filter "Name='TopFaceService'"

Invoke-CimMethod -InputObject $TopFaceServico -MethodName Change -Arguments @{
    PathName = '"C:\Program Files (x86)\Topdata\TopAcesso\TopFace\Servico\TopFace.exe" /start'
}
```

Confira `ReturnValue`: `0` indica que a alteração foi aceita. Em seguida, verifique o caminho com `sc.exe qc TopFaceService` antes de iniciar o serviço. Não aplique este caminho literal em instalações que usem outra pasta.

## 7. Configuração do TopFace

Execute o configurador com elevação. Ajuste o caminho conforme a instalação local; o exemplo é o caminho observado no caso:

```powershell
Start-Process "<PASTA_TOPFACE>\Config\TopFaceConfig.exe" -Verb RunAs
```

No configurador do caso foi usada a seguinte configuração. Selecione o tipo e os dados correspondentes ao banco efetivamente usado pelo TopPortaria:

| Campo | Configuração do caso |
|---|---|
| Tipo | `TopPortaria [SQL Server]` |
| Servidor | `DESKTOP-8UC3DN3\CONECTANOTIFICA` |
| Banco | `TopPortaria` |
| Usuário | `USR_TopPortaria` (criado pelo instalador naquele ambiente) |

Use **Testar conexão** e, se aprovado, clique em **Gravar**. Não inclua senhas em documentação, logs compartilhados ou linha de comando.

Inicie o serviço e confirme o estado e a porta. Estes comandos são do ambiente documentado; valide o nome do serviço e a porta local antes de usá-los:

```powershell
Start-Service TopFaceService
Start-Sleep -Seconds 5
sc.exe query TopFaceService
netstat -ano | findstr :7792
```

Resultado esperado no servidor: serviço `RUNNING` e endereço de escuta na porta `7792`, normalmente `0.0.0.0:7792 ... LISTENING`. O formato exato varia conforme a versão do Windows e a forma como o serviço vincula a porta.

## 8. Configuração do leitor facial

No próprio equipamento, abra **Rede → Servidor**. Os valores abaixo são os confirmados no caso; informe o IPv4 do servidor e os parâmetros definidos para a instalação atendida.

| Campo | Valor no caso documentado |
|---|---|
| Req. Servidor | `Sim` |
| Domínio | `Não` |
| IP do servidor | `<IP_SERVIDOR>` |
| Porta | `7792` |
| Keep alive | `3` |
| Servidor valida | `Não` |

No caso, `ws://facial.topdata.com.br:80` era destinado ao TopPonto Web e não era usado com **Domínio** definido como `Não`. Confirme a finalidade do modo Domínio na documentação/configuração do produto da instalação antes de alterar esse campo.

Na configuração de rede do facial, confirme IP único, máscara compatível com a sub-rede e gateway conforme a rede local. Um IP fixo ou uma reserva DHCP ajuda a manter estáveis as regras de firewall e os registros. No exemplo, o facial usava `192.168.50.121` e máscara `255.255.255.0`; esses valores não devem ser copiados para outra rede sem validação.

## 9. Diagnóstico do Windows Firewall

Ping respondido não comprova que uma porta TCP está liberada. No caso documentado, `pktmon` mostrou uma tentativa SYN do facial chegando ao servidor e sendo descartada. Isso foi evidência de bloqueio no caminho do Windows, não uma conclusão baseada apenas na ausência de conexão.

Em Prompt de Comando como administrador, capture a porta facial configurada:

```cmd
pktmon filter remove
pktmon filter add TopFace -p 7792
pktmon start --etw -m real-time
```

Enquanto a captura está ativa, provoque uma tentativa de conexão do facial e observe as linhas. No caso, foi observado:

```text
192.168.50.121:porta > 192.168.50.11:7792 Flags [S]
DropReason INET
```

`Flags [S]` indica tentativa inicial de conexão TCP. Um descarte associado, como `DropReason INET`, junto com os endereços e a porta corretos, sustentou o diagnóstico de descarte pelo Windows naquele caso. A saída pode variar por versão; se não houver descarte, investigue também serviço, rota, VLAN, endereço e configuração do equipamento.

Foi criada uma regra restrita ao IP do facial, à porta e ao executável do serviço. Use PowerShell **como administrador**, substitua os marcadores pelos valores confirmados e crie regra somente se a captura/evidência apontar para o Firewall:

```powershell
New-NetFirewallRule `
    -DisplayName "TopFace TCP 7792 - Facial <IP_FACIAL>" `
    -Direction Inbound `
    -Action Allow `
    -Protocol TCP `
    -LocalPort 7792 `
    -RemoteAddress <IP_FACIAL> `
    -Program "<CAMINHO_COMPLETO_DO_TOPFACE.EXE>" `
    -Profile Any
```

Finalize a captura no Prompt de Comando:

```cmd
pktmon stop
pktmon filter remove
```

Com o serviço escutando e o facial conectado, espera-se observar uma linha `LISTENING` na porta `7792` e uma sessão `ESTABLISHED` entre `<IP_SERVIDOR>:7792` e `<IP_FACIAL>:<porta-efêmera>`. Não desative completamente o Firewall. Restrinja a regra à origem, porta e programa necessários, de acordo com a política local.

## 10. Associação do facial à catraca no TopPortaria

### Falha observada no caso

O facial foi inicialmente incluído pelo menu **Leitores Faciais**, criando um equipamento independente **Para controle de porta**. Na base desse caso, isso criou um segundo registro em `Inners` com `CodigoTipo = 4`, consumiu o leitor na seleção e deixou a catraca com `possuiFacial = 0`. O vínculo parcial coincidiu com lista vazia e a mensagem **“Não foi possível inserir os dados”**.

Esse modelo de cadastro e os códigos encontrados pertencem à instalação documentada. Confirme a estrutura e o comportamento da versão em atendimento; não presuma que códigos internos sejam iguais em outras versões.

As consultas a seguir foram usadas para leitura no banco `TopPortaria`. Troque a instância se necessário. Elas não devem ser adaptadas para escrita:

```powershell
sqlcmd -S ".\CONECTANOTIFICA" -E -No -W -s "|" -Q "USE [TopPortaria]; SELECT idLeitorFacial,NumeroSerial,Descricao FROM dbo.LeitorFacial; SELECT possuiFacial,idLeitorFacial,idSegundoLeitorFacial FROM dbo.Inners; SELECT * FROM dbo.FacesEquipamento;"
```

```powershell
sqlcmd -S ".\CONECTANOTIFICA" -E -No -W -s "|" -Q "USE [TopPortaria]; SELECT Codigo,Numero,Descricao,CodigoTipo,idLeitorFacial FROM dbo.Inners; SELECT idLeitorFacial,NumeroSerial,Descricao FROM dbo.LeitorFacial;"
```

Na instalação do caso, os valores observados foram:

| Cadastro | Valores do caso |
|---|---|
| Catraca | `Codigo 1`, `Numero 1`, descrição `topdata`, `CodigoTipo 1` |
| Facial independente | `Codigo 5`, `Numero 256`, descrição `Facial1`, `CodigoTipo 4`, `idLeitorFacial 6` |
| Serial do facial confirmado nos logs | `AYUF25079577` |

### Procedimento adotado no caso

O procedimento foi feito pela interface do TopPortaria; valide com o responsável pelo sistema antes de remover qualquer cadastro em outra instalação:

1. Parar temporariamente o `TopFaceService`.
2. Excluir pela interface do TopPortaria o cadastro independente `Facial1`.
3. Confirmar por consulta somente de leitura que o registro correspondente desapareceu.
4. Iniciar novamente o `TopFaceService`.
5. Aguardar o facial estabelecer conexão.
6. Abrir o cadastro da catraca e marcar **Utiliza leitor facial**.
7. Selecionar o facial pelo botão `...` dentro do cadastro da catraca.
8. Salvar pela interface e confirmar o estado on-line.

No cenário documentado, a finalidade era vincular o leitor à catraca e o facial não foi cadastrado como equipamento independente em **Leitores Faciais → Incluir**. Também foi usada a seleção pela interface da catraca, em vez de digitar o serial manualmente, pois havia um botão de seleção disponível. Confirme o fluxo adequado para o modelo, versão e finalidade da instalação atendida.

Não execute `DELETE` ou `UPDATE` diretamente no SQL para corrigir a associação sem backup, análise técnica e autorização formal. As consultas desta seção são somente de leitura; alterações do cadastro devem ser conduzidas pela interface suportada.

## 11. Logs úteis

Os caminhos abaixo são os observados no caso; localize os diretórios equivalentes se a instalação estiver em outro caminho:

```text
<PASTA_TOPPORTARIA>\LogErros
<PASTA_TOPFACE>\Servico\Log
<PASTA_TOPFACE>\Config\Log
```

No caso foram encontrados registros de leitor não cadastrado, serial `AYUF25079577`, IP `192.168.50.121`, envio de `setdevinfo`, envio de horário e erro em `TopPortaria.Dominio.LeitorFacial.Inserir`. Use esses valores apenas para reconhecer o exemplo; consulte os dados locais nos logs da instalação atendida.

Correlacione horário, equipamento e mensagens entre os logs do TopFace e TopPortaria. Trate logs como dados potencialmente sensíveis e remova nomes, seriais, endereços e outros identificadores antes de compartilhá-los externamente. Comunicação do serviço com um serial não comprova, isoladamente, que a associação à catraca foi salva.

## 12. Tabela de diagnóstico consolidado

| Sintoma | Evidência a coletar | Causa possível | Correção/verificação |
|---|---|---|---|
| Catraca não conecta | Estado de `TopPortariaService`, `LISTENING`/`ESTABLISHED`, PID da porta configurada | Serviço parado ou `Inner.exe` usando a porta durante manutenção | Identifique o PID; feche o Gerenciador normalmente e inicie o serviço para operação |
| Porta da catraca parece ocupada após desconexão | `netstat` mostra somente `TIME_WAIT` | Conexão TCP anterior encerrada | Não mate processos por esse estado; procure `LISTENING` e identifique o PID |
| Facial não conecta apesar de ping | Tentativa TCP, estado do serviço, captura `pktmon` | Firewall, rota, serviço ou configuração do equipamento | Determine onde a conexão falha; crie regra específica apenas com evidência de bloqueio |
| `TopFaceService` falha com erro 2 | `sc.exe qc`, `Test-Path` e logs | Caminho binário registrado incorretamente | Compare caminho registrado e executável existente; corrija com elevação somente após confirmar o caminho |
| Facial comunica, mas não aparece na catraca | Cadastro pela interface, consultas de leitura e logs | Cadastro independente ou associação incompleta | Confirme o fluxo da versão e faça a associação pela interface suportada |
| Lista de leitores vazia ou “Não foi possível inserir os dados” | Mensagens, estado dos cadastros e vínculos | Cadastro incompatível ou relação parcial | Investigue pela interface e logs; não corrija dados diretamente no SQL |

## 13. Checklist de encerramento

- [ ] `TopPortariaService` está configurado para iniciar automaticamente e está funcionando.
- [ ] `TopFaceService` está configurado para iniciar automaticamente e está funcionando.
- [ ] A porta configurada para a catraca está em `LISTENING` pelo processo esperado para a operação normal.
- [ ] A porta `7792` está em `LISTENING` pelo serviço facial.
- [ ] O facial está em `ESTABLISHED` com o servidor correto.
- [ ] A regra de Firewall necessária tem escopo restrito e foi validada.
- [ ] O facial está associado à catraca pela interface apropriada, quando esse vínculo for suportado e necessário na instalação.
- [ ] O TopPortaria mostra a catraca e o facial on-line.
- [ ] WSL/Hyper-V foram mantidos ativos quando não houve evidência de interferência.
- [ ] O Gerenciador de Inners está fechado durante a operação normal do TopPortaria.

## 14. Avisos de segurança

- Comece por verificações somente de leitura e registre o estado antes de alterar serviços ou Firewall.
- Não redefina a memória da catraca ou do facial como tentativa inicial de comunicação.
- Não desinstale WSL/Hyper-V sem evidência de interferência.
- Não desative todo o Firewall; prefira regras específicas e justificadas por evidências.
- Não apague banco nem edite Registro do Windows sem evidência clara e plano de recuperação.
- Não execute comandos SQL de escrita sem backup e autorização. Este guia usa consultas SQL somente de leitura.
- Não compartilhe senhas, tokens, logs integrais ou identificadores desnecessários.
- Adapte IPs, nomes de instância, nomes de serviço e caminhos a cada instalação. Revise qualquer marcador `<...>` antes de executar comandos.

## Referência do caso documentado

Valores registrados para reproduzir os sintomas e entender as evidências do caso original. Eles são exemplos e não devem ser presumidos em outras instalações.

| Item | Valor observado |
|---|---|
| Versões | TopPortaria `7.0.5.0`; Gerenciador de Inners `5.16.7` |
| Servidor | Wi-Fi; `192.168.50.11` |
| Catraca Topdata Fit 3 | `192.168.50.123`; TCP `3570` |
| Facial | `192.168.50.121`; TCP `7792`; serial `AYUF25079577` |
| SQL Server | `DESKTOP-8UC3DN3\CONECTANOTIFICA`; banco `TopPortaria` |
| Pasta TopPortaria | `C:\Program Files (x86)\Topdata\TopPortaria` |
| Pasta TopFace | `C:\Program Files (x86)\Topdata\TopAcesso\TopFace` |
| Configuração de rede facial | Máscara `255.255.255.0`; `Req. Servidor=Sim`; `Domínio=Não`; `Keep alive=3`; `Servidor valida=Não` |
| Firewall | SYN do facial chegava ao servidor e a captura reportou `DropReason INET`; foi criada regra restrita à origem, porta e executável |
| Cadastro incorreto | Facial independente em `Inners` (`CodigoTipo=4`); catraca com `possuiFacial=0`; serial confirmado nos logs |
