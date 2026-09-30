; Instalador do Agente Conecta Notifica.
;
; A configuração não é coletada pelo Inno Setup: na primeira abertura a Central
; C# abre seu assistente, grava config.yaml, testa as conexões e instala o
; serviço. Isso permite que uma atualização preserve integralmente a instalação
; já aprovada pela escola.

#ifndef Versao
  #define Versao "dev"
#endif

#define Nome "Agente Conecta Notifica"
#define Publicador "Conecta Ponto e Acesso"
#define CoreExe "notifica-core.exe"
#define GuiExe "ConectaNotificaAgente.exe"

[Setup]
AppId={{8E3F1C2A-9B47-4D6E-A1F5-3C7D9E0B4A21}
AppName={#Nome}
AppVersion={#Versao}
AppPublisher={#Publicador}
DefaultDirName=C:\ConectaNotifica
DefaultGroupName=Agente Conecta Notifica
DisableProgramGroupPage=yes
DisableWelcomePage=yes
OutputDir=..\dist
OutputBaseFilename=ConectaNotifica-Agente-{#Versao}
Compression=lzma2/max
SolidCompression=yes
PrivilegesRequired=admin
ArchitecturesInstallIn64BitMode=x64compatible
ArchitecturesAllowed=x64compatible
WizardStyle=modern
SetupIconFile=..\gui\assets\conecta.ico
WizardImageFile=assets\marca-instalador-final.bmp
UninstallDisplayName={#Nome}
SetupLogging=yes
; Primeiro pedimos ao serviço que pare de forma normal (PrepareToInstall).
; Se ainda houver um processo usando arquivos do agente, o Restart Manager
; tenta fechá-lo e pode encerrá-lo para permitir a atualização.
CloseApplications=force
RestartApplications=no

[Languages]
Name: "brazilianportuguese"; MessagesFile: "compiler:Languages\BrazilianPortuguese.isl"

[Files]
Source: "..\bin\{#CoreExe}"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\bin\{#GuiExe}"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\scripts\usuario-somente-leitura.sql"; DestDir: "{app}\scripts"; Flags: ignoreversion
Source: "..\scripts\descoberta.sql"; DestDir: "{app}\scripts"; Flags: ignoreversion
Source: "..\docs\GUIA-INSTALACAO-CATRACAS-TOPDATA.md"; DestDir: "{app}\docs"; Flags: ignoreversion
Source: "..\README.md"; DestDir: "{app}"; DestName: "LEIA-ME.txt"; Flags: ignoreversion isreadme
Source: "assets\hero-agente-conecta.bmp"; Flags: dontcopy

[Icons]
Name: "{group}\Agente Conecta Notifica"; Filename: "{app}\{#GuiExe}"; WorkingDir: "{app}"; IconFilename: "{app}\{#GuiExe}"
Name: "{group}\Guia de instalação Topdata"; Filename: "{sys}\notepad.exe"; Parameters: """{app}\docs\GUIA-INSTALACAO-CATRACAS-TOPDATA.md"""
Name: "{autodesktop}\Agente Conecta Notifica"; Filename: "{app}\{#GuiExe}"; WorkingDir: "{app}"; IconFilename: "{app}\{#GuiExe}"; Tasks: desktopicon
Name: "{group}\Monitor (ícone ao lado do relógio)"; Filename: "{app}\{#CoreExe}"; Parameters: "bandeja -config ""{app}\config.yaml"""; WorkingDir: "{app}"
Name: "{group}\Desinstalar"; Filename: "{uninstallexe}"
Name: "{commonstartup}\Agente Conecta Notifica — Monitor"; Filename: "{app}\{#CoreExe}"; Parameters: "bandeja -config ""{app}\config.yaml"""; WorkingDir: "{app}"; Tasks: monitor

[Tasks]
Name: "desktopicon"; Description: "Criar atalho na Área de Trabalho"; GroupDescription: "Atalhos:"
Name: "monitor"; Description: "Mostrar o ícone de status ao lado do relógio"; GroupDescription: "Extras:"

[Run]
; A Central tem manifesto requireAdministrator porque registra e controla o
; serviço. Sem runascurrentuser, o Inno abre entradas pós-instalação com o
; token original não elevado e o Windows retorna CreateProcess 740.
Filename: "{app}\{#GuiExe}"; Description: "Abrir o assistente de configuração"; Flags: nowait postinstall skipifsilent runascurrentuser; Check: PrimeiraInstalacao
Filename: "{app}\{#CoreExe}"; Parameters: "iniciar -config ""{app}\config.yaml"""; Flags: runhidden; Check: ConfiguracaoComServico

[UninstallRun]
Filename: "{app}\{#CoreExe}"; Parameters: "parar -config ""{app}\config.yaml"""; Flags: runhidden; RunOnceId: "pararservico"
Filename: "{app}\{#CoreExe}"; Parameters: "desinstalar -config ""{app}\config.yaml"""; Flags: runhidden; RunOnceId: "removerservico"

[InstallDelete]
; Remove o atalho legado duplicado criado por versões anteriores.
Type: files; Name: "{commonstartup}\Conecta Notifica — Monitor.lnk"

[UninstallDelete]
Type: filesandordirs; Name: "{app}\dados"
Type: filesandordirs; Name: "{app}\logs"

[Code]
var
  PaginaMarca: TWizardPage;
  PainelMarca: TPanel;
  ImagemMarca: TBitmapImage;
  TextoMarca: TNewStaticText;

procedure InitializeWizard;
begin
  { Uma tela própria evita a faixa lateral fixa do Inno Setup, que deixa a
    marca pequena e desalinhada na página final. }
  ExtractTemporaryFile('hero-agente-conecta.bmp');
  PaginaMarca := CreateCustomPage(wpWelcome,
    'Bem-vindo ao Agente Conecta Notifica',
    'Instalação do leitor de marcações da catraca');

  PainelMarca := TPanel.Create(WizardForm);
  PainelMarca.Parent := PaginaMarca.Surface;
  PainelMarca.Left := 0;
  PainelMarca.Top := 0;
  PainelMarca.Width := PaginaMarca.SurfaceWidth;
  PainelMarca.Height := ScaleY(185);
  PainelMarca.BevelOuter := bvNone;

  ImagemMarca := TBitmapImage.Create(WizardForm);
  ImagemMarca.Parent := PainelMarca;
  ImagemMarca.Left := 0;
  ImagemMarca.Top := 0;
  ImagemMarca.Width := PainelMarca.Width;
  ImagemMarca.Height := PainelMarca.Height;
  ImagemMarca.Stretch := True;
  ImagemMarca.Bitmap.LoadFromFile(ExpandConstant('{tmp}\hero-agente-conecta.bmp'));

  TextoMarca := TNewStaticText.Create(WizardForm);
  TextoMarca.Parent := PaginaMarca.Surface;
  TextoMarca.Left := ScaleX(8);
  TextoMarca.Top := PainelMarca.Top + PainelMarca.Height + ScaleY(16);
  TextoMarca.Width := PaginaMarca.SurfaceWidth - ScaleX(16);
  TextoMarca.Height := ScaleY(48);
  TextoMarca.AutoSize := False;
  TextoMarca.WordWrap := True;
  TextoMarca.Caption := 'O assistente vai conectar este computador ao SQL Server da catraca e ao painel da escola. O agente acessa as marcações somente para leitura.';
end;

function PrimeiraInstalacao: Boolean;
begin
  { config.yaml não é distribuído pelo instalador e não é sobrescrito em
    atualização. Sua ausência identifica uma instalação nova. }
  Result := not FileExists(ExpandConstant('{app}\config.yaml'));
end;

function ConfiguracaoComServico: Boolean;
begin
  Result := FileExists(ExpandConstant('{app}\config.yaml')) and
    RegKeyExists(HKEY_LOCAL_MACHINE,
      'SYSTEM\CurrentControlSet\Services\ConectaNotificaAgent');
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  Resultado: Integer;
  Executou: Boolean;
begin
  Result := '';
  { Em atualização, peça ao serviço antigo que pare antes de substituir o
    núcleo. Se já estiver parado, o fechamento automático do Inno continua
    sendo responsável por liberar qualquer processo restante. }
  if ConfiguracaoComServico and
     FileExists(ExpandConstant('{app}\{#CoreExe}')) then
  begin
    Executou := Exec(ExpandConstant('{app}\{#CoreExe}'),
      'parar -config "' + ExpandConstant('{app}\config.yaml') + '"',
      ExpandConstant('{app}'), SW_HIDE, ewWaitUntilTerminated, Resultado);
    if not Executou then
      Log('Não foi possível solicitar a parada do serviço antes da atualização. O Restart Manager tentará liberar os arquivos.');
  end;
end;
