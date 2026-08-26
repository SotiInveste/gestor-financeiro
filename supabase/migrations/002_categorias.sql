-- ═══════════════════════════════════════════════════════════
-- 002 — Categorias como dados (Fases 0, 1 e 2)
--
-- Correr uma vez, de uma só vez, no SQL Editor do Supabase.
-- Idempotente: repetir não duplica nem destrói nada.
--
-- Fase 0 — o essencial já foi feito na 001 (o índice sobre upper()
--          foi largado e substituído por fin_rules_user_keyword_uniq).
--          Falta normalizar as keywords existentes, e desduplicar
--          antes, porque 'netflix' e 'NETFLIX' são hoje duas linhas
--          distintas para o índice actual.
-- Fase 1 — tabelas de grupos e categorias, com RLS.
-- Fase 2 — semear com a estrutura actual de js/categories.js.
-- ═══════════════════════════════════════════════════════════


-- ═══ FASE 0 (resto) — normalizar keywords ═══

-- Desduplicar ignorando maiúsculas, mantendo a regra mais recente.
-- Tem de vir antes do update, senão a normalização viola o índice.
delete from public.fin_rules a
using public.fin_rules b
where a.user_id = b.user_id
  and upper(trim(a.keyword)) = upper(trim(b.keyword))
  and a.id <> b.id
  and (a.created_at < b.created_at
       or (a.created_at = b.created_at and a.id < b.id));

update public.fin_rules
set keyword = upper(trim(keyword))
where keyword <> upper(trim(keyword));


-- ═══ FASE 1 — Tabelas ═══

create table if not exists public.fin_category_groups (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  name        text not null,
  emoji       text not null default '',
  sort_order  integer not null default 0,
  code        smallint not null,               -- estável, nunca reutilizado
  archived_at timestamptz,
  created_at  timestamptz not null default now(),
  constraint fin_category_groups_name_key unique (user_id, name),
  constraint fin_category_groups_code_key unique (user_id, code)
);

create table if not exists public.fin_categories (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  group_id    uuid not null references public.fin_category_groups(id) on delete restrict,
  name        text not null,
  kind        text not null default 'expense' check (kind in ('income','expense')),
  sort_order  integer not null default 0,
  code        smallint not null,               -- estável, nunca reutilizado
  is_system   boolean not null default false,  -- não pode ser apagada nem arquivada
  archived_at timestamptz,
  created_at  timestamptz not null default now(),
  constraint fin_categories_name_key unique (user_id, name),
  constraint fin_categories_code_key unique (user_id, code)
);

create index if not exists fin_categories_group_idx
  on public.fin_categories (group_id);


-- ═══ FASE 1 — RLS ═══

alter table public.fin_category_groups enable row level security;
alter table public.fin_categories      enable row level security;

drop policy if exists "own category groups" on public.fin_category_groups;
create policy "own category groups" on public.fin_category_groups
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own categories" on public.fin_categories;
create policy "own categories" on public.fin_categories
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);


-- ═══ FASE 2 — Semear ═══
--
-- Divergência deliberada face à especificação: o bloco original usava
-- um CTE ins_groups seguido de all_groups a ler a mesma tabela. Não
-- funcionaria — todas as sub-instruções de um comando partilham o
-- mesmo snapshot, por isso all_groups nunca veria os grupos acabados
-- de inserir, e nenhuma categoria seria criada.
--
-- (A nota da spec atribui isso a "o CTE não é executado". Não é o
-- caso: CTEs que escrevem correm sempre, referenciados ou não. O
-- problema é a visibilidade, não a execução.)
--
-- Aqui os grupos entram numa instrução e as categorias noutra, dentro
-- do mesmo bloco. A segunda já vê o que a primeira gravou.

do $$
declare
  uid      uuid;
  n_grupos int;
  n_cats   int;
begin
  select id into uid from auth.users order by created_at limit 1;
  if uid is null then
    raise exception 'Nenhum utilizador encontrado.';
  end if;

  drop table if exists seed_categorias;
  create temporary table seed_categorias (
    group_name     text,
    emoji          text,
    group_order    int,
    category_name  text,
    kind           text,
    category_order int,
    code           smallint,
    is_system      boolean
  );

  insert into seed_categorias values
    ('Receitas','💰',1,'Salário','income',1,100,false),
    ('Receitas','💰',1,'Outras Receitas','income',2,101,false),
    ('Receitas','💰',1,'Valores Creditados','income',3,102,false),
    ('Receitas','💰',1,'Devolução Empregador 1','income',4,103,false),
    ('Receitas','💰',1,'Devolução Empregador 2','income',5,104,false),
    ('Habitação','🏠',2,'Renda Habitação','expense',1,105,false),
    ('Habitação','🏠',2,'Eletricidade','expense',2,106,false),
    ('Habitação','🏠',2,'Água','expense',3,107,false),
    ('Habitação','🏠',2,'Gás','expense',4,108,false),
    ('Habitação','🏠',2,'TV+NET+VOZ','expense',5,109,false),
    ('Habitação','🏠',2,'Casa','expense',6,110,false),
    ('Carro','🚗',3,'Combustível','expense',1,111,false),
    ('Carro','🚗',3,'Via Verde','expense',2,112,false),
    ('Carro','🚗',3,'Mecânico','expense',3,113,false),
    ('Carro','🚗',3,'Seguro Automóvel','expense',4,114,false),
    ('Carro','🚗',3,'IUC','expense',5,115,false),
    ('Carro','🚗',3,'Inspeção Automóvel','expense',6,116,false),
    ('Carro','🚗',3,'Estacionamento','expense',7,117,false),
    ('Carro','🚗',3,'Outros Carro','expense',8,118,false),
    ('Alimentação','🛒',4,'Supermercado','expense',1,119,false),
    ('Alimentação','🛒',4,'Compras Continente','expense',2,120,false),
    ('Alimentação','🛒',4,'Restaurante','expense',3,121,false),
    ('Alimentação','🛒',4,'Convívio','expense',4,122,false),
    ('Saúde','❤️',5,'Consultas','expense',1,123,false),
    ('Saúde','❤️',5,'Farmácia','expense',2,124,false),
    ('Saúde','❤️',5,'Análises Clínicas','expense',3,125,false),
    ('Saúde','❤️',5,'Compras Wells','expense',4,126,false),
    ('Saúde','❤️',5,'Outros Saúde','expense',5,127,false),
    ('Lazer & Cultura','🎉',6,'Cinema','expense',1,128,false),
    ('Lazer & Cultura','🎉',6,'Espetáculos','expense',2,129,false),
    ('Lazer & Cultura','🎉',6,'Museus','expense',3,130,false),
    ('Lazer & Cultura','🎉',6,'Lazer','expense',4,131,false),
    ('Lazer & Cultura','🎉',6,'Festas','expense',5,132,false),
    ('Lazer & Cultura','🎉',6,'Cultura','expense',6,133,false),
    ('Viagens','✈️',7,'Viagem','expense',1,134,false),
    ('Viagens','✈️',7,'Férias','expense',2,135,false),
    ('Viagens','✈️',7,'Alojamento','expense',3,136,false),
    ('Viagens','✈️',7,'Seguro Viagem','expense',4,137,false),
    ('Compras Pessoais','👕',8,'Vestuário','expense',1,138,false),
    ('Compras Pessoais','👕',8,'Beleza','expense',2,139,false),
    ('Compras Pessoais','👕',8,'Prendas','expense',3,140,false),
    ('Compras Pessoais','👕',8,'Acessórios','expense',4,141,false),
    ('Compras Pessoais','👕',8,'Desporto','expense',5,142,false),
    ('Compras Pessoais','👕',8,'Tecnologia','expense',6,143,false),
    ('Compras Pessoais','👕',8,'Compras Online','expense',7,144,false),
    ('Bebé','👶',9,'Bebé','expense',1,145,false),
    ('Telecomunicações','📱',10,'Telemóvel Tiago','expense',1,146,false),
    ('Telecomunicações','📱',10,'O Vigilante','expense',2,147,false),
    ('Transportes','🚌',11,'Transportes','expense',1,148,false),
    ('Transportes','🚌',11,'Levantamentos','expense',2,149,false),
    ('Poupanças','🏦',12,'Poupança Casa','expense',1,150,false),
    ('Poupanças','🏦',12,'Poupança Extra','expense',2,151,false),
    ('Investimentos','📈',13,'Investimento','expense',1,152,false),
    ('Investimentos','📈',13,'Investimento Extra','expense',2,153,false),
    ('Momentâneas','⚙️',14,'Momentanea Empregador 1','expense',1,154,false),
    ('Momentâneas','⚙️',14,'Momentanea Empregador 2','expense',2,155,false),
    ('Outros','🔧',15,'Outros','expense',1,156,true),
    ('Outros','🔧',15,'Erro','expense',2,157,false),
    ('Outros','🔧',15,'Devoluções','expense',3,158,false);

  -- Grupos primeiro. Códigos 11..25 — espaço separado do das categorias.
  insert into public.fin_category_groups (user_id, name, emoji, sort_order, code)
  select distinct uid, group_name, emoji, group_order, (10 + group_order)::smallint
  from seed_categorias
  on conflict (user_id, name) do nothing;

  -- Categorias depois, já a ver os grupos inseridos acima.
  insert into public.fin_categories
    (user_id, group_id, name, kind, sort_order, code, is_system)
  select uid, g.id, s.category_name, s.kind, s.category_order, s.code, s.is_system
  from seed_categorias s
  join public.fin_category_groups g
    on g.user_id = uid and g.name = s.group_name
  on conflict (user_id, name) do nothing;

  select count(*) into n_grupos from public.fin_category_groups where user_id = uid;
  select count(*) into n_cats   from public.fin_categories      where user_id = uid;
  raise notice 'Grupos: % (esperado 15) | Categorias: % (esperado 59)', n_grupos, n_cats;

  drop table seed_categorias;
end $$;


-- ═══════════════════════════════════════════════════════════
-- Validação (correr à parte)
-- ═══════════════════════════════════════════════════════════
--
--   select count(*) from fin_category_groups;              -- 15
--   select count(*) from fin_categories;                   -- 59
--   select count(*) from fin_categories where is_system;   -- 1  («Outros»)
--
--   -- keywords todas normalizadas?
--   select count(*) from fin_rules
--   where keyword <> upper(trim(keyword));                 -- 0
