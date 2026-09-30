using System.Diagnostics;
using System.Net;
using System.Net.NetworkInformation;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;

namespace ConectaNotificaAgente;

internal static class Program
{
    [STAThread]
    static void Main()
    {
        ApplicationConfiguration.Initialize();
        var baseDir = AppContext.BaseDirectory;
        var config = Path.Combine(baseDir, "config.yaml");
        if (!File.Exists(config))
        {
            using var assistente = new ConfigForm(baseDir, primeiraConfiguracao: true);
            Application.Run(assistente);
            if (!assistente.Configurado) return;
        }
        Application.Run(new CentralForm());
    }
}

internal sealed class CentralForm : Form
{
    private readonly List<Button> botoes = [];
    private readonly Dictionary<string, Label> indicadores = new(StringComparer.OrdinalIgnoreCase);
    private readonly Label resumoStatus = new() { AutoSize = false, Height = 48, Font = new Font("Segoe UI Semibold", 15), Padding = new Padding(10, 8, 10, 8), TextAlign = ContentAlignment.MiddleLeft, Dock = DockStyle.Fill };
    private readonly Label detalhesStatus = new() { AutoSize = false, Height = 92, Font = new Font("Segoe UI", 9), ForeColor = Color.FromArgb(82, 101, 122), Padding = new Padding(10, 0, 10, 8), Dock = DockStyle.Fill, AutoEllipsis = true };
    private readonly ListBox historico = new() { Dock = DockStyle.Fill, IntegralHeight = false, Font = new Font("Segoe UI", 9), BorderStyle = BorderStyle.FixedSingle };
    private readonly string baseDir = AppContext.BaseDirectory;
    private readonly NotifyIcon bandeja;
    private readonly System.Windows.Forms.Timer atualizadorStatus = new() { Interval = 15000 };
    private readonly string caminhoHistorico;
    private Button botaoIniciar = null!;
    private Button botaoParar = null!;
    private Button botaoSincronizar = null!;
    private string ultimaChaveEstado = "";
    private string ultimoEventoRegistrado = "";
    private string ultimoEnvioRegistrado = "";
    private string ultimaSyncRegistrada = "";
    private string ultimoAlerta = "";
    private bool primeiroStatus = true;
    private bool operacaoEmAndamento;
    private bool servicoRodando;
    private bool consultaAlunosConfigurada;
    private string versaoAtual = "dev";
    private bool encerrar;

    public CentralForm()
    {
        Text = "Agente Conecta Notifica";
        MinimumSize = new Size(920, 700);
        Size = new Size(1040, 820);
        StartPosition = FormStartPosition.CenterScreen;
        Font = new Font("Segoe UI", 10);
        BackColor = Color.FromArgb(245, 248, 252);
        caminhoHistorico = Path.Combine(baseDir, "logs", "central-historico.log");

        var menuBandeja = new ContextMenuStrip();
        menuBandeja.Items.Add("Abrir Central", null, (_, _) => MostrarJanela());
        menuBandeja.Items.Add("Atualizar status", null, async (_, _) => await AtualizarStatus());
        menuBandeja.Items.Add("Diagnóstico guiado", null, async (_, _) => await DiagnosticoGuiado());
        menuBandeja.Items.Add(new ToolStripSeparator());
        menuBandeja.Items.Add("Sair", null, (_, _) => Sair());
        bandeja = new NotifyIcon
        {
            Icon = IconeMarca(Color.Gray),
            Text = "Agente Conecta Notifica",
            ContextMenuStrip = menuBandeja,
            Visible = true
        };
        bandeja.MouseDoubleClick += (_, _) => MostrarJanela();
        Resize += (_, _) => { if (WindowState == FormWindowState.Minimized) OcultarNaBandeja(); };
        FormClosing += AoFechar;
        Shown += async (_, _) => await AtualizarStatus();
        atualizadorStatus.Tick += async (_, _) =>
        {
            if (operacaoEmAndamento) return;
            await AtualizarStatus();
        };
        atualizadorStatus.Start();

        var principal = new TableLayoutPanel { Dock = DockStyle.Fill, Padding = new Padding(24, 18, 24, 18), ColumnCount = 1, RowCount = 9, AutoScroll = true };
        principal.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        principal.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        principal.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        principal.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        principal.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        principal.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        principal.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        principal.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        principal.RowStyles.Add(new RowStyle(SizeType.AutoSize));

        var topo = new TableLayoutPanel { AutoSize = true, Dock = DockStyle.Top, ColumnCount = 2, Margin = new Padding(0, 0, 0, 20), Padding = new Padding(12, 8, 12, 8), BackColor = Color.White };
        topo.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 250)); topo.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        topo.Controls.Add(new PictureBox { Image = LogoHorizontal(), SizeMode = PictureBoxSizeMode.Zoom, Size = new Size(235, 76), Margin = new Padding(0, 0, 18, 0) }, 0, 0);
        var textosTopo = new FlowLayoutPanel { AutoSize = true, FlowDirection = FlowDirection.TopDown, WrapContents = false, Dock = DockStyle.Fill, Margin = new Padding(0, 8, 0, 0) };
        textosTopo.Controls.Add(new Label { Text = "Agente Conecta Notifica", Font = new Font("Segoe UI Semibold", 18), AutoSize = true });
        textosTopo.Controls.Add(new Label { Text = "Integração da catraca com o painel da escola", ForeColor = Color.FromArgb(82, 101, 122), AutoSize = true, Margin = new Padding(3, 2, 3, 0) });
        topo.Controls.Add(textosTopo, 1, 0);
        principal.Controls.Add(topo, 0, 0); principal.SetRowSpan(topo, 2);
        principal.Controls.Add(PainelResumo(), 0, 2);
        principal.Controls.Add(PainelIndicadores(), 0, 3);
        botaoIniciar = Botao("Iniciar agente", () => ExecutarCore("iniciar", "Iniciar serviço"), true);
        botaoParar = Botao("Parar agente", () => ExecutarCore("parar", "Parar serviço"));
        botaoSincronizar = Botao("Sincronizar alunos agora", () => ExecutarCore("sincronizar-alunos", "Sincronizar alunos"));
        principal.Controls.Add(Painel("OPERAÇÃO", 4, [
            Botao("Testar conexões", () => DiagnosticoGuiado(), true),
            botaoIniciar,
            botaoParar,
            Botao("Instalar/Reparar serviço", () => ExecutarCore("reparar", "Reparar serviço"))
        ]), 0, 4);
        principal.Controls.Add(Painel("SUPORTE", 3, [
            botaoSincronizar,
            Botao("Ver último acesso", () => { VerUltimoAcesso(); return Task.CompletedTask; }),
            Botao("Detectar consulta de alunos", DetectarConsultaAlunos),
            Botao("Configurar conexão", AbrirConfiguracao),
            Botao("Diagnóstico guiado", () => DiagnosticoGuiado())
        ]), 0, 5);
        principal.Controls.Add(Painel("FERRAMENTAS RÁPIDAS", 2, [
            Botao("Verificar atualização", VerificarAtualizacao),
            Botao("Ajuda de portas e serviços", () => { AjudaPortas(); return Task.CompletedTask; })
        ]), 0, 6);
        historico.Height = 90;
        principal.Controls.Add(PainelHistorico(), 0, 7);
        principal.Controls.Add(new Label { Text = "O serviço continua rodando quando a central é minimizada ou fechada. O ícone ao lado do relógio mostra o estado.", ForeColor = Color.FromArgb(82, 101, 122), AutoSize = true, Margin = new Padding(3, 12, 3, 0) }, 0, 8);
        Controls.Add(principal);
        CarregarHistorico();
        resumoStatus.Text = "CONSULTANDO STATUS";
        detalhesStatus.Text = "Verificando serviço, banco, painel e fila…";
    }

    private Control Painel(string titulo, int colunas, Button[] acoes)
    {
        var bloco = new TableLayoutPanel { AutoSize = true, Dock = DockStyle.Top, ColumnCount = 1, Margin = new Padding(0, 18, 0, 0) };
        bloco.Controls.Add(new Label { Text = titulo, Font = new Font("Segoe UI Semibold", 9), AutoSize = true, Margin = new Padding(3, 0, 3, 8) }, 0, 0);
        var grade = new TableLayoutPanel { AutoSize = true, Dock = DockStyle.Top, ColumnCount = colunas, RowCount = (int)Math.Ceiling(acoes.Length / (double)colunas), Margin = new Padding(0) };
        for (var i = 0; i < colunas; i++) grade.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100f / colunas));
        for (var i = 0; i < acoes.Length; i++) grade.Controls.Add(acoes[i], i % colunas, i / colunas);
        bloco.Controls.Add(grade, 0, 1);
        return bloco;
    }

    private Control PainelIndicadores()
    {
        var faixa = new FlowLayoutPanel { Dock = DockStyle.Top, AutoSize = true, WrapContents = true, Margin = new Padding(0, 0, 0, 4) };
        foreach (var item in new[] { ("servico", "SERVIÇO", "Consultando…"), ("banco", "SQL SERVER", "Aguardando estado"), ("painel", "CONECTA NOTIFICA", "Aguardando estado"), ("fila", "EVENTOS PENDENTES", "—"), ("evento", "ÚLTIMO EVENTO", "—"), ("alunos", "SINCRONIZAÇÃO", "—") })
        {
            var caixa = new Panel { Width = 145, Height = 67, BackColor = Color.White, Margin = new Padding(0, 0, 8, 8), Padding = new Padding(8) };
            var titulo = new Label { Text = item.Item2, Dock = DockStyle.Top, Height = 19, Font = new Font("Segoe UI Semibold", 7.5f), ForeColor = Color.FromArgb(82, 101, 122) };
            var valor = new Label { Text = item.Item3, Dock = DockStyle.Fill, Font = new Font("Segoe UI Semibold", 9), ForeColor = Color.FromArgb(60, 76, 96), AutoEllipsis = true };
            caixa.Controls.Add(valor); caixa.Controls.Add(titulo); faixa.Controls.Add(caixa); indicadores[item.Item1] = valor;
        }
        return faixa;
    }

    private Control PainelHistorico()
    {
        var bloco = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 1, RowCount = 2, Margin = new Padding(0, 9, 0, 0) };
        bloco.RowStyles.Add(new RowStyle(SizeType.AutoSize)); bloco.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        bloco.Controls.Add(new Label { Text = "ATIVIDADE RECENTE", Font = new Font("Segoe UI Semibold", 9), AutoSize = true, Margin = new Padding(3, 0, 3, 6) }, 0, 0);
        bloco.Controls.Add(historico, 0, 1);
        return bloco;
    }

    private Control PainelResumo()
    {
        var painel = new TableLayoutPanel { Dock = DockStyle.Top, AutoSize = false, Height = 150, ColumnCount = 1, RowCount = 2, BackColor = Color.White, Margin = new Padding(0, 4, 0, 10) };
        painel.RowStyles.Add(new RowStyle(SizeType.Absolute, 52)); painel.RowStyles.Add(new RowStyle(SizeType.Absolute, 98));
        painel.Controls.Add(resumoStatus, 0, 0); painel.Controls.Add(detalhesStatus, 0, 1);
        return painel;
    }

    private static Image? LogoHorizontal() => ImagemRecurso("ConectaNotificaAgente.assets.logo-conecta-horizontal.png");
    private static Image? ImagemRecurso(string nome)
    {
        using var fluxo = typeof(CentralForm).Assembly.GetManifestResourceStream(nome);
        if (fluxo == null) return null;
        using var imagem = Image.FromStream(fluxo);
        return new Bitmap(imagem);
    }
    [DllImport("user32.dll", SetLastError = true)] private static extern bool DestroyIcon(IntPtr hIcon);
    private static Icon IconeMarca(Color indicador)
    {
        using var marca = ImagemRecurso("ConectaNotificaAgente.assets.logo-conecta-simbolo.png");
        if (marca == null) return SystemIcons.Application;
        using var bitmap = new Bitmap(32, 32);
        using (var grafico = Graphics.FromImage(bitmap))
        using (var pincel = new SolidBrush(indicador))
        using (var contorno = new Pen(Color.White, 2))
        {
            grafico.Clear(Color.Transparent);
            grafico.DrawImage(marca, new Rectangle(0, 0, 25, 25));
            grafico.FillEllipse(pincel, 18, 18, 13, 13);
            grafico.DrawEllipse(contorno, 18, 18, 13, 13);
        }
        var alca = bitmap.GetHicon();
        try { using var icone = Icon.FromHandle(alca); return (Icon)icone.Clone(); }
        finally { DestroyIcon(alca); }
    }

    private Button Botao(string texto, Func<Task> acao, bool principal = false)
    {
        var b = new Button { Text = texto, Dock = DockStyle.Fill, Height = 42, MinimumSize = new Size(0, 42), Margin = new Padding(6, 4, 6, 4), BackColor = principal ? Color.FromArgb(11, 103, 194) : Color.FromArgb(83, 101, 121), ForeColor = Color.White, FlatStyle = FlatStyle.Flat, UseVisualStyleBackColor = false };
        b.FlatAppearance.BorderSize = 0;
        b.Click += async (_, _) => await acao();
        botoes.Add(b);
        return b;
    }

    private async Task ExecutarCore(string comando, string rotulo, bool mostrarResultadoEmJanela = false)
    {
        var core = Path.Combine(baseDir, "notifica-core.exe");
        if (!File.Exists(core)) { Mostrar("NÃO CONCLUÍDO — núcleo do agente não encontrado."); return; }
        Bloquear(true); Mostrar("EXECUTANDO — " + rotulo + "…");
        try
        {
            var resultado = await Task.Run(() => RodarProcesso(core, comando + " -config \"" + Path.Combine(baseDir, "config.yaml") + "\""));
            var ok = resultado.Codigo == 0;
            var retorno = string.IsNullOrWhiteSpace(resultado.Texto) ? "Comando concluído." : resultado.Texto;
            RegistrarHistorico(rotulo + (ok ? " concluído." : " falhou."));
            await AtualizarStatus(mostrarResultadoEmJanela ? "" : "\r\n" + retorno);
            if (mostrarResultadoEmJanela)
                MessageBox.Show(this, retorno, rotulo, MessageBoxButtons.OK, ok ? MessageBoxIcon.Information : MessageBoxIcon.Warning);
        }
        catch (Exception ex) { Mostrar("NÃO CONCLUÍDO — " + ex.Message); await AtualizarStatus(); }
        finally { Bloquear(false); }
    }

    private async Task DetectarConsultaAlunos()
    {
        var resposta = MessageBox.Show(this,
            "A central vai procurar a tabela ligada ao cadastro de pessoas no SQL Server e validar um SELECT sem retornar nomes ou cartões. Ela não altera o banco. A consulta será salva na configuração local, mas a sincronização automática continuará desligada. Deseja continuar?",
            "Detectar consulta de alunos", MessageBoxButtons.YesNo, MessageBoxIcon.Question);
        if (resposta != DialogResult.Yes) return;
        await ExecutarCore("preparar-consulta-alunos", "Detectar consulta de alunos", mostrarResultadoEmJanela: true);
    }

    private async Task AtualizarStatus(string complemento = "")
    {
        var core = Path.Combine(baseDir, "notifica-core.exe");
        if (!File.Exists(core))
        {
            PintarStatus("CENTRAL INCOMPLETA", Color.Firebrick);
            indicadores["servico"].Text = "Núcleo ausente";
            return;
        }

        try
        {
            var resultado = await Task.Run(() => RodarProcesso(core, "status-json -config \"" + Path.Combine(baseDir, "config.yaml") + "\""));
            if (resultado.Codigo != 0) throw new InvalidOperationException(resultado.Texto);
            using var doc = JsonDocument.Parse(resultado.Texto);
            AplicarStatus(doc.RootElement, complemento);
        }
        catch (Exception ex)
        {
            PintarStatus("STATUS INDISPONÍVEL", Color.Firebrick);
            Mostrar("Não foi possível consultar o estado atual. " + ex.Message + complemento);
        }
    }

    private void AplicarStatus(JsonElement raiz, string complemento)
    {
        var servico = Texto(raiz, "servico", "unknown");
        versaoAtual = Texto(raiz, "versao", "dev");
        var estadoExiste = raiz.TryGetProperty("estado", out var estado);
        var atualizado = estadoExiste ? Data(estado, "em") : null;
        var fresco = atualizado.HasValue && DateTimeOffset.Now - atualizado.Value.ToLocalTime() < TimeSpan.FromMinutes(3);
        var bancoOk = estadoExiste && Booleano(estado, "banco_ok");
        var painelOk = estadoExiste && Booleano(estado, "saas_ok");
        var pendentes = estadoExiste ? Inteiro(estado, "pendentes") : 0;
        var enviadasHoje = estadoExiste ? Inteiro(estado, "enviados_hoje") : 0;
        var rodando = servico == "running";
        var configuradaAlunos = Booleano(raiz, "consulta_alunos_configurada");
        var syncHabilitada = Booleano(raiz, "sincronizacao_habilitada");

        servicoRodando = rodando;
        consultaAlunosConfigurada = configuradaAlunos;
        AtualizarEstadosBotoes();
        botaoSincronizar.Text = !configuradaAlunos ? "Sincronização sem consulta" : syncHabilitada ? "Sincronizar alunos agora (automática ativa)" : "Sincronizar alunos agora";

        indicadores["servico"].Text = servico switch { "running" => "Em execução", "stopped" => "Parado", "not_installed" => "Não instalado", _ => "Indisponível" };
        indicadores["servico"].ForeColor = rodando ? Color.SeaGreen : Color.Firebrick;
        indicadores["banco"].Text = fresco ? (bancoOk ? "Conectado" : "Sem conexão") : "Sem atualização";
        indicadores["banco"].ForeColor = fresco && bancoOk ? Color.SeaGreen : Color.DarkOrange;
        indicadores["painel"].Text = fresco ? (painelOk ? "Conectado" : "Sem conexão") : "Sem atualização";
        indicadores["painel"].ForeColor = fresco && painelOk ? Color.SeaGreen : Color.DarkOrange;
        indicadores["fila"].Text = pendentes + " pendente(s)";
        indicadores["fila"].ForeColor = pendentes > 0 ? Color.DarkOrange : Color.SeaGreen;

        var ultimoEvento = estadoExiste ? Texto(estado, "ultimo_evento", "") : "";
        var ultimaLeitura = estadoExiste ? Data(estado, "ultima_leitura") : null;
        var ultimoEnvio = estadoExiste ? Data(estado, "ultimo_envio") : null;
        indicadores["evento"].Text = DataVisivel(ultimoEvento);
        indicadores["alunos"].Text = syncHabilitada ? "Automática ativa" : configuradaAlunos ? "Manual disponível" : "Não configurada";
        indicadores["alunos"].ForeColor = configuradaAlunos ? Color.SeaGreen : Color.DarkOrange;

        string titulo;
        Color cor;
        if (!rodando) { titulo = servico == "not_installed" ? "SERVIÇO NÃO INSTALADO" : "SERVIÇO PARADO"; cor = Color.Firebrick; }
        else if (!fresco) { titulo = "SERVIÇO RODANDO — SEM ATUALIZAÇÃO RECENTE"; cor = Color.DarkOrange; }
        else if (!bancoOk) { titulo = "ATENÇÃO — SEM CONEXÃO COM O SQL SERVER"; cor = Color.DarkOrange; }
        else if (!painelOk) { titulo = "ATENÇÃO — SEM CONEXÃO COM O PAINEL"; cor = Color.DarkOrange; }
        else if (pendentes > 0) { titulo = "CONECTADO — ENVIANDO EVENTOS PENDENTES"; cor = Color.DarkOrange; }
        else { titulo = "CONECTADO — AGENTE OPERANDO NORMALMENTE"; cor = Color.SeaGreen; }
        PintarStatus(titulo, cor);

        var detalhes = "Versão " + versaoAtual + " | Enviados hoje: " + enviadasHoje +
                       " | Última leitura SQL: " + (ultimaLeitura?.ToLocalTime().ToString("dd/MM HH:mm:ss") ?? "sem registro") +
                       " | Último envio: " + (ultimoEnvio?.ToLocalTime().ToString("dd/MM HH:mm:ss") ?? "sem registro");
        if (configuradaAlunos && raiz.TryGetProperty("sincronizacao", out var sync))
        {
            var concluida = Data(sync, "concluida_em");
            var msg = Texto(sync, "mensagem", "");
            var qtd = Inteiro(sync, "quantidade");
            indicadores["alunos"].Text = (Booleano(sync, "sucesso") ? "OK · " : "Atenção · ") + qtd + " cadastro(s)";
            if (concluida.HasValue) detalhes += " | Última sincronização de alunos: " + concluida.Value.ToLocalTime().ToString("dd/MM HH:mm:ss");
            if (!string.IsNullOrWhiteSpace(msg)) detalhes += "\r\n" + msg;
        }
        if (!fresco && rodando) detalhes += "\r\nO serviço está ativo, mas ainda não publicou um heartbeat recente. Use Diagnóstico guiado para conferir banco e painel.";
        if (!configuradaAlunos) detalhes += "\r\nSincronização de alunos indisponível: falta uma consulta SELECT em consultas.alunos.";
        Mostrar(detalhes + complemento);

        var chave = string.Join("|", servico, fresco, bancoOk, painelOk, pendentes > 0, titulo);
        if (chave != ultimaChaveEstado)
        {
            if (!primeiroStatus) RegistrarHistorico("Estado: " + titulo);
            ultimaChaveEstado = chave;
        }
        if (ultimoEvento.Length > 0 && ultimoEvento != ultimoEventoRegistrado)
        {
            RegistrarHistorico("Acesso detectado no banco: " + DataVisivel(ultimoEvento));
            ultimoEventoRegistrado = ultimoEvento;
        }
        if (ultimoEnvio.HasValue && ultimoEnvio.Value.ToString("O") != ultimoEnvioRegistrado)
        {
            RegistrarHistorico("Lote de eventos confirmado pelo painel: " + ultimoEnvio.Value.ToLocalTime().ToString("HH:mm:ss"));
            ultimoEnvioRegistrado = ultimoEnvio.Value.ToString("O");
        }
        if (raiz.TryGetProperty("sincronizacao", out var syncAtual))
        {
            var concluida = Texto(syncAtual, "concluida_em", "");
            if (concluida.Length > 0 && concluida != ultimaSyncRegistrada)
            {
                RegistrarHistorico(Texto(syncAtual, "mensagem", "Sincronização de cadastros concluída."));
                ultimaSyncRegistrada = concluida;
            }
        }
        if (!primeiroStatus && titulo != ultimoAlerta && (cor == Color.Firebrick || cor == Color.DarkOrange))
        {
            bandeja.ShowBalloonTip(4500, "Agente Conecta Notifica", titulo, ToolTipIcon.Warning);
            ultimoAlerta = titulo;
        }
        else if (cor == Color.SeaGreen) ultimoAlerta = "";
        primeiroStatus = false;
        var iconeAnterior = bandeja.Icon;
        bandeja.Icon = IconeMarca(cor);
        if (iconeAnterior != null && iconeAnterior != SystemIcons.Application) iconeAnterior.Dispose();
        bandeja.Text = (cor == Color.SeaGreen ? "Conectado" : cor == Color.Firebrick ? "Serviço parado" : "Atenção") + " — Agente Conecta Notifica";
    }

    private static string Texto(JsonElement e, string nome, string padrao) => e.ValueKind == JsonValueKind.Object && e.TryGetProperty(nome, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() ?? padrao : padrao;
    private static bool Booleano(JsonElement e, string nome) => e.ValueKind == JsonValueKind.Object && e.TryGetProperty(nome, out var v) && v.ValueKind == JsonValueKind.True;
    private static int Inteiro(JsonElement e, string nome) => e.ValueKind == JsonValueKind.Object && e.TryGetProperty(nome, out var v) && v.TryGetInt32(out var n) ? n : 0;
    private static DateTimeOffset? Data(JsonElement e, string nome) => e.ValueKind == JsonValueKind.Object && e.TryGetProperty(nome, out var v) && v.ValueKind == JsonValueKind.String && v.TryGetDateTimeOffset(out var dt) ? dt : null;
    private static string DataVisivel(string valor)
    {
        if (DateTimeOffset.TryParse(valor, out var dt)) return dt.ToLocalTime().ToString("dd/MM HH:mm:ss");
        return "Sem evento registrado";
    }

    private void PintarStatus(string titulo, Color cor)
    {
        resumoStatus.Text = titulo;
        resumoStatus.ForeColor = cor;
    }

    private void RegistrarHistorico(string mensagem)
    {
        try
        {
            var pasta = Path.GetDirectoryName(caminhoHistorico)!;
            Directory.CreateDirectory(pasta);
            var linha = DateTimeOffset.Now.ToString("yyyy-MM-dd HH:mm:ss zzz") + " | " + mensagem.Replace('\r', ' ').Replace('\n', ' ');
            File.AppendAllText(caminhoHistorico, linha + Environment.NewLine, Encoding.UTF8);
            var info = new FileInfo(caminhoHistorico);
            if (info.Length > 512 * 1024)
            {
                var ultimas = File.ReadLines(caminhoHistorico, Encoding.UTF8).TakeLast(500).ToArray();
                File.WriteAllLines(caminhoHistorico, ultimas, Encoding.UTF8);
            }
            if (historico.IsHandleCreated)
            {
                historico.Items.Insert(0, linha);
                while (historico.Items.Count > 100) historico.Items.RemoveAt(historico.Items.Count - 1);
            }
        }
        catch { /* O histórico é auxiliar; falha de disco não interrompe o agente. */ }
    }

    private void CarregarHistorico()
    {
        try
        {
            if (!File.Exists(caminhoHistorico)) return;
            foreach (var linha in File.ReadLines(caminhoHistorico, Encoding.UTF8).TakeLast(100).Reverse())
                historico.Items.Add(linha);
        }
        catch { }
    }

    private async Task DiagnosticoGuiado()
    {
        var core = Path.Combine(baseDir, "notifica-core.exe");
        if (!File.Exists(core)) { MessageBox.Show(this, "O núcleo notifica-core.exe não foi encontrado.", "Diagnóstico", MessageBoxButtons.OK, MessageBoxIcon.Error); return; }
        var relatorio = new StringBuilder();
        relatorio.AppendLine("DIAGNÓSTICO DO AGENTE CONECTA NOTIFICA");
        relatorio.AppendLine("Gerado em " + DateTimeOffset.Now.ToString("dd/MM/yyyy HH:mm:ss zzz"));
        relatorio.AppendLine("Este diagnóstico não altera o SQL Server.");
        relatorio.AppendLine();
        Bloquear(true);
        PintarStatus("DIAGNÓSTICO EM EXECUÇÃO", Color.DodgerBlue);
        try
        {
            var args = "-config \"" + Path.Combine(baseDir, "config.yaml") + "\"";
            var status = await Task.Run(() => RodarProcesso(core, "status-json " + args));
            relatorio.AppendLine("1. SERVIÇO, FILA E ÚLTIMA ATIVIDADE");
            if (status.Codigo == 0)
            {
                using var doc = JsonDocument.Parse(status.Texto);
                var root = doc.RootElement;
                relatorio.AppendLine("Serviço: " + Texto(root, "servico", "desconhecido"));
                if (root.TryGetProperty("estado", out var e))
                {
                    relatorio.AppendLine("Última atualização: " + (Data(e, "em")?.ToLocalTime().ToString("dd/MM/yyyy HH:mm:ss") ?? "sem registro"));
                    relatorio.AppendLine("Banco SQL: " + (Booleano(e, "banco_ok") ? "conectado" : "sem confirmação recente"));
                    relatorio.AppendLine("Painel: " + (Booleano(e, "saas_ok") ? "conectado" : "sem confirmação recente"));
                    relatorio.AppendLine("Eventos pendentes: " + Inteiro(e, "pendentes"));
                    relatorio.AppendLine("Última leitura SQL: " + (Data(e, "ultima_leitura")?.ToLocalTime().ToString("dd/MM/yyyy HH:mm:ss") ?? "sem registro"));
                    relatorio.AppendLine("Último envio de eventos: " + (Data(e, "ultimo_envio")?.ToLocalTime().ToString("dd/MM/yyyy HH:mm:ss") ?? "sem registro"));
                }
                relatorio.AppendLine("Consulta de alunos configurada: " + (Booleano(root, "consulta_alunos_configurada") ? "sim" : "não"));
            }
            else relatorio.AppendLine(status.Texto);

            relatorio.AppendLine();
            relatorio.AppendLine("2. TESTE DE CONECTIVIDADE");
            var teste = await Task.Run(() => RodarProcesso(core, "testar " + args));
            relatorio.AppendLine(teste.Codigo == 0 ? "Resultado: aprovado" : "Resultado: requer atenção");
            relatorio.AppendLine(Limitar(teste.Texto, 5000));

            relatorio.AppendLine();
            relatorio.AppendLine("3. PORTAS LOCAIS TOPDATA");
            relatorio.AppendLine("TCP 3570: " + (OuveTcp(3570) ? "há processo escutando localmente" : "nenhum listener local detectado"));
            relatorio.AppendLine("TCP 7792: " + (OuveTcp(7792) ? "há processo escutando localmente" : "nenhum listener local detectado"));
            relatorio.AppendLine("A presença de listener não confirma comunicação com o equipamento. Consulte Ajuda de portas e serviços.");

            relatorio.AppendLine();
            relatorio.AppendLine("4. RELATÓRIO SEGURO");
            var diagnostico = await Task.Run(() => RodarProcesso(core, "diagnostico " + args));
            relatorio.AppendLine(diagnostico.Codigo == 0 ? diagnostico.Texto : "Não foi possível gerar o arquivo: " + diagnostico.Texto);
            RegistrarHistorico("Diagnóstico guiado concluído.");
        }
        catch (Exception ex) { relatorio.AppendLine("Diagnóstico incompleto: " + ex.Message); }
        finally { Bloquear(false); await AtualizarStatus(); }
        ExibirRelatorio("Diagnóstico guiado", relatorio.ToString());
    }

    private void VerUltimoAcesso()
    {
        try
        {
            var r = RodarProcesso(Path.Combine(baseDir, "notifica-core.exe"), "status-json -config \"" + Path.Combine(baseDir, "config.yaml") + "\"");
            using var doc = JsonDocument.Parse(r.Texto);
            var root = doc.RootElement;
            var sb = new StringBuilder("VISÃO DO ÚLTIMO ACESSO\r\n\r\n");
            if (!root.TryGetProperty("estado", out var e)) sb.AppendLine("O serviço ainda não publicou estado. Inicie o agente e aguarde a primeira leitura.");
            else
            {
                sb.AppendLine("Última marcação observada no banco: " + DataVisivel(Texto(e, "ultimo_evento", "")));
                sb.AppendLine("Última leitura do SQL: " + (Data(e, "ultima_leitura")?.ToLocalTime().ToString("dd/MM/yyyy HH:mm:ss") ?? "sem registro"));
                sb.AppendLine("Último lote confirmado pelo painel: " + (Data(e, "ultimo_envio")?.ToLocalTime().ToString("dd/MM/yyyy HH:mm:ss") ?? "sem registro"));
                sb.AppendLine("Eventos ainda na fila: " + Inteiro(e, "pendentes"));
                sb.AppendLine();
                sb.AppendLine("Os horários são metadados da fila e do serviço. A central não consulta nem mostra nome, cartão ou conteúdo individual da marcação.");
            }
            ExibirRelatorio("Último acesso", sb.ToString());
        }
        catch (Exception ex) { MessageBox.Show(this, "Não foi possível ler o estado do agente: " + ex.Message, "Último acesso", MessageBoxButtons.OK, MessageBoxIcon.Warning); }
    }

    private async Task VerificarAtualizacao()
    {
        const string url = "https://api.github.com/repos/KalyterosBR/Conecta-Notifica-Agente/releases/latest";
        try
        {
            using var cliente = new HttpClient();
            cliente.DefaultRequestHeaders.UserAgent.ParseAdd("ConectaNotificaAgente/" + versaoAtual);
            cliente.Timeout = TimeSpan.FromSeconds(10);
            using var resposta = await cliente.GetAsync(url);
            if (!resposta.IsSuccessStatusCode) throw new InvalidOperationException("O servidor de versões respondeu " + (int)resposta.StatusCode + ".");
            using var doc = JsonDocument.Parse(await resposta.Content.ReadAsStringAsync());
            var raiz = doc.RootElement;
            var tag = Texto(raiz, "tag_name", "versão desconhecida");
            var html = Texto(raiz, "html_url", "https://github.com/KalyterosBR/Conecta-Notifica-Agente/releases");
            var instaladaEhTeste = versaoAtual.Contains("-dev", StringComparison.OrdinalIgnoreCase) ||
                                   versaoAtual.Equals("dev", StringComparison.OrdinalIgnoreCase);
            var publicada = tag.StartsWith("v", StringComparison.OrdinalIgnoreCase) ? tag[1..] : tag;
            var estadoVersao = instaladaEhTeste
                ? "Esta instalação é uma build de teste/desenvolvimento. Ela não representa a versão oficial distribuída."
                : string.Equals(versaoAtual, publicada, StringComparison.OrdinalIgnoreCase)
                    ? "Este agente corresponde à versão oficial publicada mais recente."
                    : "Há uma versão oficial diferente da instalada. Confira os detalhes antes de atualizar. ";
            var mensagem = "Instalada: " + versaoAtual + "\r\nOficial publicada: " + tag + "\r\n\r\n" + estadoVersao +
                           "\r\n\r\nA central não baixa nem instala atualizações automaticamente. Deseja abrir a página da versão oficial?";
            if (MessageBox.Show(this, mensagem, "Atualizações", MessageBoxButtons.YesNo, MessageBoxIcon.Information) == DialogResult.Yes)
                Process.Start(new ProcessStartInfo(html) { UseShellExecute = true });
            RegistrarHistorico("Consulta de atualização concluída.");
        }
        catch (Exception ex) { MessageBox.Show(this, "Não foi possível consultar as versões agora. Verifique a internet e tente novamente.\r\n\r\n" + ex.Message, "Atualizações", MessageBoxButtons.OK, MessageBoxIcon.Warning); }
    }

    private static bool OuveTcp(int porta) => IPGlobalProperties.GetIPGlobalProperties().GetActiveTcpListeners().Any(e => e.Port == porta);
    private static string Limitar(string texto, int limite) => texto.Length <= limite ? texto : texto[..limite] + "\r\n[saída limitada]";
    private void ExibirRelatorio(string titulo, string texto)
    {
        using var janela = new Form { Text = titulo, StartPosition = FormStartPosition.CenterParent, Size = new Size(760, 620), MinimumSize = new Size(600, 420), Font = Font };
        var corpo = new TextBox { Multiline = true, ReadOnly = true, ScrollBars = ScrollBars.Vertical, Dock = DockStyle.Fill, Font = new Font("Consolas", 9), Text = texto };
        janela.Controls.Add(corpo); janela.ShowDialog(this);
    }

    private void AjudaPortas()
    {
        const string ajuda = "COMUNICAÇÃO COM OS EQUIPAMENTOS TOPDATA\r\n\r\n" +
            "FIT 3 — TCP 3570\r\n" +
            "A Fit 3 inicia a conexão com o computador. Somente um processo pode escutar a porta 3570 por vez. No uso normal, o TopPortariaService mantém a catraca on-line. Durante manutenção, o Gerenciador de Inners (Inner.exe) pode usar a porta; pare temporariamente o serviço, feche o Gerenciador e inicie o serviço novamente.\r\n\r\n" +
            "LEITOR FACIAL — TCP 7792\r\n" +
            "O leitor conecta ao TopFaceService. Confirme que o serviço está em execução, que existe listener TCP 7792 e que o Firewall permite a origem do leitor. Ping responde ICMP e não confirma liberação TCP.\r\n\r\n" +
            "COMANDOS DE LEITURA\r\n" +
            "Get-Service TopPortariaService,TopFaceService\r\nsc.exe query TopFaceService\r\nnetstat -ano | findstr :3570\r\nnetstat -ano | findstr :7792\r\n\r\n" +
            "Não desative todo o Firewall. Não desative WSL/Hyper-V sem evidência de interferência. Consulte o diagnóstico do fabricante antes de alterar a rede.";
        ExibirRelatorio("Ajuda de portas e serviços", ajuda);
    }

    private static (int Codigo, string Texto) RodarProcesso(string arquivo, string argumentos)
    {
        using var p = new Process { StartInfo = new ProcessStartInfo(arquivo) { UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true, StandardOutputEncoding = Encoding.UTF8, StandardErrorEncoding = Encoding.UTF8, WorkingDirectory = Path.GetDirectoryName(arquivo)! } };
        foreach (var argumento in ArgumentList(argumentos)) p.StartInfo.ArgumentList.Add(argumento);
        p.Start();
        var stdout = p.StandardOutput.ReadToEndAsync(); var stderr = p.StandardError.ReadToEndAsync();
        p.WaitForExit(); Task.WaitAll(stdout, stderr);
        var texto = (stdout.Result + "\r\n" + stderr.Result).Trim();
        return (p.ExitCode, string.IsNullOrWhiteSpace(texto) ? "Comando concluído." : texto);
    }

    private static IEnumerable<string> ArgumentList(string texto)
    {
        var atual = new StringBuilder();
        var citado = false;
        foreach (var caractere in texto)
        {
            if (caractere == '"') { citado = !citado; continue; }
            if (char.IsWhiteSpace(caractere) && !citado)
            {
                if (atual.Length > 0) { yield return atual.ToString(); atual.Clear(); }
                continue;
            }
            atual.Append(caractere);
        }
        if (atual.Length > 0) yield return atual.ToString();
    }

    private Task AbrirConfiguracao()
    {
        using var tela = new ConfigForm(baseDir);
        tela.ShowDialog(this);
        return Task.CompletedTask;
    }
    private Task AbrirPasta() => Abrir(baseDir);
    private void OcultarNaBandeja()
    {
        Hide();
        bandeja.ShowBalloonTip(1500, "Agente Conecta Notifica", "A Central continua disponível ao lado do relógio.", ToolTipIcon.Info);
    }
    private void MostrarJanela()
    {
        Show(); WindowState = FormWindowState.Normal; Activate();
    }
    private void Sair()
    {
        encerrar = true; bandeja.Visible = false; Close();
    }
    private void AoFechar(object? sender, FormClosingEventArgs e)
    {
        if (encerrar) { bandeja.Visible = false; return; }
        e.Cancel = true; OcultarNaBandeja();
    }
    private Task Abrir(string caminho)
    {
        try { Process.Start(new ProcessStartInfo(caminho) { UseShellExecute = true }); Mostrar("CONCLUÍDO\r\nItem aberto no Windows."); }
        catch (Exception ex) { Mostrar("NÃO CONCLUÍDO\r\n" + ex.Message); }
        return Task.CompletedTask;
    }
    private void Bloquear(bool bloquear)
    {
        operacaoEmAndamento = bloquear;
        foreach (var b in botoes) b.Enabled = !bloquear;
        if (!bloquear) AtualizarEstadosBotoes();
    }
    private void AtualizarEstadosBotoes()
    {
        if (operacaoEmAndamento) return;
        botaoIniciar.Enabled = !servicoRodando;
        botaoParar.Enabled = servicoRodando;
        botaoSincronizar.Enabled = consultaAlunosConfigurada;
    }
    private void Mostrar(string texto) => detalhesStatus.Text = texto;
}

internal sealed class ConfigForm : Form
{
    private readonly string dir;
    private readonly bool primeiraConfiguracao;
    private readonly Dictionary<string, Control> campos = [];
    private readonly Label aviso = new() { AutoSize = true, ForeColor = Color.FromArgb(82, 101, 122) };
    public bool Configurado { get; private set; }

    public ConfigForm(string baseDir, bool primeiraConfiguracao = false)
    {
        dir = baseDir; this.primeiraConfiguracao = primeiraConfiguracao;
        Text = primeiraConfiguracao ? "Agente Conecta Notifica — Primeira configuração" : "Configurar Agente Conecta Notifica";
        Size = new Size(650, primeiraConfiguracao ? 660 : 610); StartPosition = FormStartPosition.CenterParent;
        var p = new TableLayoutPanel { Dock = DockStyle.Fill, Padding = new Padding(24), ColumnCount = 2, AutoScroll = true };
        p.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 175)); p.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        if (primeiraConfiguracao)
        {
            var titulo = new Label { Text = "Vamos conectar a catraca ao painel", Font = new Font("Segoe UI Semibold", 15), AutoSize = true, Margin = new Padding(0, 0, 0, 4) };
            var explicacao = new Label { Text = "Informe os dados do SQL Server e a chave da escola. O agente só lê as marcações; ao concluir, ele testa as conexões e instala o serviço.", AutoSize = true, MaximumSize = new Size(550, 0), ForeColor = Color.FromArgb(82, 101, 122), Margin = new Padding(0, 0, 0, 14) };
            p.Controls.Add(titulo, 0, p.RowCount); p.SetColumnSpan(titulo, 2); p.RowCount++;
            p.Controls.Add(explicacao, 0, p.RowCount); p.SetColumnSpan(explicacao, 2); p.RowCount++;
        }
        foreach (var item in new[] { ("Escola", "escola", false), ("Servidor SQL", "servidor", false), ("Instância SQL", "instancia", false), ("Porta SQL", "porta", false), ("Banco de dados", "database", false), ("Usuário SQL", "usuario", false), ("Senha SQL", "senha", true), ("URL do painel", "url", false), ("Chave da escola", "chave", true) }) AddCampo(p, item.Item1, item.Item2, item.Item3);
        if (primeiraConfiguracao)
        {
            // Valores seguros para a instalação local mais comum. O assistente
            // ainda exige que a escola informe os dados que não podem ser
            // presumidos, como senha e chave da API.
            Set("servidor", "localhost");
            Set("porta", "1433");
            Set("usuario", "notifica_ro");
            Set("url", "https://painel.conectapontoeacesso.com.br/api");
        }
        if (primeiraConfiguracao)
        {
            var detectar = new Button { Text = "Procurar SQL Server nesta máquina", AutoSize = true, Margin = new Padding(0, 14, 0, 0) };
            detectar.Click += async (_, _) => await DetectarBanco(detectar);
            p.Controls.Add(detectar, 1, p.RowCount); p.RowCount++;
        }
        var salvar = new Button { Text = primeiraConfiguracao ? "Salvar, testar e concluir" : "Salvar configuração", AutoSize = true, BackColor = Color.FromArgb(11,103,194), ForeColor = Color.White, FlatStyle = FlatStyle.Flat, UseVisualStyleBackColor = false, Margin = new Padding(0, 16, 0, 0) };
        salvar.Click += async (_, _) => await Salvar(salvar); p.Controls.Add(salvar, 1, p.RowCount); p.RowCount++; p.Controls.Add(aviso, 1, p.RowCount);
        Controls.Add(p); Shown += async (_, _) => await Carregar();
    }
    private void AddCampo(TableLayoutPanel p, string rotulo, string chave, bool senha)
    {
        Control campo = chave == "database"
            ? new ComboBox { Dock = DockStyle.Top, DropDownStyle = ComboBoxStyle.DropDown }
            : new TextBox { Dock = DockStyle.Top, UseSystemPasswordChar = senha };
        campos[chave] = campo;
        p.Controls.Add(new Label { Text = rotulo, AutoSize = true, Margin = new Padding(0, 8, 4, 0) }, 0, p.RowCount);
        p.Controls.Add(campo, 1, p.RowCount); p.RowCount++;
    }
    private void PreencherBancos(string bancos)
    {
        if (campos["database"] is not ComboBox lista) return;
        var atual = lista.Text;
        lista.BeginUpdate(); lista.Items.Clear();
        foreach (var banco in bancos.Split('|', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).Distinct(StringComparer.OrdinalIgnoreCase)) lista.Items.Add(banco);
        lista.EndUpdate(); lista.Text = atual;
    }
    private async Task Carregar()
    {
        try { var r = await Task.Run(() => Core(dir, "config-json", "-config", Path.Combine(dir,"config.yaml"))); var d = System.Text.Json.JsonSerializer.Deserialize<ConfigDados>(r.Texto); if (d == null) return; Set("escola",d.Escola); Set("servidor",d.Servidor); Set("instancia",d.Instancia); Set("porta",d.Porta.ToString()); Set("database",d.Database); Set("usuario",d.Usuario); Set("senha",d.Senha); Set("url",d.URL); Set("chave",d.Chave); aviso.Text="Configuração atual carregada."; } catch { aviso.Text="Preencha os campos para criar a configuração."; }
    }
    private async Task DetectarBanco(Button botao)
    {
        var arquivo = Path.Combine(Path.GetTempPath(), "conecta-notifica-deteccao-" + Guid.NewGuid().ToString("N") + ".ini");
        botao.Enabled = false; aviso.Text = "Procurando o SQL Server nesta máquina…";
        try
        {
            var r = await Task.Run(() => Core(dir, "detectar", "-saida", arquivo));
            if (!File.Exists(arquivo)) { aviso.Text = r.Texto.Length == 0 ? "Não encontrei o SQL Server automaticamente. Preencha os campos." : r.Texto; return; }
            var encontrados = File.ReadLines(arquivo)
                .Select(l => l.Split('=', 2))
                .Where(p => p.Length == 2)
                .ToDictionary(p => p[0].Trim(), p => p[1].Trim(), StringComparer.OrdinalIgnoreCase);
            PreencherBancos(encontrados.GetValueOrDefault("bancos", ""));
            foreach (var campo in new[] { "servidor", "instancia", "porta", "database" })
                if (encontrados.TryGetValue(campo, out var valor) && valor.Length > 0) Set(campo, valor);
            aviso.Text = encontrados.TryGetValue("aviso", out var mensagem) && mensagem.Length > 0
                ? "Aviso: " + mensagem
                : "Dados encontrados. Confira antes de concluir.";
        }
        catch (Exception ex) { aviso.Text = "Não consegui procurar automaticamente: " + ex.Message; }
        finally { if (File.Exists(arquivo)) File.Delete(arquivo); botao.Enabled = true; }
    }
    private async Task Salvar(Button salvar)
    {
        salvar.Enabled=false; aviso.Text="Salvando…";
        try
        {
            var a=new List<string>{"configurar","-config",Path.Combine(dir,"config.yaml")};
            foreach(var par in new[]{("escola","-escola"),("servidor","-servidor"),("instancia","-instancia"),("porta","-porta"),("database","-database"),("usuario","-usuario"),("senha","-senha"),("url","-url"),("chave","-api-key")}) { var v=campos[par.Item1].Text.Trim(); if(v.Length>0){a.Add(par.Item2);a.Add(v);} }
            if (primeiraConfiguracao) a.Add("-testar");
            var r=await Task.Run(()=>Core(dir,a.ToArray()));
            if (r.Codigo != 0) { aviso.Text=r.Texto; return; }
            if (!primeiraConfiguracao) { aviso.Text="Configuração salva com sucesso."; return; }

            aviso.Text="Conexões aprovadas. Instalando o serviço…";
            var reparo=await Task.Run(()=>Core(dir,"reparar","-config",Path.Combine(dir,"config.yaml")));
            if (reparo.Codigo != 0) { aviso.Text="A configuração foi salva, mas o serviço não foi instalado.\r\n"+reparo.Texto; return; }
            Configurado = true;
            aviso.Text="Tudo pronto. O agente está configurado e o serviço foi iniciado.";
            MessageBox.Show(this, "Configuração concluída. A Central do Agente será aberta agora.", "Agente Conecta Notifica", MessageBoxButtons.OK, MessageBoxIcon.Information);
            Close();
        }
        catch(Exception ex){aviso.Text=ex.Message;}
        finally{salvar.Enabled=true;}
    }
    private void Set(string k,string v)=>campos[k].Text=v??"";
    private static (int Codigo,string Texto) Core(string dir, params string[] args) { using var p=new Process{StartInfo=new ProcessStartInfo(Path.Combine(dir,"notifica-core.exe")){UseShellExecute=false,CreateNoWindow=true,RedirectStandardOutput=true,RedirectStandardError=true,StandardOutputEncoding=Encoding.UTF8,StandardErrorEncoding=Encoding.UTF8,WorkingDirectory=dir}}; foreach(var a in args)p.StartInfo.ArgumentList.Add(a); p.Start(); var o=p.StandardOutput.ReadToEnd(); var e=p.StandardError.ReadToEnd(); p.WaitForExit(); return(p.ExitCode,(o+"\r\n"+e).Trim()); }
    private sealed record ConfigDados(string Escola,string Servidor,string Instancia,string Database,string Usuario,string Senha,string URL,string Chave,int Porta);
}
