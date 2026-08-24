-- ═══════════════════════════════════════════════════════════
-- Migração 001 — Integração open banking (Enable Banking)
--
-- Aditiva e idempotente: pode ser corrida mais do que uma vez sem
-- efeitos secundários. Não altera nem apaga dados existentes.
--
-- Correr no SQL Editor do Supabase.
-- ═══════════════════════════════════════════════════════════


-- ─── 1. Contas bancárias ligadas ───
--
-- O identification_hash é a única referência estável da conta: ao
-- reautorizar, o session_id e o account_uid mudam, o hash não. É por
-- ele que se reassocia a conta existente em vez de criar um duplicado.

create table if not exists public.fin_bank_accounts (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users (id) on delete cascade,

  identification_hash text not null,
  account_uid         text,
  session_id          text,

  aspsp_name          text,
  aspsp_country       text,
  display_name        text,

  consent_expires_at  timestamptz,
  last_synced_at      timestamptz,

  created_at          timestamptz not null default now(),
  deleted_at          timestamptz
);

create unique index if not exists fin_bank_accounts_user_hash_uniq
  on public.fin_bank_accounts (user_id, identification_hash);

create index if not exists fin_bank_accounts_user_idx
  on public.fin_bank_accounts (user_id)
  where deleted_at is null;


-- ─── 2. Políticas RLS ───
--
-- Sem política de DELETE por desenho: eliminar é sempre soft delete
-- (deleted_at). As Edge Functions usam a service_role e contornam o RLS.

alter table public.fin_bank_accounts enable row level security;

drop policy if exists fin_bank_accounts_select on public.fin_bank_accounts;
create policy fin_bank_accounts_select on public.fin_bank_accounts
  for select using (auth.uid() = user_id);

drop policy if exists fin_bank_accounts_insert on public.fin_bank_accounts;
create policy fin_bank_accounts_insert on public.fin_bank_accounts
  for insert with check (auth.uid() = user_id);

drop policy if exists fin_bank_accounts_update on public.fin_bank_accounts;
create policy fin_bank_accounts_update on public.fin_bank_accounts
  for update using (auth.uid() = user_id)
           with check (auth.uid() = user_id);


-- ─── 3. Movimentos vindos da API ───
--
-- entry_reference é a referência imutável por conta devolvida pela
-- Enable Banking. Nunca usar transaction_id — não é estável.
--
-- Fica nulo nos movimentos importados de Excel, que continuam a
-- deduplicar por source_hash. As duas origens coexistem na mesma tabela.

alter table public.fin_transactions
  add column if not exists entry_reference text,
  add column if not exists bank_account_id uuid references public.fin_bank_accounts (id);

-- Unicidade por conta, apenas onde a referência existe (índice parcial):
-- não interfere com as linhas importadas de Excel.
create unique index if not exists fin_transactions_entry_ref_uniq
  on public.fin_transactions (bank_account_id, entry_reference)
  where entry_reference is not null;

create index if not exists fin_transactions_bank_account_idx
  on public.fin_transactions (bank_account_id)
  where deleted_at is null;


-- ─── 4. Correção do índice de fin_rules ───
--
-- Bug conhecido: o índice único foi criado sobre upper(keyword), mas os
-- upserts em db.js usam onConflict "user_id,keyword". A expressão nunca
-- corresponde às colunas, por isso o upsert falha em vez de atualizar.
--
-- O db.js já normaliza a keyword para maiúsculas antes de gravar
-- (upsertRule), por isso um índice simples sobre as colunas é suficiente.

do $$
declare
  idx record;
begin
  for idx in
    select indexname
    from pg_indexes
    where schemaname = 'public'
      and tablename  = 'fin_rules'
      and indexdef ilike '%upper(%'
  loop
    execute format('drop index if exists public.%I', idx.indexname);
  end loop;
end $$;

create unique index if not exists fin_rules_user_keyword_uniq
  on public.fin_rules (user_id, keyword);


-- ═══════════════════════════════════════════════════════════
-- Verificação (correr à parte, depois da migração)
-- ═══════════════════════════════════════════════════════════
--
-- Índices de fin_rules — deve sobrar apenas o fin_rules_user_keyword_uniq
-- como único, sem expressão upper():
--
--   select indexname, indexdef from pg_indexes
--   where schemaname = 'public' and tablename = 'fin_rules';
--
-- Colunas novas em fin_transactions:
--
--   select column_name, data_type, is_nullable
--   from information_schema.columns
--   where table_schema = 'public' and table_name = 'fin_transactions'
--     and column_name in ('entry_reference', 'bank_account_id');
--
-- Keywords duplicadas por diferença de maiúsculas — se devolver linhas,
-- é preciso resolver antes de o índice único poder ser criado:
--
--   select user_id, upper(keyword), count(*)
--   from public.fin_rules
--   group by 1, 2 having count(*) > 1;
