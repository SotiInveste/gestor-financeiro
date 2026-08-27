-- ═══════════════════════════════════════════════════════════
-- 008 — Contas manuais
--
-- Permite registar contas que não vêm de open banking (cartão
-- refeição, dinheiro, outro banco não ligado), para os saldos não
-- se misturarem com os do ActivoBank.
--
-- A tabela fin_bank_accounts é reutilizada em vez de se criar uma
-- nova. O nome fica enganador — passa a guardar contas que não são
-- bancárias — mas renomear obrigava a republicar à mão as Edge
-- Functions eb-auth-callback e eb-sync, que a referem pelo nome.
-- Fica como dívida documentada no CLAUDE.md.
--
-- Idempotente. O passo 3 altera dados: ler a nota antes de correr.
-- ═══════════════════════════════════════════════════════════


-- ═══ 1. Distinguir o tipo de conta ═══

alter table public.fin_bank_accounts
  add column if not exists kind text not null default 'bank';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'fin_bank_accounts_kind_check'
  ) then
    alter table public.fin_bank_accounts
      add constraint fin_bank_accounts_kind_check check (kind in ('bank', 'manual'));
  end if;
end $$;


-- ═══ 2. O hash deixa de ser obrigatório ═══
--
-- Só as contas de open banking têm identification_hash: é o que
-- permite reassociar a conta ao reautorizar. Uma conta manual não
-- tem equivalente. Os nulos são distintos entre si, portanto o
-- índice único (user_id, identification_hash) continua válido.

alter table public.fin_bank_accounts
  alter column identification_hash drop not null;


-- ═══ 3. Atribuir os movimentos antigos à conta existente ═══
--
-- Até agora só havia uma conta, e os movimentos manuais e os
-- importados de Excel ficavam com bank_account_id nulo. Sem isto,
-- ao filtrar pelo ActivoBank esses movimentos desapareciam.
--
-- Só corre se existir exatamente UMA conta bancária — com mais do
-- que uma não há como adivinhar a qual pertencem.

do $$
declare
  conta_unica uuid;
  n_contas    int;
begin
  select count(*) into n_contas
  from public.fin_bank_accounts
  where kind = 'bank' and deleted_at is null;

  if n_contas = 1 then
    select id into conta_unica
    from public.fin_bank_accounts
    where kind = 'bank' and deleted_at is null;

    update public.fin_transactions
    set bank_account_id = conta_unica
    where bank_account_id is null;
  end if;
end $$;


-- ═══════════════════════════════════════════════════════════
-- Validação
-- ═══════════════════════════════════════════════════════════

select
  (select count(*) from public.fin_bank_accounts where kind = 'bank')     as contas_banco,
  (select count(*) from public.fin_bank_accounts where kind = 'manual')   as contas_manuais,
  (select count(*) from public.fin_transactions where bank_account_id is null
     and deleted_at is null)                                              as movimentos_sem_conta,
  case
    when (select count(*) from public.fin_transactions
          where bank_account_id is null and deleted_at is null) = 0
    then 'OK — todos os movimentos têm conta'
    else 'ATENÇÃO — há movimentos sem conta; ver nota do passo 3'
  end as veredicto;


-- ═══════════════════════════════════════════════════════════
-- Criar a conta do cartão refeição
-- ═══════════════════════════════════════════════════════════
--
-- Pode ser feito pela app (Movimentos → Contas → + Nova conta).
-- Em SQL, se preferires:
--
--   insert into fin_bank_accounts (user_id, kind, display_name)
--   select id, 'manual', 'Cartão Refeição'
--   from auth.users order by created_at limit 1;
