param([string]$RaizAgente = (Split-Path $PSScriptRoot -Parent))
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;

public static class IconesAgente {
    public static void Gerar(string origem, string destino, string status) {
        int[] tamanhos = {16,20,24,32,40,48,64,96,128,256};
        var imagens = new List<byte[]>();
        using (var logo = Image.FromFile(origem)) {
            foreach (int tamanho in tamanhos) {
                int grande = tamanho * 8;
                using (var tela = new Bitmap(grande, grande, PixelFormat.Format32bppArgb))
                using (var g = Graphics.FromImage(tela)) {
                    g.Clear(Color.Transparent);
                    g.SmoothingMode = SmoothingMode.AntiAlias;
                    g.InterpolationMode = InterpolationMode.HighQualityBicubic;
                    g.PixelOffsetMode = PixelOffsetMode.HighQuality;
                    float largura = grande * (status == "" ? .94f : .84f);
                    float altura = largura * logo.Height / logo.Width;
                    float x = grande * (status == "" ? .03f : .025f);
                    float y = status == "" ? (grande-altura)/2 : grande*.09f;
                    g.DrawImage(logo, new RectangleF(x,y,largura,altura));
                    if (status != "") {
                        float diametro = grande * .34f;
                        var r = new RectangleF(grande*.79f-diametro/2,grande*.78f-diametro/2,diametro,diametro);
                        using (var pincel = new SolidBrush(status == "verde" ? Color.SeaGreen : Color.Firebrick))
                        using (var contorno = new Pen(Color.White, grande*.055f)) {
                            g.FillEllipse(pincel,r);
                            g.DrawEllipse(contorno,r);
                        }
                    }
                    using (var final = new Bitmap(tamanho,tamanho,PixelFormat.Format32bppArgb))
                    using (var gf = Graphics.FromImage(final))
                    using (var ms = new MemoryStream()) {
                        gf.InterpolationMode = InterpolationMode.HighQualityBicubic;
                        gf.PixelOffsetMode = PixelOffsetMode.HighQuality;
                        gf.CompositingMode = CompositingMode.SourceCopy;
                        gf.DrawImage(tela,new Rectangle(0,0,tamanho,tamanho));
                        final.Save(ms,ImageFormat.Png);
                        imagens.Add(ms.ToArray());
                    }
                }
            }
        }
        Directory.CreateDirectory(Path.GetDirectoryName(destino));
        using (var w = new BinaryWriter(File.Create(destino))) {
            w.Write((ushort)0); w.Write((ushort)1); w.Write((ushort)tamanhos.Length);
            uint offset = (uint)(6+16*tamanhos.Length);
            for (int i=0;i<tamanhos.Length;i++) {
                byte dimensao = tamanhos[i] == 256 ? (byte)0 : (byte)tamanhos[i];
                w.Write(dimensao); w.Write(dimensao); w.Write((byte)0); w.Write((byte)0);
                w.Write((ushort)1); w.Write((ushort)32);
                w.Write((uint)imagens[i].Length); w.Write(offset);
                offset += (uint)imagens[i].Length;
            }
            foreach (byte[] png in imagens) w.Write(png);
        }
    }
}
'@
$origem = Join-Path $RaizAgente 'gui\assets\logo-conecta-simbolo.png'
[IconesAgente]::Gerar($origem, (Join-Path $RaizAgente 'gui\assets\conecta.ico'), '')
[IconesAgente]::Gerar($origem, (Join-Path $RaizAgente 'internal\bandeja\assets\conectado.ico'), 'verde')
[IconesAgente]::Gerar($origem, (Join-Path $RaizAgente 'internal\bandeja\assets\desconectado.ico'), 'vermelho')
