-- ═══════════════════════════════════════════════════════════
-- 004 — Apertar as regras (Fase 3, partes 4 e 5)
--
-- ⚠ SÓ correr depois de a 003 dizer "Tudo ligado".
--    Se houver um único movimento sem category_id, isto falha —
--    de propósito. A falha é a rede de segurança, não o problema.
--
-- Torna category_id obrigatório e arquiva a coluna de texto antiga
-- como category_legacy. A coluna antiga fica lá de propósito: é a
-- rede de segurança se alguma correspondência tiver corrido mal.
-- Só se apaga na Fase 6, depois de um fecho de mês sem incidentes.
-- ═══════════════════════════════════════════════════════════


-- ═══ Guarda: recusar se ainda houver órfãos ═══

do $$
declare
  orfaos_t int;
  orfaos_r int;
begin
  select count(*) into orfaos_t from public.fin_transactions where category_id is null;
  select count(*) into orfaos_r from public.fin_rules        where category_id is null;

  if orfaos_t > 0 or orfaos_r > 0 then
    raise exception
      'Ainda há órfãos (movimentos: %, regras: %). Resolver na 003 antes de continuar.',
      orfaos_t, orfaos_r;
  end if;
end $$;


-- ═══ 4. Exigir a coluna ═══

alter table public.fin_transactions alter column category_id set not null;
alter table public.fin_rules        alter column category_id set not null;


-- ═══ 5. Arquivar a coluna de texto ═══
--
-- Renomear só se ainda não foi renomeada, para o ficheiro poder
-- ser corrido duas vezes sem rebentar.

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'fin_transactions' and column_name = 'category'
  ) then
    alter table public.fin_transactions rename column category to category_legacy;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'fin_rules' and column_name = 'category'
  ) then
    alter table public.fin_rules rename column category to category_legacy;
  end if;
end $$;


-- ═══════════════════════════════════════════════════════════
-- Validação
-- ═══════════════════════════════════════════════════════════
--
--   -- devem existir category_id (not null) e category_legacy
--   select column_name, is_nullable
--   from information_schema.columns
--   where table_schema = 'public'
--     and table_name in ('fin_transactions', 'fin_rules')
--     and column_name in ('category_id', 'category_legacy')
--   order by table_name, column_name;
--
--   -- o texto antigo e o nome novo continuam a bater certo?
--   select count(*)
--   from fin_transactions t
--   join fin_categories c on c.id = t.category_id
--   where trim(t.category_legacy) <> trim(c.name);      -- 0
--
--
-- FASE 6 — só depois de um mês estável, e nunca antes:
--
--   alter table fin_transactions drop column category_legacy;
--   alter table fin_rules        drop column category_legacy;
