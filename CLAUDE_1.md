# GestorFin

Gestor de despesas pessoais. Uso pessoal, um único utilizador (Tiago).
Interface em português europeu.

## Stack

- **Frontend**: HTML + CSS + JavaScript vanilla, módulos ES (`type="module"`). Sem build step, sem framework, sem bundler.
- **Bibliotecas** (todas via CDN, carregadas como `<script>` no `index.html`): Supabase JS SDK, `xlsx-js-style`, Chart.js.
- **Backend**: Supabase (PostgreSQL + Auth + RLS + Edge Functions em Deno).
- **Hosting**: GitHub Pages, servido da raiz do repositório.
- **Banco**: ActivoBank (extrato `.xlsx`; integração open banking via Enable Banking em curso).

## Estrutura

```
index.html              # entrada principal
diagnostico.html        # página isolada de testes (não tocar ao mexer na app)
css/styles.css          # tokens de tema + estilos
js/
  config.js             # ⚠️ credenciais Supabase — NUNCA substituir sem confirmar
  auth.js               # cliente Supabase + magic link
  db.js                 # leituras/escritas
  state.js              # estado partilhado e cálculos derivados
  categories.js         # consultas sobre state.categories + DEFAULT_RULES
  import.js             # parser do extrato Activo Bank
  transactions.js       # tabela e edição inline
  dashboard.js          # gráficos
  export.js             # exportação Excel
  theme.js              # tema claro/escuro (auto-inicializável)
  ui.js                 # toasts, modais, spinners
  utils.js              # datas, formatação, hashes
  openbanking.js        # ligação ao banco, sincronização, secção "Banco ligado"
  categorias-page.js    # página de gestão de categorias
  app.js                # arranque e navegação
supabase/
  migrations/           # SQL aditivo, corrido à mão no SQL Editor
  functions/            # cópia de referência das Edge Functions
```

Não existe `schema.sql` completo no repositório — o esquema real vive no
Supabase. As migrações em `supabase/migrations/` são aditivas e idempotentes.

## Regras que não se quebram

1. **Nomes de colunas na base de dados em inglês.** Nunca em português. A interface é que traduz.
2. **O SDK do Supabase carrega como `<script>` estático no `index.html`.** Nunca carregar dinamicamente via `document.createElement("script")` — provoca race conditions em que o listener de auth nunca resolve.
3. **Nunca `display: flex` num `<td>`.** Parte o alinhamento da linha. Usar um `<div>` dentro da célula.
4. **Segredos nunca no frontend.** A chave privada do Enable Banking vive apenas nos secrets do Supabase e é usada só dentro de Edge Functions. A anon key do Supabase no `config.js` é pública por design — a segurança vem do RLS.
5. **`js/config.js` contém credenciais reais.** Não sobrepor ao entregar alterações.
6. **Ao alterar `css/styles.css`, incrementar o `?v=N` no link do `index.html`.** O GitHub Pages guarda CSS em cache de forma agressiva.
7. **Eliminar é sempre soft delete** (`deleted_at`), nunca `DELETE`.
8. **O mês de um movimento é determinado pela `value_date`**, não pela `movement_date`. Vale para dashboard, gráficos, exportação e filtros.
9. **As categorias são dados, não constantes.** Vivem em `fin_categories` e
   `fin_category_groups`; `js/categories.js` só as consulta a partir de
   `state.categories`. Nunca voltar a pôr listas de categorias no código.
10. **Movimentos e regras apontam para `category_id`, nunca para o nome.**
    É isso que permite renomear uma categoria sem tocar no histórico. A coluna
    `category_legacy` é resíduo da migração — não escrever lá.
11. **Nunca criar índices únicos sobre expressões** (`upper(x)`) se o código faz
    upsert por colunas. O `ON CONFLICT` não consegue associá-los e o upsert
    falha em silêncio. Normalizar no código e indexar a coluna simples.

## Convenções de código

- Comentários e strings da interface em **português europeu**.
- Nomes de variáveis e funções em inglês; nomes de domínio (categorias) em português.
- Depois de gravar no Supabase, atualizar o estado local em vez de refazer o fetch completo.
- Guardas defensivas antes de tocar no DOM (`if (!el) return;`) — a app troca de página sem recarregar.
- Toda a saída para o utilizador passa por `toast()` ou `confirmModal()`, nunca `alert()`.
- Erros: `console.error` com contexto + mensagem legível ao utilizador. Nunca engolir silenciosamente.

## Formato do extrato Activo Bank

Ficheiro `.xlsx` com 7 linhas de metadados; cabeçalho na linha 8:

```
Data Lanc. | Data Valor | Descrição | Valor | Saldo
```

Valores negativos são despesas. O parser deteta o cabeçalho dinamicamente
em vez de assumir posições fixas — manter esse comportamento.

## Contas

Desde 27/08/2026 os movimentos pertencem sempre a uma conta.

- A tabela e' `fin_bank_accounts`, com `kind` a distinguir `bank`
  (open banking) de `manual` (cartao refeicao, dinheiro, outra conta).
- **Divida de nomenclatura:** a tabela chama-se "bank_accounts" mas ja
  guarda contas que nao sao bancarias. Renomear obriga a republicar a
  mao as Edge Functions `eb-auth-callback` e `eb-sync`, que a referem
  pelo nome. Corrigir quando houver outro motivo para lhes tocar.
- `identification_hash` so existe nas contas de open banking — e' o
  que permite reassocia-las ao reautorizar. E' nulo nas manuais.
- **O filtro de conta esta sempre ativo e nao tem opcao "todas".**
  Juntar contas somaria saldos que devem ficar separados. Por isso um
  movimento sem `bank_account_id` nao aparece em lado nenhum: o
  `app.js` avisa no arranque se encontrar algum.
- `js/contas.js` trata da listagem e das contas manuais;
  `js/openbanking.js` trata so da conversa com o banco. O openbanking
  avisa por evento `contas-changed` em vez de importar o contas.js —
  um ciclo de imports entre os dois seria fragil.

## GitHub Pages: o build pode falhar em silencio

O repositorio tem `.nojekyll` desde 27/08/2026. Sem ele o Pages passa
o site pelo Jekyll, que este projeto nao usa, e um build falhado
**nao da erro visivel**: o site continua simplesmente a servir a
versao anterior.

Se uma alteracao nao aparecer depois de publicada, verificar o estado
do build antes de suspeitar de cache:

```
GET /repos/SotiInveste/gestor-financeiro/pages/builds
```

Nunca remover o `.nojekyll`.

## Unicidade: a autoridade é a base de dados

Erro cometido tres vezes em 26/08/2026, sempre com o mesmo formato:
usar o estado local do cliente para garantir uma unicidade que so o
indice pode garantir.

1. `source_hash` escrito nas linhas da API — o hash nao distingue dois
   movimentos legitimos iguais no mesmo dia.
2. Filtro de `entry_reference` sobre `state.transactions` — que so tem
   os movimentos **nao apagados**, enquanto o indice conta tambem os
   apagados por soft delete.
3. Filtro de `source_hash` com o mesmo defeito.

**Regra:** para deduplicar a escrita, usar `upsert` com
`ignoreDuplicates` sobre um indice unico. Um filtro no cliente serve
para poupar trafego, nunca como garantia.

**Cuidado com indices parciais:** um indice com `WHERE` nao pode ser
alvo de `ON CONFLICT` — o Postgres nao o consegue inferir a partir das
colunas. Se for preciso fazer upsert, o indice tem de ser total. Os
nulos sao distintos entre si por omissao, portanto um indice total
sobre `(bank_account_id, entry_reference)` nao interfere com as linhas
de Excel, que tem ambos nulos. Ver a migracao 007.

## RLS — lição de 26/08/2026

A política `own rules` do `fin_rules` existia mas **sem expressão**: `qual` e
`with_check` ambos nulos em `pg_policies`. Uma política assim não concede nada.

Sintomas, os dois ao mesmo tempo:

- gravar → `new row violates row-level security policy`
- ler → **lista vazia**, sem erro nenhum

O segundo é o perigoso: uma tabela vazia parece um estado legítimo. A tabela
esteve vazia desde sempre e ninguém deu por isso — a categorização automática
andou meses só com as `DEFAULT_RULES`, e cada tentativa de guardar uma regra
falhava em silêncio porque o `catch` do `transactions.js` engolia o erro.

**Ao suspeitar de RLS, conferir com:**

```sql
select tablename, policyname, cmd, qual, with_check
from pg_policies where schemaname = 'public' and tablename like 'fin_%';
```

O que falta a uma política depende do comando — `INSERT` só tem `WITH CHECK`,
`SELECT` só tem `USING`, `FOR ALL` tem de ter os dois. Ver a auditoria no fim
de `supabase/migrations/006_rls_fin_rules.sql`.

**Regra que daqui decorre:** nunca escrever `catch {}` sem `console.error`.
Foi o que transformou um bug de uma linha em meses de comportamento errado.

## Categorização

Duas camadas, por esta ordem:

1. `fin_rules` — regras do utilizador (têm prioridade).
2. `DEFAULT_RULES` em `categories.js` — regras base.

Quando o utilizador corrige uma categoria manualmente, a app propõe guardar
a regra. É esta aprendizagem que reduz o trabalho mensal — não a remover.

## Categorias

Migradas de constantes para tabelas em 26/08/2026 (migrações 002 a 004).

- `fin_category_groups` — 15 grupos, com `emoji` e `sort_order`.
- `fin_categories` — 59 categorias, com `kind` (`income`/`expense`),
  `sort_order`, `archived_at` e `is_system`.
- **`code`** — inteiro curto e estável, **nunca reutilizado**. É a chave que o
  bot do Telegram usa no `callback_data`, para criar ou reordenar categorias
  não deslocar mensagens já enviadas.
- **`is_system`** — só «Outros». Destino por omissão do importador; não pode
  ser apagada nem arquivada.
- **Arquivar, não apagar.** Arquivar tira dos seletores e mantém o histórico.
  Apagar só é oferecido quando nada aponta para a categoria.
- O seletor mostra sempre a categoria atual do movimento a ser editado, mesmo
  arquivada — senão desapareceria do próprio seletor.

**Por fazer (Fase 6):** largar `category_legacy` de `fin_transactions` e
`fin_rules`, mas só depois de um fecho de mês completo sem incidentes.

## Deduplicação

- Movimentos importados de Excel: hash de `value_date | description | amount`,
  guardado em `source_hash` (tem índice único).
- Movimentos vindos da API: `entry_reference` do Enable Banking (imutável por conta).
  **O `source_hash` fica a `null` nestes.** O hash não distingue dois movimentos
  legítimos iguais no mesmo dia (dois cafés de 1,50 €) e gravá-lo viola o índice
  único. O hash continua a ser calculado no `openbanking.js`, mas só para filtrar
  contra o que já veio do Excel.
- `existingHashes()` no `state.js` calcula o hash em tempo real para as linhas
  sem `source_hash`, para que a importação de Excel reconheça os movimentos que
  vieram da API. A descrição das duas origens nem sempre coincide, por isso a
  proteção é boa mas não é infalível.

## Integração open banking (a funcionar)

Ligada e operacional desde 24/08/2026. Quatro Edge Functions, todas
auto-contidas (o deploy é pelo Dashboard, que não faz bundling de imports
partilhados):

| Função | Papel |
| --- | --- |
| `eb-ping` | Teste de credenciais — assina o JWT e chama `GET /application` |
| `eb-auth-start` | `action: "list"` lista bancos; `action: "start"` devolve o URL de autorização |
| `eb-auth-callback` | Troca o `code` por sessão e grava as contas em `fin_bank_accounts` |
| `eb-sync` | Vai buscar movimentos, pagina e normaliza — proxy fino, não grava |

Secrets: `EB_APPLICATION_ID`, `EB_PRIVATE_KEY` (PKCS#8 — o Deno não aceita
PKCS#1), `EB_REDIRECT_URL` (`https://sotiinveste.github.io/gestor-financeiro/`,
igual ao carácter ao registado no painel da Enable Banking).

O frontend vive em `js/openbanking.js`. O mapeamento e a categorização ficam
lá, não nas funções, para as regras não existirem em dois sítios.

**Aprendido na prática:**

- O ActivoBank dá cerca de **6 meses** de histórico com `strategy=longest`
  dentro da janela da primeira hora — mais do que os 90 dias habituais.
  Para períodos anteriores, só o extrato Excel.
- Reautorizar repõe `last_synced_at` a `null`, o que faz a sincronização
  seguinte voltar a usar `strategy=longest`. É assim que se reabre a janela.
- O `Access-Control-Allow-Headers` das funções tem de incluir `apikey` e
  `x-client-info`, senão o SDK falha no preflight.
- O `?code=` do redirecionamento colide com o do magic link do Supabase.
  O `openbanking.js` só trata o retorno como sendo do banco quando o `state`
  corresponde ao guardado em `localStorage`.
- O nome do banco na Enable Banking é `Activo Bank`, com espaço.
- **O limite de recolhas manifesta-se como uma lista vazia, não como erro.**
  Esgotadas as ~4 recolhas do dia, `GET /accounts/{uid}/transactions` responde
  `200` com `{ transactions: [], continuation_key: null }` — para qualquer
  `date_from` e qualquer `strategy`, mesmo em períodos que sabemos ter
  movimentos. Não há `429`.

  Ao depurar, isto imita convincentemente "o banco não tem mais histórico" e
  "o parâmetro está errado". Antes de mexer em parâmetros, verificar quantas
  chamadas já foram feitas nesse dia — e esperar pelo dia seguinte. A `eb-sync`
  regista um `console.error` sempre que a lista vem vazia, com os parâmetros
  usados e se os cabeçalhos PSU seguiram.

- **Sem `PSU-IP-Address`, todas as chamadas gastam a quota de background.**
  O IP do cliente é lido de `x-forwarded-for`, `x-real-ip` ou `cf-connecting-ip`.
  Se nenhum existir, a `eb-sync` avisa no log com a lista de cabeçalhos
  recebidos — vale a pena confirmar isso antes de assumir outra causa.

- Fornecedor: **Enable Banking**, modo *Restricted Production* (contas próprias, gratuito).
  A alternativa óbvia — GoCardless Bank Account Data, ex-Nordigen — fechou a novos registos.
- Autenticação: JWT RS256 assinado com a chave privada da aplicação.
  Header `{typ, alg: RS256, kid: <application_id>}`;
  body `{iss: "enablebanking.com", aud: "api.enablebanking.com", iat, exp}`. TTL máximo 24h.
- Edge Functions fazem deploy pelo Dashboard do Supabase (o utilizador não usa CLI).
  O Dashboard não tem versionamento — manter sempre a cópia em `supabase/functions/`.

### Limitações a respeitar no desenho

- Histórico completo só está disponível cerca de 1 hora após a autorização;
  depois disso a maioria dos bancos limita a 90 dias. Primeira sincronização usa `strategy=longest`.
- Recolhas em background limitadas a ~4/dia. Com o utilizador presente, enviar cabeçalhos PSU.
- Consentimento expira (tipicamente 180 dias) e obriga a reautorizar.
- Ao reautorizar, os IDs de sessão e de conta mudam. Associar contas por `identification_hash`.
- Nunca usar `transaction_id` como referência única — usar `entry_reference`.

## Preferências de trabalho

- Alterações pequenas e focadas, uma de cada vez.
- Explicar de forma concisa o que mudou e porquê, depois de cada iteração.
- Testar antes de afirmar que algo funciona.
- Não introduzir dependências novas sem justificação clara.
