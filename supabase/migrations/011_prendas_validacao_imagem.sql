-- ═══════════════════════════════════════════════════════════
-- 011 — Prendas: validação e imagem
--
-- Duas coisas:
--
--   · is_validated no fin_gifts — a linha está tratada, como o ✓ dos
--     movimentos
--   · fin_gift_images — a miniatura da prenda
--
-- A imagem fica em tabela à parte e não numa coluna do fin_gifts.
-- Uma miniatura comprimida ronda os 20-30 KB em base64, e metê-la na
-- mesma linha obrigava todas as leituras de prendas a arrastá-la
-- atrás. Assim a lista continua leve e as imagens vêm numa consulta
-- própria.
--
-- Não se usa o Supabase Storage de propósito: a aplicação guarda só
-- a miniatura, já reduzida no browser antes de subir. Um bucket
-- traria políticas próprias, URLs assinados e mais uma superfície
-- para falhar, a troco de nada que aqui faça falta.
--
-- Aditiva e idempotente. Correr no SQL Editor.
-- ═══════════════════════════════════════════════════════════

-- ═══ Validação ═══

alter table public.fin_gifts
  add column if not exists is_validated boolean not null default false;


-- ═══ Miniaturas ═══

create table if not exists public.fin_gift_images (
  -- Chave primária é o próprio gift_id: uma prenda tem no máximo uma
  -- imagem, e assim a substituição é um upsert em vez de apagar e
  -- inserir.
  gift_id    uuid primary key references public.fin_gifts(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  -- Data URI (image/jpeg em base64), já reduzida no cliente.
  data       text not null,
  created_at timestamptz not null default now()
);


-- ═══ RLS ═══
--
-- using E with check explícitos. Uma política "for all" sem
-- expressão não concede nada e falha em silêncio nas leituras —
-- ver a migração 006.

alter table public.fin_gift_images enable row level security;

drop policy if exists "own gift images" on public.fin_gift_images;
create policy "own gift images" on public.fin_gift_images
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);


-- ═══════════════════════════════════════════════════════════
-- Veredicto — em linhas, que os RAISE NOTICE perdem-se no
-- SQL Editor do Supabase.
-- ═══════════════════════════════════════════════════════════

select
  (select count(*) from information_schema.columns
    where table_schema = 'public'
      and table_name = 'fin_gifts'
      and column_name = 'is_validated')                                as coluna_validacao,
  (select count(*) from information_schema.tables
    where table_schema = 'public'
      and table_name = 'fin_gift_images')                              as tabela_imagens,
  (select count(*) from pg_policies
    where schemaname = 'public'
      and tablename = 'fin_gift_images'
      and qual is not null and with_check is not null)                 as politica_ok,
  case
    when (select count(*) from information_schema.columns
           where table_schema = 'public'
             and table_name = 'fin_gifts'
             and column_name = 'is_validated') <> 1
      then 'FALHOU — a coluna is_validated nao foi criada'
    when (select count(*) from information_schema.tables
           where table_schema = 'public'
             and table_name = 'fin_gift_images') <> 1
      then 'FALHOU — a tabela fin_gift_images nao foi criada'
    when (select count(*) from pg_policies
           where schemaname = 'public'
             and tablename = 'fin_gift_images'
             and qual is not null and with_check is not null) <> 1
      then 'FALHOU — politica RLS sem expressao'
    else 'OK — validacao e imagens prontas'
  end                                                                  as veredicto;
