; Instalador do agente Conecta Notifica (Inno Setup 6).
;
; Gera um .exe com as telas de "Avançar" que a secretaria da escola espera.
; A lógica de verdade (detectar o SQL Server, validar, gravar o config.yaml,
; testar, registrar o serviço) mora no próprio agente, nos comandos
; `detectar`, `configurar`, `testar`, `instalar` e `iniciar` — o script só
; coleta os campos e chama.
;
; Compilar:  iscc instalador\conecta-notifica.iss /DVersao=1.0.0
; O CI (.github/workflows/agente.yml) faz isso a cada push e release.

#ifndef Versao
  #define Versao "dev"
#endif

#define Nome "Conecta Notifica — Agente"
#define Publicador "Conecta Ponto e Acesso"
#define Exe "notifica-agent.exe"
#define URLPadrao "https://painel.conectapontoeacesso.com.br/api"

[Setup]
AppId={{8E3F1C2A-9B47-4D6E-A1F5-3C7D9E0B4A21}
AppName={#Nome}
AppVersion={#Versao}
AppPublisher={#Publicador}
DefaultDirName=C:\ConectaNotifica
DefaultGroupName=Conecta Notifica
DisableProgramGroupPage=yes
OutputDir=..\dist
OutputBaseFilename=ConectaNotifica-Agente-{#Versao}
Compression=lzma2/max
SolidCompression=yes
; O agente é serviço do Windows e mexe no SQL Server: exige administrador.
PrivilegesRequired=admin
ArchitecturesInstallIn64BitMode=x64compatible
ArchitecturesAllowed=x64compatible
WizardStyle=modern
UninstallDisplayName={#Nome}
SetupLogging=yes

[Languages]
Name: "brazilianportuguese"; MessagesFile: "compiler:Languages\BrazilianPortuguese.isl"

[Files]
; dontcopy: o .exe é extraído para {tmp} e usado já na tela do banco, para
; detectar o SQL Server antes da instalação. A cópia para {app} é feita em
; CurStepChanged — assim o binário entra uma vez só no pacote.
Source: "..\bin\{#Exe}"; Flags: dontcopy
Source: "..\scripts\usuario-somente-leitura.sql"; DestDir: "{app}\scripts"; Flags: ignoreversion
Source: "..\scripts\descoberta.sql"; DestDir: "{app}\scripts"; Flags: ignoreversion
Source: "..\README.md"; DestDir: "{app}"; DestName: "LEIA-ME.txt"; Flags: ignoreversion isreadme

[Icons]
Name: "{group}\Conecta Notifica — Agente"; Filename: "{app}\{#Exe}"; WorkingDir: "{app}"
Name: "{group}\Monitor (ícone ao lado do relógio)"; Filename: "{app}\{#Exe}"; Parameters: "bandeja"; WorkingDir: "{app}"
Name: "{group}\Desinstalar"; Filename: "{uninstallexe}"
; O monitor sobe junto com o Windows para a escola ver o estado sem abrir nada.
Name: "{commonstartup}\Conecta Notifica — Monitor"; Filename: "{app}\{#Exe}"; Parameters: "bandeja"; WorkingDir: "{app}"; Tasks: monitor

[Tasks]
Name: "monitor"; Description: "Mostrar o ícone de status ao lado do relógio"; GroupDescription: "Extras:"

[UninstallRun]
Filename: "{app}\{#Exe}"; Parameters: "parar"; Flags: runhidden; RunOnceId: "pararservico"
Filename: "{app}\{#Exe}"; Parameters: "desinstalar"; Flags: runhidden; RunOnceId: "removerservico"

[UninstallDelete]
; O .exe é copiado por código (dontcopy), então o desinstalador não o conhece.
Type: files; Name: "{app}\{#Exe}"
Type: filesandordirs; Name: "{app}\dados"
Type: filesandordirs; Name: "{app}\logs"

[Code]
var
  PaginaSaaS: TInputQueryWizardPage;
  PaginaBanco: TWizardPage;
  CbInstancia, CbDatabase: TNewComboBox;
  EdServidor, EdPorta, EdUsuario, EdSenha: TNewEdit;
  LbAviso: TNewStaticText;
  BtProcurar: TNewButton;
  Detectado: Boolean;

function Aparar(S: String): String;
begin
  Result := Trim(S);
end;

function Aspas(S: String): String;
begin
  Result := '"' + S + '"';
end;

{ Divide "a|b|c" nos itens de um combo, preservando o que já estava digitado. }
procedure PreencherCombo(Combo: TNewComboBox; Lista: String);
var
  P: Integer;
  Item: String;
begin
  Combo.Items.Clear;
  while Lista <> '' do
  begin
    P := Pos('|', Lista);
    if P = 0 then
    begin
      Item := Lista;
      Lista := '';
    end
    else
    begin
      Item := Copy(Lista, 1, P - 1);
      Lista := Copy(Lista, P + 1, Length(Lista));
    end;
    if Trim(Item) <> '' then
      Combo.Items.Add(Item);
  end;
end;

{ Chama `notifica-agent detectar` e preenche a tela com o que ele achou.
  DaInstancia vazio = varredura completa; preenchido = recarrega os bancos
  daquela instância (é o que o botão "Procurar" faz depois de trocar o combo). }
procedure CarregarDeteccao(DaInstancia: String);
var
  Exe, Ini, Args: String;
  Codigo: Integer;
  Instancias, Bancos, Aviso, Servidor, Instancia, Database: String;
  Porta: Integer;
begin
  Exe := ExpandConstant('{tmp}\{#Exe}');
  Ini := ExpandConstant('{tmp}\deteccao.ini');
  DeleteFile(Ini);

  Args := 'detectar -saida ' + Aspas(Ini);
  if DaInstancia <> '' then
    Args := Args + ' -da-instancia ' + Aspas(DaInstancia);

  BtProcurar.Enabled := False;
  LbAviso.Caption := 'Procurando o SQL Server nesta máquina...';
  try
    Exec(Exe, Args, ExpandConstant('{tmp}'), SW_HIDE, ewWaitUntilTerminated, Codigo);
  finally
    BtProcurar.Enabled := True;
  end;

  if not FileExists(Ini) then
  begin
    LbAviso.Caption := 'Não consegui procurar automaticamente — preencha os campos abaixo.';
    Exit;
  end;

  Instancias := GetIniString('deteccao', 'instancias', '', Ini);
  Bancos := GetIniString('deteccao', 'bancos', '', Ini);
  Servidor := GetIniString('deteccao', 'servidor', 'localhost', Ini);
  Instancia := GetIniString('deteccao', 'instancia', '', Ini);
  Database := GetIniString('deteccao', 'database', '', Ini);
  Porta := GetIniInt('deteccao', 'porta', 1433, 0, 65535, Ini);
  Aviso := GetIniString('deteccao', 'aviso', '', Ini);

  if DaInstancia = '' then
  begin
    PreencherCombo(CbInstancia, Instancias);
    if Instancia <> '' then
      CbInstancia.Text := Servidor + '\' + Instancia
    else
      CbInstancia.Text := Servidor + ',' + IntToStr(Porta);
    EdServidor.Text := Servidor;
    EdPorta.Text := IntToStr(Porta);
  end;

  PreencherCombo(CbDatabase, Bancos);
  if Database <> '' then
    CbDatabase.Text := Database;

  if Aviso <> '' then
    LbAviso.Caption := 'Aviso: ' + Aviso
  else if CbDatabase.Items.Count > 1 then
    LbAviso.Caption := 'Encontrei mais de um banco com marcações — escolha o da catraca.'
  else if CbDatabase.Text <> '' then
    LbAviso.Caption := 'Encontrado. Confira e clique em Avançar.'
  else
    LbAviso.Caption := 'Preencha o banco da catraca.';
end;

procedure AoTrocarInstancia(Sender: TObject);
begin
  { Trocar a instância muda quais bancos existem: some com a lista antiga
    para ninguém instalar apontando para um banco de outra instância. }
  CbDatabase.Items.Clear;
  CbDatabase.Text := '';
  LbAviso.Caption := 'Instância alterada — clique em "Procurar bancos".';
end;

procedure AoClicarProcurar(Sender: TObject);
begin
  CarregarDeteccao(Aparar(CbInstancia.Text));
end;

function NovoRotulo(Pagina: TWizardPage; Texto: String; Topo: Integer): TNewStaticText;
begin
  Result := TNewStaticText.Create(WizardForm);
  Result.Parent := Pagina.Surface;
  Result.Caption := Texto;
  Result.Left := 0;
  Result.Top := Topo;
end;

procedure InitializeWizard;
var
  Y: Integer;
  LbPorta, LbSenha: TNewStaticText;
begin
  { Tela 1: o que a escola copia do painel. }
  PaginaSaaS := CreateInputQueryPage(wpSelectDir,
    'Conta da escola',
    'Onde o agente vai enviar os giros da catraca',
    'Estes dados estão no painel do Conecta Notifica, em "Primeiros passos".' + #13#10 +
    'A chave aparece uma única vez — se perdeu, gere outra por lá.');
  PaginaSaaS.Add('Endereço do Conecta Notifica:', False);
  PaginaSaaS.Add('Chave da escola (cn_...):', False);
  PaginaSaaS.Add('Nome da escola:', False);
  PaginaSaaS.Values[0] := '{#URLPadrao}';

  { Tela 2: banco da catraca, preenchida pela detecção. }
  PaginaBanco := CreateCustomPage(PaginaSaaS.ID,
    'Banco da catraca',
    'Onde ficam as marcações no SQL Server');

  Y := 0;
  NovoRotulo(PaginaBanco, 'Instância do SQL Server:', Y);
  CbInstancia := TNewComboBox.Create(WizardForm);
  CbInstancia.Parent := PaginaBanco.Surface;
  CbInstancia.Top := Y + ScaleY(16);
  CbInstancia.Left := 0;
  CbInstancia.Width := PaginaBanco.SurfaceWidth - ScaleX(130);
  CbInstancia.Style := csDropDown;
  CbInstancia.OnChange := @AoTrocarInstancia;

  BtProcurar := TNewButton.Create(WizardForm);
  BtProcurar.Parent := PaginaBanco.Surface;
  BtProcurar.Top := CbInstancia.Top - ScaleY(1);
  BtProcurar.Left := PaginaBanco.SurfaceWidth - ScaleX(122);
  BtProcurar.Width := ScaleX(122);
  BtProcurar.Height := ScaleY(23);
  BtProcurar.Caption := 'Procurar bancos';
  BtProcurar.OnClick := @AoClicarProcurar;

  Y := CbInstancia.Top + CbInstancia.Height + ScaleY(10);
  NovoRotulo(PaginaBanco, 'Servidor:', Y);
  EdServidor := TNewEdit.Create(WizardForm);
  EdServidor.Parent := PaginaBanco.Surface;
  EdServidor.Top := Y + ScaleY(16);
  EdServidor.Left := 0;
  EdServidor.Width := ScaleX(200);
  EdServidor.Text := 'localhost';

  LbPorta := NovoRotulo(PaginaBanco, 'Porta (quando não há instância):', Y);
  LbPorta.Left := ScaleX(220);
  EdPorta := TNewEdit.Create(WizardForm);
  EdPorta.Parent := PaginaBanco.Surface;
  EdPorta.Top := Y + ScaleY(16);
  EdPorta.Left := ScaleX(220);
  EdPorta.Width := ScaleX(90);
  EdPorta.Text := '1433';

  Y := EdServidor.Top + EdServidor.Height + ScaleY(10);
  NovoRotulo(PaginaBanco, 'Banco de dados da catraca:', Y);
  CbDatabase := TNewComboBox.Create(WizardForm);
  CbDatabase.Parent := PaginaBanco.Surface;
  CbDatabase.Top := Y + ScaleY(16);
  CbDatabase.Left := 0;
  CbDatabase.Width := PaginaBanco.SurfaceWidth;
  CbDatabase.Style := csDropDown;

  Y := CbDatabase.Top + CbDatabase.Height + ScaleY(14);
  NovoRotulo(PaginaBanco, 'Usuário de leitura:', Y);
  EdUsuario := TNewEdit.Create(WizardForm);
  EdUsuario.Parent := PaginaBanco.Surface;
  EdUsuario.Top := Y + ScaleY(16);
  EdUsuario.Left := 0;
  EdUsuario.Width := ScaleX(200);
  EdUsuario.Text := 'notifica_ro';

  LbSenha := NovoRotulo(PaginaBanco, 'Senha:', Y);
  LbSenha.Left := ScaleX(220);
  EdSenha := TNewEdit.Create(WizardForm);
  EdSenha.Parent := PaginaBanco.Surface;
  EdSenha.Top := Y + ScaleY(16);
  EdSenha.Left := ScaleX(220);
  EdSenha.Width := ScaleX(200);
  EdSenha.PasswordChar := '*';

  Y := EdUsuario.Top + EdUsuario.Height + ScaleY(14);
  LbAviso := NovoRotulo(PaginaBanco, '', Y);
  LbAviso.Width := PaginaBanco.SurfaceWidth;
  LbAviso.AutoSize := False;
  LbAviso.Height := ScaleY(32);
  LbAviso.WordWrap := True;
end;

procedure CurPageChanged(CurPageID: Integer);
begin
  { A detecção roda uma vez, na primeira vez que a tela aparece: voltar e
    avançar de novo não pode apagar o que a pessoa corrigiu à mão. }
  if (CurPageID = PaginaBanco.ID) and (not Detectado) then
  begin
    Detectado := True;
    ExtractTemporaryFile('{#Exe}');
    CarregarDeteccao('');
  end;
end;

{ Validação por tela: erra cedo, ao lado do campo errado, em vez de falhar no
  fim depois de copiar tudo. }
function NextButtonClick(CurPageID: Integer): Boolean;
var
  Url, Chave, Inst: String;
begin
  Result := True;
  if CurPageID = PaginaSaaS.ID then
  begin
    Url := Aparar(PaginaSaaS.Values[0]);
    Chave := Aparar(PaginaSaaS.Values[1]);
    if (Pos('http://', Url) <> 1) and (Pos('https://', Url) <> 1) then
    begin
      MsgBox('O endereço precisa começar com http:// ou https://.', mbError, MB_OK);
      Result := False;
      Exit;
    end;
    if Pos('cn_', Chave) <> 1 then
    begin
      MsgBox('A chave da escola começa com "cn_". Confira se copiou inteira do painel.',
        mbError, MB_OK);
      Result := False;
      Exit;
    end;
  end
  else if CurPageID = PaginaBanco.ID then
  begin
    if Aparar(EdServidor.Text) = '' then
    begin
      MsgBox('Informe o servidor do SQL Server (normalmente "localhost").', mbError, MB_OK);
      Result := False;
      Exit;
    end;
    if Aparar(CbDatabase.Text) = '' then
    begin
      MsgBox('Informe o banco da catraca. Se a lista veio vazia, confira a instância' + #13#10 +
        'e clique em "Procurar bancos".', mbError, MB_OK);
      Result := False;
      Exit;
    end;
    Inst := Aparar(CbInstancia.Text);
    if (Pos('\', Inst) = 0) and (Aparar(EdPorta.Text) = '') then
    begin
      MsgBox('Sem instância nomeada, informe a porta (normalmente 1433).', mbError, MB_OK);
      Result := False;
      Exit;
    end;
  end;
end;

function MontarArgumentos: String;
var
  Inst, Instancia: String;
  P: Integer;
begin
  Inst := Aparar(CbInstancia.Text);
  Instancia := '';
  P := Pos('\', Inst);
  if P > 0 then
    Instancia := Copy(Inst, P + 1, Length(Inst));

  Result := 'configurar' +
    ' -config ' + Aspas(ExpandConstant('{app}\config.yaml')) +
    ' -url ' + Aspas(Aparar(PaginaSaaS.Values[0])) +
    ' -api-key ' + Aspas(Aparar(PaginaSaaS.Values[1])) +
    ' -escola ' + Aspas(Aparar(PaginaSaaS.Values[2])) +
    ' -servidor ' + Aspas(Aparar(EdServidor.Text)) +
    ' -database ' + Aspas(Aparar(CbDatabase.Text)) +
    ' -usuario ' + Aspas(Aparar(EdUsuario.Text)) +
    ' -senha ' + Aspas(EdSenha.Text);

  if Instancia <> '' then
    Result := Result + ' -instancia ' + Aspas(Instancia)
  else
    Result := Result + ' -porta ' + Aparar(EdPorta.Text);
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  Codigo: Integer;
  Exe: String;
begin
  if CurStep = ssInstall then
  begin
    { O .exe veio como dontcopy para poder rodar durante o assistente; a
      cópia para a pasta final é nossa. }
    ExtractTemporaryFile('{#Exe}');
    if not FileCopy(ExpandConstant('{tmp}\{#Exe}'), ExpandConstant('{app}\{#Exe}'), False) then
      MsgBox('Não consegui copiar o programa para ' + ExpandConstant('{app}') + '.',
        mbError, MB_OK);
    Exit;
  end;

  if CurStep <> ssPostInstall then
    Exit;

  Exe := ExpandConstant('{app}\{#Exe}');

  { 1. grava o config.yaml }
  if not Exec(Exe, MontarArgumentos, ExpandConstant('{app}'), SW_HIDE,
       ewWaitUntilTerminated, Codigo) or (Codigo <> 0) then
  begin
    MsgBox('Não foi possível gravar a configuração (código ' + IntToStr(Codigo) + ').' + #13#10 +
      'Abra o programa em ' + ExpandConstant('{app}') + ' e use o assistente.', mbError, MB_OK);
    Exit;
  end;

  { 2. registra e sobe o serviço }
  Exec(Exe, 'parar', ExpandConstant('{app}'), SW_HIDE, ewWaitUntilTerminated, Codigo);
  Exec(Exe, 'desinstalar', ExpandConstant('{app}'), SW_HIDE, ewWaitUntilTerminated, Codigo);
  if not Exec(Exe, 'instalar', ExpandConstant('{app}'), SW_HIDE,
       ewWaitUntilTerminated, Codigo) or (Codigo <> 0) then
  begin
    MsgBox('A configuração foi gravada, mas o serviço do Windows não pôde ser' + #13#10 +
      'registrado. Abra a Central do agente na pasta de instalação e clique em "Instalar/Reparar serviço".',
      mbError, MB_OK);
    Exit;
  end;
  Exec(Exe, 'iniciar', ExpandConstant('{app}'), SW_HIDE, ewWaitUntilTerminated, Codigo);

  { 3. teste de ponta a ponta. Falhar aqui não desfaz a instalação — o
    serviço tenta de novo sozinho quando a rede voltar. }
  if not Exec(Exe, 'testar -config ' + Aspas(ExpandConstant('{app}\config.yaml')),
       ExpandConstant('{app}'), SW_HIDE, ewWaitUntilTerminated, Codigo) or (Codigo <> 0) then
    MsgBox('O agente foi instalado, mas o teste de conexão falhou.' + #13#10 + #13#10 +
      'Isso costuma ser senha do banco ou firewall. Abra o programa na pasta' + #13#10 +
      'de instalação e use "Testar conexões" para ver a mensagem exata.',
      mbInformation, MB_OK);
end;
