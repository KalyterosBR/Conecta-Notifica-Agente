/* -----------------------------------------------------------------------
   Cria o login que o agente usa. Somente leitura, sem acesso a nada além
   das tabelas que ele precisa ler.
   Troque a senha e, se necessário, o nome do banco antes de rodar.
   Execute no SSMS usando uma conta administradora do SQL Server. O agente
   nunca cria este login automaticamente nem recebe permissão para fazê-lo.
   ----------------------------------------------------------------------- */
/* ATENCAO: o SQL Server precisa estar em modo misto de autenticacao
   ("SQL Server and Windows Authentication mode"), senao qualquer login SQL
   e recusado: SSMS > botao direito no servidor > Propriedades > Seguranca,
   e reinicie o servico depois de mudar. */
USE [master];
GO
IF NOT EXISTS (SELECT 1 FROM sys.sql_logins WHERE name = N'notifica_ro')
BEGIN
    CREATE LOGIN [notifica_ro] WITH PASSWORD = 'TROQUE-ESTA-SENHA',
        CHECK_POLICY = ON, DEFAULT_DATABASE = [master];
END
GO

USE [TopPortaria];   -- troque apenas se a base da catraca tiver outro nome
GO
IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = N'notifica_ro')
    CREATE USER [notifica_ro] FOR LOGIN [notifica_ro];
GO

-- Leitura mínima para a operação: o agente nunca grava no SQL Server.
GRANT SELECT ON dbo.Marcacao TO [notifica_ro];
-- Descomente apenas se a sincronização de alunos estiver habilitada:
-- GRANT SELECT ON dbo.Pessoas TO [notifica_ro];
GO

-- Confirme que ele não escreve em nada:
-- EXECUTE AS USER = 'notifica_ro'; SELECT TOP 1 * FROM dbo.Marcacao; REVERT;
