'use client';
// Integrações — conexões do Conecta Notifica com outros sistemas.
import { useEffect, useState } from 'react';
import { api, Configuracoes, VisaoGeral } from '@/lib/api';
import { Ic } from '@/lib/ui';

export default function PaginaIntegracoes() {
  const [config, setConfig] = useState<Configuracoes | null>(null);
  const [resumo, setResumo] = useState<VisaoGeral | null>(null);

  useEffect(() => {
    api<Configuracoes>('/v1/painel/configuracoes').then(setConfig).catch(() => {});
    api<VisaoGeral>('/v1/painel/visao-geral').then(setResumo).catch(() => {});
  }, []);

  const agenteOk = resumo?.agente.online ?? false;
  const whatsOk = config?.whatsapp.conectado ?? false;

  return (
    <section>
      <div className="phead">
        <div>
          <h1>Integrações</h1>
          <p className="sub">Conexões do Conecta Notifica com outros sistemas</p>
        </div>
      </div>
      <div className="intg">
        <div className="card">
          <span className="ic" style={{ background: 'var(--sky-soft)', color: '#1A4FA3' }}>
            <Ic nome="database" />
          </span>
          <b>Catraca · SQL Server</b>
          <small>Agente local lendo eventos e alunos do software de controle de acesso.</small>
          {agenteOk ? (
            <span className="pill p-mint" style={{ alignSelf: 'flex-start' }}>
              <Ic nome="plug-connected" />
              Conectado
            </span>
          ) : (
            <span className="pill p-coral" style={{ alignSelf: 'flex-start' }}>
              <Ic nome="plug-connected-x" />
              Offline
            </span>
          )}
        </div>
        <div className="card">
          <span className="ic" style={{ background: 'var(--mint-soft)', color: '#106B48' }}>
            <Ic nome="brand-whatsapp" />
          </span>
          <b>UAZAPI</b>
          <small>Provedor atual de envio das mensagens de WhatsApp.</small>
          {whatsOk ? (
            <span className="pill p-mint" style={{ alignSelf: 'flex-start' }}>
              <Ic nome="plug-connected" />
              Conectado
            </span>
          ) : (
            <span className="pill p-sun" style={{ alignSelf: 'flex-start' }}>
              <Ic nome="clock" />
              Não conectado
            </span>
          )}
        </div>
        <div className="card">
          <span className="ic" style={{ background: 'var(--violet-soft)', color: '#5546C9' }}>
            <Ic nome="brand-meta" />
          </span>
          <b>WhatsApp Cloud API</b>
          <small>API oficial da Meta. Disponível nos planos superiores.</small>
          <span className="pill p-grey" style={{ alignSelf: 'flex-start' }}>
            Em breve
          </span>
        </div>
        <div className="card">
          <span className="ic" style={{ background: 'var(--sun-soft)', color: '#8A5A00' }}>
            <Ic nome="webhook" />
          </span>
          <b>Webhooks</b>
          <small>Receba os eventos de acesso no seu próprio sistema.</small>
          <span className="pill p-grey" style={{ alignSelf: 'flex-start' }}>
            Em breve
          </span>
        </div>
      </div>
    </section>
  );
}
