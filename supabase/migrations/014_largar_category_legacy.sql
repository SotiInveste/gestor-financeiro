-- ═══════════════════════════════════════════════════════════
-- 014 — Fase 6: largar a coluna legada das categorias
--
-- A 004 renomeou `category` para `category_legacy` e deixou-a lá
-- como testemunha: servia para provar que o `category_id` conta a
-- mesma história que o texto antigo contava.
--
-- Já não conta, e é esse o ponto. Depois de meses de uso, o texto
-- antigo está desactualizado POR DESENHO: categorias renomeadas e,
-- sobretudo, movimentos que entraram no destino por omissão e foram
-- arrumados depois. Hoje a coluna já não é uma testemunha — é uma
-- armadilha para quem a leia a pensar que diz a verdade.
--
-- Verificado a 22/10/2026, antes de escrever isto:
--   · 0 movimentos e 0 regras com category_id a apontar para uma
--     categoria inexistente
--   · 0 movimentos e 0 regras sem category_id
--   · 0 divergências nas regras
--
-- IRREVERSÍVEL. O bloco abaixo repete a verificação no momento de
-- correr e recusa-se a largar seja o que for se algo tiver mudado
-- entretanto.
-- ═══════════════════════════════════════════════════════════

do $$
declare
  mov_orfaos    int;
  reg_orfaos    int;
  mov_sem_id    int;
  reg_sem_id    int;
begin
  select count(*) into mov_orfaos
    from public.fin_transactions t
    left join public.fin_categories c on c.id = t.category_id
   where t.category_id is not null and c.id is null;

  select count(*) into reg_orfaos
    from public.fin_rules r
    left join public.fin_categories c on c.id = r.category_id
   where r.category_id is not null and c.id is null;

  select count(*) into mov_sem_id from public.fin_transactions where category_id is null;
  select count(*) into reg_sem_id from public.fin_rules        where category_id is null;

  if mov_orfaos > 0 or reg_orfaos > 0 or mov_sem_id > 0 or reg_sem_id > 0 then
    raise exception
      'A largar nada: % movimentos e % regras apontam para categorias inexistentes, '
      '% movimentos e % regras estao sem categoria. Corrigir primeiro.',
      mov_orfaos, reg_orfaos, mov_sem_id, reg_sem_id;
  end if;
end $$;


-- ═══ O corte ═══
--
-- if exists: correr de novo não dá erro.

alter table public.fin_transactions drop column if exists category_legacy;
alter table public.fin_rules        drop column if exists category_legacy;


-- ═══════════════════════════════════════════════════════════
-- Veredicto, em linhas — os RAISE NOTICE perdem-se no SQL Editor.
-- ═══════════════════════════════════════════════════════════

select
  (select count(*) from information_schema.columns
    where table_schema = 'public'
      and table_name in ('fin_transactions', 'fin_rules')
      and column_name = 'category_legacy')                      as colunas_legadas_restantes,
  (select count(*) from public.fin_transactions)                as movimentos,
  (select count(*) from public.fin_rules)                       as regras,
  case
    when (select count(*) from information_schema.columns
           where table_schema = 'public'
             and table_name in ('fin_transactions', 'fin_rules')
             and column_name = 'category_legacy') = 0
      then 'OK — Fase 6 concluida, a coluna legada desapareceu'
    else 'FALHOU — a coluna ainda existe'
  end                                                           as veredicto;
