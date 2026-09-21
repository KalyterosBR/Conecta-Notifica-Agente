'use client';
// Login mínimo — regras (recuperação, expiração, política de senha) entram
// numa rodada futura.
import { useRouter } from 'next/navigation';
import { FormEvent, useState } from 'react';
import { api, guardarSessao } from '@/lib/api';
import { LogoMarca } from '@/lib/ui';

export default function Login() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState('');
  const [enviando, setEnviando] = useState(false);

  async function entrar(e: FormEvent) {
    e.preventDefault();
    setErro('');
    setEnviando(true);
    try {
      const sessao = await api<{
        token: string;
        user: { name: string; school_id: string | null };
      }>('/v1/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password: senha }),
      });
      // Sem escola vinculada = operador interno; vai para o back-office.
      const admin = sessao.user.school_id === null;
      guardarSessao(sessao.token, sessao.user.name, admin);
      router.replace(admin ? '/admin' : '/painel');
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'não foi possível entrar');
      setEnviando(false);
    }
  }

  return (
    <main className="login-fundo">
      <form className="login-card" onSubmit={entrar}>
        <div className="logo">
          <LogoMarca cor="var(--brand)" />
          <b>
            Conecta
            <span>NOTIFICA</span>
          </b>
        </div>
        <h1>Bem-vindo de volta</h1>
        <p className="sub">Entre para acompanhar os acessos da sua escola.</p>
        {erro && <div className="erro">{erro}</div>}
        <div className="campo">
          <label htmlFor="email">E-mail</label>
          <input
            id="email"
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>
        <div className="campo">
          <label htmlFor="senha">Senha</label>
          <input
            id="senha"
            type="password"
            autoComplete="current-password"
            value={senha}
            onChange={(e) => setSenha(e.target.value)}
            required
          />
        </div>
        <button className="botao" disabled={enviando}>
          {enviando ? 'Entrando…' : 'Entrar'}
        </button>
      </form>
    </main>
  );
}
