-- ═══════════════════════════════════════════════════════════
-- 010 — Prendas
--
-- Duas tabelas novas, nada tocado no fin_transactions. As prendas
-- são uma leitura de nicho sobre os movimentos de um grupo; meter
-- título e recetor na tabela central fazia-a engordar por causa de
-- uma funcionalidade que a esmagadora maioria dos movimentos nunca
-- vai usar.
--
-- Um movimento pode dar origem a VÁRIAS prendas — uma compra de
-- 90 € pode ser três prendas de 30 € para três pessoas. Daí a
-- relação ser um-para-muitos e o preço viver na prenda, não no
-- movimento.
--
-- Aditiva e idempotente, como as anteriores. Correr no SQL Editor.
-- ═══════════════════════════════════════════════════════════

-- ═══ Recetores ═══

create table if not exists public.fin_gift_recipients (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  name        text not null,
  archived_at timestamptz,
  created_at  timestamptz not null default now(),
  constraint fin_gift_recipients_name_key unique (user_id, name)
);

-- ═══ Prendas ═══

create table if not exists public.fin_gifts (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  -- Cascade: se um movimento for mesmo apagado da base de dados, as
  -- prendas dele deixam de fazer sentido. O arquivo da aplicação é
  -- um soft delete (deleted_at), que não dispara isto — as prendas
  -- de um movimento arquivado ficam intactas se ele for reposto.
  transaction_id uuid not null references public.fin_transactions(id) on delete cascade,
  -- Set null: arquivar ou apagar um recetor não pode fazer
  -- desaparecer o registo do que se gastou.
  recipient_id   uuid references public.fin_gift_recipients(id) on delete set null,
  title          text not null default '',
  price          numeric(12,2) not null default 0,
  created_at     timestamptz not null default now()
);

create index if not exists fin_gifts_transaction_idx
  on public.fin_gifts (transaction_id);

create index if not exists fin_gifts_recipient_idx
  on public.fin_gifts (recipient_id);


-- ═══ RLS ═══
--
-- Com using E with check explícitos nos dois. Uma política "for all"
-- sem expressão não concede nada e falha de duas maneiras ao mesmo
-- tempo: as escritas dão erro e as leituras vêm vazias sem dizer
-- porquê. Foi o que aconteceu ao fin_rules — ver a migração 006.

alter table public.fin_gift_recipients enable row level security;
alter table public.fin_gifts           enable row level security;

drop policy if exists "own gift recipients" on public.fin_gift_recipients;
create policy "own gift recipients" on public.fin_gift_recipients
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own gifts" on public.fin_gifts;
create policy "own gifts" on public.fin_gifts
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);


-- ═══════════════════════════════════════════════════════════
-- Veredicto
--
-- Em linhas, e não por RAISE NOTICE: o SQL Editor do Supabase
-- mostra "Success. No rows returned" para blocos DO e a mensagem
-- perde-se.
-- ═══════════════════════════════════════════════════════════

select
  (select count(*) from information_schema.tables
    where table_schema = 'public'
      and table_name in ('fin_gift_recipients', 'fin_gifts'))          as tabelas,
  (select count(*) from pg_policies
    where schemaname = 'public'
      and tablename in ('fin_gift_recipients', 'fin_gifts')
      and qual is not null and with_check is not null)                 as politicas_ok,
  (select count(*) from public.fin_category_groups where code = 29)    as grupo_29,
  (select coalesce(string_agg(name, ', '), '(nenhuma)')
     from public.fin_categories c
     join public.fin_category_groups g on g.id = c.group_id
    where g.code = 29)                                                 as categorias_do_grupo,
  case
    when (select count(*) from information_schema.tables
           where table_schema = 'public'
             and table_name in ('fin_gift_recipients', 'fin_gifts')) <> 2
      then 'FALHOU — as tabelas nao foram criadas'
    when (select count(*) from pg_policies
           where schemaname = 'public'
             and tablename in ('fin_gift_recipients', 'fin_gifts')
             and qual is not null and with_check is not null) <> 2
      then 'FALHOU — politicas RLS sem expressao'
    when (select count(*) from public.fin_category_groups where code = 29) = 0
      then 'TABELAS OK — mas nao existe grupo com o codigo 29, a pagina fica vazia'
    else 'OK — a pagina Prendas ja pode ser usada'
  end                                                                  as veredicto;


-- ═══════════════════════════════════════════════════════════
-- Se o grupo 29 não existir, ver quais existem:
--
--   select code, name from fin_category_groups order by code;
-- ═══════════════════════════════════════════════════════════
