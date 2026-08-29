-- ═══════════════════════════════════════════════════════════
-- 009 — Terceiro tipo de categoria: poupança
--
-- Até agora uma categoria era receita ou despesa. Passa a poder ser
-- poupança: dinheiro que sai da conta mas não é consumo.
--
-- No cálculo do mês:
--   Saldo = Receitas − Despesas − Poupança
--
-- A poupança sai do saldo porque o dinheiro saiu mesmo da conta — o
-- saldo continua a bater certo com o do banco. O que se ganha é ver
-- que essa saída não foi consumo, e por isso a poupança também não
-- entra nos gráficos de despesas.
--
-- Idempotente. Não altera dados: os tipos das categorias existentes
-- ficam como estão e passam a poder ser mudados na app.
-- ═══════════════════════════════════════════════════════════

do $$
declare
  nome text;
begin
  -- A restrição foi criada em linha no create table, por isso o nome
  -- é atribuído pelo Postgres. Procura-se em vez de se assumir.
  select conname into nome
  from pg_constraint
  where conrelid = 'public.fin_categories'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) ilike '%kind%';

  if nome is not null then
    execute format('alter table public.fin_categories drop constraint %I', nome);
  end if;
end $$;

alter table public.fin_categories
  add constraint fin_categories_kind_check
  check (kind in ('income', 'expense', 'saving'));


-- ═══════════════════════════════════════════════════════════
-- Validação
-- ═══════════════════════════════════════════════════════════

select
  pg_get_constraintdef(oid) as restricao,
  case
    when pg_get_constraintdef(oid) ilike '%saving%' then 'OK — poupança aceite'
    else 'ATENÇÃO — a restrição antiga ainda está activa'
  end as veredicto
from pg_constraint
where conrelid = 'public.fin_categories'::regclass
  and conname = 'fin_categories_kind_check';


-- ═══════════════════════════════════════════════════════════
-- Atalho: marcar as categorias de poupança de uma vez
-- ═══════════════════════════════════════════════════════════
--
-- Deixado em comentário de propósito — quais são categorias de
-- poupança é uma decisão tua, não minha. «Investimentos», por
-- exemplo, tanto pode ser poupança como uma coisa à parte.
--
-- Pela app: Categorias → Editar na categoria → Tipo.
-- Em SQL, para o grupo inteiro:
--
--   update fin_categories c
--   set kind = 'saving'
--   from fin_category_groups g
--   where g.id = c.group_id
--     and g.name = 'Poupanças';
