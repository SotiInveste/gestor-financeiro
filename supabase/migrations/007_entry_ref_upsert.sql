-- ═══════════════════════════════════════════════════════════
-- 007 — Tornar a sincronização idempotente
--
-- O índice fin_transactions_entry_ref_uniq era parcial
-- (`where entry_reference is not null`). Duas consequências:
--
--   1. Um índice parcial não pode ser alvo de ON CONFLICT — o
--      Postgres não consegue inferi-lo a partir das colunas —,
--      por isso a sincronização tinha de fazer INSERT simples e
--      confiar num filtro do lado do cliente.
--
--   2. Esse filtro lê o estado local, que só tem movimentos não
--      apagados. Um movimento do banco apagado (soft delete)
--      continua a ocupar o índice, o filtro não o vê, e a
--      sincronização seguinte tenta reinseri-lo:
--      "duplicate key value violates unique constraint".
--
-- Um índice não parcial resolve as duas: os nulos são distintos
-- entre si por omissão, portanto as linhas importadas de Excel
-- (entry_reference nulo) continuam a não colidir umas com as
-- outras, e o ON CONFLICT passa a ser utilizável.
--
-- Com isso a sincronização passa a fazer upsert com
-- ignoreDuplicates, e a deduplicação deixa de depender do estado
-- do cliente. Ver js/openbanking.js.
--
-- Idempotente e sem perda de dados: só troca um índice por outro.
-- ═══════════════════════════════════════════════════════════

drop index if exists public.fin_transactions_entry_ref_uniq;

create unique index if not exists fin_transactions_entry_ref_uniq
  on public.fin_transactions (bank_account_id, entry_reference);


-- ═══════════════════════════════════════════════════════════
-- Validação — o indexdef NÃO deve conter "WHERE"
-- ═══════════════════════════════════════════════════════════

select
  indexname,
  indexdef,
  case
    when indexdef ilike '%where%' then 'AINDA PARCIAL — o ON CONFLICT nao vai funcionar'
    else 'OK'
  end as veredicto
from pg_indexes
where schemaname = 'public'
  and indexname = 'fin_transactions_entry_ref_uniq';


-- ═══════════════════════════════════════════════════════════
-- Nota sobre movimentos do banco apagados
-- ═══════════════════════════════════════════════════════════
--
-- A partir daqui, um movimento do banco que tenha sido apagado
-- deixa de voltar nas sincronizações seguintes: o upsert encontra
-- a linha e ignora-a. É o comportamento pretendido — foi apagado
-- de propósito.
--
-- Para o recuperar, reverter o soft delete em vez de sincronizar:
--
--   update fin_transactions
--   set deleted_at = null
--   where entry_reference = 'REFERENCIA_AQUI';
--
-- Para ver quais estão nessa situação:
--
--   select value_date, description, amount, deleted_at
--   from fin_transactions
--   where deleted_at is not null and entry_reference is not null
--   order by value_date desc;
