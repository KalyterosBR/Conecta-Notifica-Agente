-- ============================================================
-- Conecta Notifica — criação do banco e do usuário da aplicação
-- Rode UMA VEZ, conectado como superusuário (postgres):
--   psql -h SEU_HOST -U postgres -f 01-servidor.sql
-- TROQUE A SENHA antes de executar.
-- ============================================================

-- Usuário que a API usa no dia a dia (não é superusuário de propósito).
CREATE ROLE conecta_app WITH LOGIN PASSWORD 'TROQUE-ESTA-SENHA';

CREATE DATABASE conecta_notifica
  WITH OWNER = conecta_app
       ENCODING = 'UTF8'
       LC_COLLATE = 'pt_BR.UTF-8'
       LC_CTYPE = 'pt_BR.UTF-8'
       TEMPLATE = template0;

COMMENT ON DATABASE conecta_notifica IS 'Conecta Notifica — SaaS de avisos de entrada/saída';

-- Se o servidor não tiver o locale pt_BR, troque as duas linhas LC_ por:
--        LC_COLLATE = 'en_US.UTF-8'
--        LC_CTYPE = 'en_US.UTF-8'
-- (ou remova ambas para usar o padrão do servidor)
