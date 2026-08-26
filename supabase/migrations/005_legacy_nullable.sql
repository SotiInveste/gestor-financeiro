-- ═══════════════════════════════════════════════════════════
-- 005 — Tornar category_legacy opcional
--
-- A 004 renomeou category para category_legacy mas manteve o
-- not null. Como o código novo escreve category_id e já não
-- toca na coluna antiga, TODAS as inserções passaram a falhar:
-- regras novas, movimentos manuais, importação de Excel e
-- sincronização com o banco.
--
-- A coluna fica como rede de segurança para as linhas que já
-- existem, e é largada na Fase 6. Até lá tem de aceitar nulos.
--
-- Idempotente e sem perda de dados: só relaxa uma restrição.
-- ═══════════════════════════════════════════════════════════

alter table public.fin_transactions alter column category_legacy drop not null;
alter table public.fin_rules        alter column category_legacy drop not null;


-- ═══════════════════════════════════════════════════════════
-- Validação — as quatro linhas devem mostrar:
--   category_id      NO   (obrigatória)
--   category_legacy  YES  (opcional)
-- ═══════════════════════════════════════════════════════════

select
  table_name,
  column_name,
  is_nullable,
  case
    when column_name = 'category_id'     and is_nullable = 'NO'  then 'OK'
    when column_name = 'category_legacy' and is_nullable = 'YES' then 'OK'
    else 'INESPERADO'
  end as veredicto
from information_schema.columns
where table_schema = 'public'
  and table_name in ('fin_transactions', 'fin_rules')
  and column_name in ('category_id', 'category_legacy')
order by table_name, column_name;
