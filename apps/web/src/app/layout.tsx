import type { Metadata } from 'next';
import { Nunito, Plus_Jakarta_Sans } from 'next/font/google';
import './globals.css';

const titulo = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['500', '600', '700', '800'],
  variable: '--font-titulo',
});
const corpo = Nunito({
  subsets: ['latin'],
  weight: ['500', '600', '700', '800'],
  variable: '--font-corpo',
});

export const metadata: Metadata = {
  title: 'Conecta Notifica — painel da escola',
  description: 'Painel da escola — avisos de entrada e saída via WhatsApp',
  icons: { icon: '/notifica-favicon.svg' },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body className={`${titulo.variable} ${corpo.variable}`}>
        {/* ícones Tabler (mesma webfont do mockup); o React iça o link para o head */}
        <link
          rel="stylesheet"
          precedence="default"
          href="https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@3.30.0/dist/tabler-icons.min.css"
        />
        {children}
      </body>
    </html>
  );
}
