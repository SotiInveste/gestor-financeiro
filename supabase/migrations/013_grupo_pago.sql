-- ═══════════════════════════════════════════════════════════
-- 013 — Marcar um período de um grupo como pago
--
-- O quadro de resumo por grupo (hoje o «Despesas Wheelt», código 27)
-- passa a ter um visto «Pago» na linha de total. É por PERÍODO, não
-- por movimento: marca que o mês inteiro daquele grupo já foi pago.
--
-- A tabela guarda o grupo pelo CÓDIGO e não pelo id. É o mesmo
-- critério do resto: o nome muda e o id é um uuid, o código é
-- estável e nunca reutilizado (ver a migração 002).
--
-- A presença da linha é que significa "pago". Desmarcar apaga-a, em
-- vez de gravar um booleano a false — não há estado intermédio para
-- guardar e assim não ficam linhas mortas na tabela.
--
-- Aditiva e idempotente. Correr no SQL Editor.
-- ═══════════════════════════════════════════════════════════

create table if not exists public.fin_group_paid (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  group_code smallint not null,
  year       smallint not null,
  -- 1..12, e não o 0..11 do JavaScript: quem consultar esta tabela
  -- em SQL espera que Janeiro seja 1. A conversão é feita num único
  -- sítio do resumo-grupo.js.
  month      smallint not null,
  paid_at    timestamptz not null default now(),
  constraint fin_group_paid_month_chk check (month between 1 and 12),
  constraint fin_group_paid_uniq unique (user_id, group_code, year, month)
);


-- ═══ RLS ═══
--
-- using E with check explícitos. Uma política "for all" sem
-- expressão não concede nada e falha em silêncio nas leituras —
-- ver a migração 006.

alter table public.fin_group_paid enable row level security;

drop policy if exists "own group paid" on public.fin_group_paid;
create policy "own group paid" on public.fin_group_paid
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);


-- ═══════════════════════════════════════════════════════════
-- Veredicto — em linhas, que os RAISE NOTICE perdem-se no
-- SQL Editor do Supabase.
-- ═══════════════════════════════════════════════════════════

select
  (select count(*) from information_schema.tables
    where table_schema = 'public' and table_name = 'fin_group_paid')     as tabela,
  (select count(*) from pg_policies
    where schemaname = 'public' and tablename = 'fin_group_paid'
      and qual is not null and with_check is not null)                   as politica_ok,
  (select count(*) from pg_constraint
    where conname in ('fin_group_paid_uniq', 'fin_group_paid_month_chk')) as regras,
  case
    when (select count(*) from information_schema.tables
           where table_schema = 'public' and table_name = 'fin_group_paid') <> 1
      then 'FALHOU — a tabela nao foi criada'
    when (select count(*) from pg_policies
           where schemaname = 'public' and tablename = 'fin_group_paid'
             and qual is not null and with_check is not null) <> 1
      then 'FALHOU — politica RLS sem expressao'
    when (select count(*) from pg_constraint
           where conname in ('fin_group_paid_uniq', 'fin_group_paid_month_chk')) <> 2
      then 'FALHOU — faltam regras de integridade'
    else 'OK — o visto Pago ja pode ser usado'
  end                                                                    as veredicto;
