'use client';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { tokenAtual } from '@/lib/api';

export default function Raiz() {
  const router = useRouter();
  useEffect(() => {
    router.replace(tokenAtual() ? '/painel' : '/login');
  }, [router]);
  return null;
}
