-- ═══════════════════════════════════════════════════════════
-- 015 — Nota nas regras de categorização
--
-- Uma regra passa a poder levar uma nota, que é escrita nos
-- movimentos que ela arruma. Exemplo: a regra SENTIMENTAL JOURNEY
-- põe-nos em Beleza e escreve "Loja Primor" na nota — a descrição
-- do banco não diz que loja é, e a nota passa a dizer.
--
-- A nota da regra nunca substitui uma nota que o movimento já
-- tenha: só preenche notas vazias. Isso é feito na app, não aqui.
--
-- Coluna opcional: as regras que já existem ficam sem nota e
-- continuam a funcionar como antes. A política RLS "own rules"
-- (migração 006) cobre a tabela inteira, coluna nova incluída.
--
-- Aditiva e idempotente. Correr no SQL Editor.
-- ═══════════════════════════════════════════════════════════

alter table public.fin_rules
  add column if not exists note text;

comment on column public.fin_rules.note is
  'Nota escrita nos movimentos que a regra categoriza, quando estes ainda não têm nota.';


-- ═══════════════════════════════════════════════════════════
-- Verificação — deve devolver uma linha: note | text | YES
-- ═══════════════════════════════════════════════════════════

select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name = 'fin_rules'
  and column_name = 'note';
