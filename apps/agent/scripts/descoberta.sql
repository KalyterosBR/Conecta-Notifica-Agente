/* -----------------------------------------------------------------------
   Conecta Notifica — reconhecimento do banco da catraca
   Rode no SSMS conectado na base da escola. Tudo aqui é SELECT.
   Equivale a `notifica-agent descobrir`.
   ----------------------------------------------------------------------- */

-- 1. Colunas de dbo.Marcacao. EhIdentity = 1 em Codigo libera o cursor por
--    Codigo, que é o modo preferido.
SELECT c.name AS Coluna, t.name AS Tipo, c.max_length AS Tamanho,
       c.is_nullable AS Nulo,
       COLUMNPROPERTY(c.object_id, c.name, 'IsIdentity') AS EhIdentity
  FROM sys.columns c
  JOIN sys.types t ON t.user_type_id = c.user_type_id
 WHERE c.object_id = OBJECT_ID('dbo.Marcacao')
 ORDER BY c.column_id;

-- 2. Volume e formato de DataHora (12 chars costuma ser YYMMDDHHMMSS).
SELECT COUNT(*) AS Linhas, MIN(DataHora) AS MenorDataHora,
       MAX(DataHora) AS MaiorDataHora, MAX(Codigo) AS MaiorCodigo
  FROM dbo.Marcacao WITH (NOLOCK);

-- 3. Amostra recente.
SELECT TOP 20 Codigo, CodigoPessoa, Inners, Origem, Complemento,
       Cartao, DataHora, Original, CodigoLocal
  FROM dbo.Marcacao WITH (NOLOCK)
 ORDER BY DataHora DESC;

-- 4. Qual coluna separa entrada de saída? Compare a distribuição das quatro.
SELECT 'Origem' AS Coluna, CAST(Origem AS varchar(20)) AS Valor, COUNT(*) AS Qtd
  FROM dbo.Marcacao WITH (NOLOCK) GROUP BY Origem
UNION ALL
SELECT 'Complemento', CAST(Complemento AS varchar(20)), COUNT(*)
  FROM dbo.Marcacao WITH (NOLOCK) GROUP BY Complemento
UNION ALL
SELECT 'CodigoLocal', CAST(CodigoLocal AS varchar(20)), COUNT(*)
  FROM dbo.Marcacao WITH (NOLOCK) GROUP BY CodigoLocal
UNION ALL
SELECT 'Inners', CAST(Inners AS varchar(20)), COUNT(*)
  FROM dbo.Marcacao WITH (NOLOCK) GROUP BY Inners
 ORDER BY Coluna, Qtd DESC;

-- 5. Nomes de local e equipamento normalmente revelam o sentido
--    (ex.: "PORTARIA ENTRADA" / "PORTARIA SAIDA").
SELECT TOP 50 * FROM dbo.Locais WITH (NOLOCK);
SELECT TOP 50 * FROM dbo.Inners WITH (NOLOCK);

-- 6. Para onde aponta Marcacao.CodigoPessoa (tabela do cadastro de alunos).
SELECT fk.name AS FK, OBJECT_NAME(fk.parent_object_id) AS Tabela,
       OBJECT_NAME(fk.referenced_object_id) AS TabelaReferenciada
  FROM sys.foreign_keys fk
 WHERE fk.parent_object_id = OBJECT_ID('dbo.Marcacao');

SELECT s.name AS Esquema, t.name AS Tabela,
       (SELECT SUM(p.rows) FROM sys.partitions p
         WHERE p.object_id = t.object_id AND p.index_id IN (0,1)) AS Linhas
  FROM sys.tables t JOIN sys.schemas s ON s.schema_id = t.schema_id
 WHERE t.name LIKE '%Pesso%' OR t.name LIKE '%Aluno%'
    OR t.name LIKE '%Funcion%' OR t.name LIKE '%Cadastr%'
 ORDER BY t.name;

-- 7. Índice de apoio ao polling. Só crie com o aval de quem mantém o software
--    da catraca — é a única instrução destas duas pastas que altera a base.
-- CREATE NONCLUSTERED INDEX IX_Marcacao_DataHora
--     ON dbo.Marcacao (DataHora) INCLUDE (Codigo, CodigoPessoa, Cartao, CodigoLocal, Inners);
