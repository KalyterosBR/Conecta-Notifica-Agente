/* -----------------------------------------------------------------------
   Cria o login que o agente usa. Somente leitura, sem acesso a nada além
   das tabelas que ele precisa ler.
   Troque a senha e o nome do banco antes de rodar.
   ----------------------------------------------------------------------- */
/* ATENCAO: o SQL Server precisa estar em modo misto de autenticacao
   ("SQL Server and Windows Authentication mode"), senao qualquer login SQL
   e recusado: SSMS > botao direito no servidor > Propriedades > Seguranca,
   e reinicie o servico depois de mudar. */
USE [master];
GO
CREATE LOGIN [notifica_ro] WITH PASSWORD = 'TROQUE-ESTA-SENHA',
    CHECK_POLICY = ON, DEFAULT_DATABASE = [master];
GO

USE [PontoAcesso];   -- nome real da base da catraca
GO
CREATE USER [notifica_ro] FOR LOGIN [notifica_ro];
GO

-- Leitura só do que o agente consulta.
GRANT SELECT ON dbo.Marcacao TO [notifica_ro];
GRANT SELECT ON dbo.Locais   TO [notifica_ro];
GRANT SELECT ON dbo.Inners   TO [notifica_ro];
-- Descomente com o nome real da tabela de pessoas, se for sincronizar alunos:
-- GRANT SELECT ON dbo.Pessoas TO [notifica_ro];

-- Necessário para o comando `descobrir` enxergar o catálogo.
GRANT VIEW DEFINITION ON dbo.Marcacao TO [notifica_ro];
GO

-- Confirme que ele não escreve em nada:
-- EXECUTE AS USER = 'notifica_ro'; SELECT TOP 1 * FROM dbo.Marcacao; REVERT;
