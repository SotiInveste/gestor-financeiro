-- ═══════════════════════════════════════════════════════════
-- 003 — Ligar movimentos e regras às categorias (Fase 3, parte 1)
--
-- Adiciona e preenche. NÃO exige nada ainda.
-- A parte que aperta as regras está na 004, e só deve correr
-- depois de a verificação no fim deste ficheiro vir vazia.
--
-- Correr depois da 002. Idempotente.
-- ═══════════════════════════════════════════════════════════


-- ═══ 1. Colunas novas, ainda opcionais ═══

alter table public.fin_transactions
  add column if not exists category_id uuid
  references public.fin_categories(id) on delete restrict;

alter table public.fin_rules
  add column if not exists category_id uuid
  references public.fin_categories(id) on delete restrict;

create index if not exists fin_transactions_category_idx
  on public.fin_transactions (category_id);

create index if not exists fin_rules_category_idx
  on public.fin_rules (category_id);


-- ═══ 2. Preencher por correspondência de nome ═══

update public.fin_transactions t
set category_id = c.id
from public.fin_categories c
where c.user_id = t.user_id
  and trim(c.name) = trim(t.category)
  and t.category_id is null;

update public.fin_rules r
set category_id = c.id
from public.fin_categories c
where c.user_id = r.user_id
  and trim(c.name) = trim(r.category)
  and r.category_id is null;


-- ═══ 3. Relatório do que sobrou ═══
--
-- Devolvido como linhas, não como RAISE NOTICE: o SQL Editor do
-- Supabase não mostra as mensagens de forma fiável, e para um bloco
-- DO limita-se a dizer "Success. No rows returned".

select
  (select count(*) from public.fin_transactions where category_id is null) as movimentos_orfaos,
  (select count(*) from public.fin_rules        where category_id is null) as regras_orfas,
  case
    when (select count(*) from public.fin_transactions where category_id is null) = 0
     and (select count(*) from public.fin_rules        where category_id is null) = 0
    then 'TUDO LIGADO — pode correr a 004'
    else 'HA ORFAOS — nao correr a 004; ver diagnostico no fim do ficheiro'
  end as veredicto;


-- ═══════════════════════════════════════════════════════════
-- Diagnóstico (correr à parte, se houver órfãos)
-- ═══════════════════════════════════════════════════════════
--
-- Que nomes de categoria não existem em fin_categories:
--
--   select category, count(*)
--   from fin_transactions
--   where category_id is null
--   group by category
--   order by count(*) desc;
--
--   select category, count(*)
--   from fin_rules
--   where category_id is null
--   group by category;
--
-- Para cada nome órfão: criar a categoria em falta, ou reatribuir.
-- NUNCA apagar movimentos para resolver isto.
--
-- Criar uma categoria em falta (ajustar nome, grupo e tipo):
--
--   insert into fin_categories (user_id, group_id, name, kind, sort_order, code)
--   select
--     g.user_id,
--     g.id,
--     'NOME DA CATEGORIA',
--     'expense',
--     coalesce((select max(sort_order) + 1 from fin_categories where group_id = g.id), 1),
--     (select max(code) + 1 from fin_categories where user_id = g.user_id)
--   from fin_category_groups g
--   where g.name = 'NOME DO GRUPO';
--
-- Reatribuir um nome antigo a uma categoria existente:
--
--   update fin_transactions t
--   set category_id = (select id from fin_categories
--                      where user_id = t.user_id and name = 'Outros')
--   where t.category_id is null and t.category = 'NOME ANTIGO';
--
-- Depois de resolver, voltar a correr este ficheiro (é idempotente)
-- até o NOTICE dizer "Tudo ligado".
