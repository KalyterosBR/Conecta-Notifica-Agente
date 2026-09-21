// Hash de senha com scrypt do Node — sem dependência nativa.
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

export function gerarHashSenha(senha: string): string {
  const sal = randomBytes(16).toString('hex');
  const hash = scryptSync(senha, sal, 64).toString('hex');
  return `scrypt$${sal}$${hash}`;
}

export function conferirSenha(senha: string, guardado: string): boolean {
  const [esquema, sal, hash] = (guardado ?? '').split('$');
  if (esquema !== 'scrypt' || !sal || !hash) return false;
  const calculado = scryptSync(senha, sal, 64);
  const alvo = Buffer.from(hash, 'hex');
  return calculado.length === alvo.length && timingSafeEqual(calculado, alvo);
}
