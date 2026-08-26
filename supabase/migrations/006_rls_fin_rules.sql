-- ═══════════════════════════════════════════════════════════
-- 006 — Repor a política RLS do fin_rules
--
-- A política "own rules" existia mas sem expressão: qual e
-- with_check ambos nulos. Uma política assim não concede nada,
-- o que produzia dois sintomas ao mesmo tempo:
--
--   · gravar uma regra → "new row violates row-level security policy"
--   · ler as regras    → lista vazia, mesmo com linhas na tabela
--
-- O segundo é o mais grave e passou despercebido: as regras do
-- utilizador nunca eram carregadas, por isso a categorização
-- automática andou sempre só com as DEFAULT_RULES do código.
--
-- Não foi partido pela migração das categorias — foi descoberto
-- por ela, porque o código novo passou a mostrar o erro real.
-- ═══════════════════════════════════════════════════════════

alter table public.fin_rules enable row level security;

drop policy if exists "own rules" on public.fin_rules;
create policy "own rules" on public.fin_rules
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);


-- ═══════════════════════════════════════════════════════════
-- Auditoria — procurar o mesmo defeito nas outras tabelas
-- ═══════════════════════════════════════════════════════════

select
  tablename,
  policyname,
  cmd,
  coalesce(qual, '(vazio)')       as usando,
  coalesce(with_check, '(vazio)') as verificando,
  case
    when qual is null and with_check is null then 'DEFEITUOSA — nao concede nada'
    when qual is null                        then 'sem USING — leitura bloqueada'
    when with_check is null                  then 'sem WITH CHECK — herda o USING'
    else 'OK'
  end as veredicto
from pg_policies
where schemaname = 'public'
  and tablename like 'fin_%'
order by
  case when qual is null or with_check is null then 0 else 1 end,
  tablename;


-- ═══════════════════════════════════════════════════════════
-- Depois de corrigir: as regras pertencem todas ao utilizador?
-- ═══════════════════════════════════════════════════════════
--
--   select user_id, count(*) from fin_rules group by user_id;
--
-- Deve devolver uma única linha, com o teu user_id. Se aparecer
-- mais do que uma, há regras de outra conta e o upsert continuaria
-- a bater contra linhas alheias.
