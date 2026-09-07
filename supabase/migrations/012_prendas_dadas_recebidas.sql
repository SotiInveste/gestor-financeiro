-- ═══════════════════════════════════════════════════════════
-- 012 — Prendas dadas e recebidas, e registos manuais
--
-- Até aqui uma prenda era sempre um movimento do grupo 29. Passam a
-- existir dois eixos independentes:
--
--   · ORIGEM    — vem de um movimento, ou é um registo manual
--   · DIRECÇÃO  — dada ou recebida
--
-- Um movimento é sempre uma prenda DADA: representa dinheiro que
-- saiu. Só os registos manuais escolhem a direcção — e é por isso
-- que existem, já que uma prenda recebida não tem movimento nenhum
-- por trás.
--
-- QUEM DEU e QUEM RECEBEU saem da MESMA lista de pessoas
-- (fin_gift_recipients). A mesma pessoa dá e recebe conforme a
-- ocasião, e duas listas obrigariam a registá-la duas vezes, com os
-- totais dela partidos ao meio.
--
-- Dívida de nomenclatura: a tabela chama-se "gift_recipients" mas já
-- guarda também quem dá. Renomear obriga a mexer na chave
-- estrangeira, na política RLS e no db.js; fica para quando houver
-- outro motivo para lhe tocar. Mesmo caso do fin_bank_accounts.
--
-- Aditiva e idempotente. Correr no SQL Editor.
-- ═══════════════════════════════════════════════════════════

-- ═══ Origem: o movimento passa a ser opcional ═══
--
-- Sem NOT NULL não há registo manual possível. Repetir isto numa
-- coluna já anulável é um no-op, por isso é seguro correr de novo.

alter table public.fin_gifts
  alter column transaction_id drop not null;


-- ═══ Colunas novas ═══

alter table public.fin_gifts
  -- 'given' por omissão: tudo o que já lá está veio de um movimento.
  add column if not exists direction         text not null default 'given',
  -- Só os manuais a usam; nos outros a data é a do movimento.
  add column if not exists gift_date         date,
  -- O "evento" de um manual, escolhido das mesmas categorias do
  -- grupo 29 que servem os movimentos, para os dois serem
  -- comparáveis. Set null: apagar uma categoria não apaga a prenda.
  add column if not exists event_category_id uuid references public.fin_categories(id) on delete set null,
  -- Quem deu. O recipient_id, que já existia, é quem recebeu.
  add column if not exists giver_id          uuid references public.fin_gift_recipients(id) on delete set null;


-- ═══ Regras ═══
--
-- Em bloco DO porque o ADD CONSTRAINT não tem IF NOT EXISTS.

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'fin_gifts_direction_chk') then
    alter table public.fin_gifts add constraint fin_gifts_direction_chk
      check (direction in ('given', 'received'));
  end if;

  -- Uma prenda tem de estar ancorada em alguma coisa: ou num
  -- movimento, ou numa data própria. Sem isto, um manual sem data
  -- ficava sem lugar no tempo e desaparecia da vista anual.
  if not exists (select 1 from pg_constraint where conname = 'fin_gifts_origem_chk') then
    alter table public.fin_gifts add constraint fin_gifts_origem_chk
      check (transaction_id is not null or gift_date is not null);
  end if;

  -- Um movimento é dinheiro que saiu: nunca pode ser uma recebida.
  if not exists (select 1 from pg_constraint where conname = 'fin_gifts_mov_dada_chk') then
    alter table public.fin_gifts add constraint fin_gifts_mov_dada_chk
      check (transaction_id is null or direction = 'given');
  end if;
end $$;

create index if not exists fin_gifts_giver_idx on public.fin_gifts (giver_id);
create index if not exists fin_gifts_date_idx  on public.fin_gifts (gift_date);


-- ═══════════════════════════════════════════════════════════
-- Veredicto — em linhas, que os RAISE NOTICE perdem-se no
-- SQL Editor do Supabase.
-- ═══════════════════════════════════════════════════════════

select
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'fin_gifts'
      and column_name in ('direction', 'gift_date', 'event_category_id', 'giver_id'))
                                                                       as colunas_novas,
  (select count(*) from pg_constraint
    where conname in ('fin_gifts_direction_chk', 'fin_gifts_origem_chk',
                      'fin_gifts_mov_dada_chk'))                       as regras,
  (select is_nullable from information_schema.columns
    where table_schema = 'public' and table_name = 'fin_gifts'
      and column_name = 'transaction_id')                              as movimento_opcional,
  (select count(*) from public.fin_gifts where direction = 'given')     as ja_dadas,
  case
    when (select count(*) from information_schema.columns
           where table_schema = 'public' and table_name = 'fin_gifts'
             and column_name in ('direction', 'gift_date', 'event_category_id', 'giver_id')) <> 4
      then 'FALHOU — faltam colunas'
    when (select count(*) from pg_constraint
           where conname in ('fin_gifts_direction_chk', 'fin_gifts_origem_chk',
                             'fin_gifts_mov_dada_chk')) <> 3
      then 'FALHOU — faltam regras de integridade'
    when (select is_nullable from information_schema.columns
           where table_schema = 'public' and table_name = 'fin_gifts'
             and column_name = 'transaction_id') <> 'YES'
      then 'FALHOU — o transaction_id continua obrigatorio'
    else 'OK — registos manuais e prendas recebidas prontos'
  end                                                                  as veredicto;
