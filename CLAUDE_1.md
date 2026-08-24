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
  categories.js         # categorias agrupadas + regras base
  import.js             # parser do extrato Activo Bank
  transactions.js       # tabela e edição inline
  dashboard.js          # gráficos
  export.js             # exportação Excel
  theme.js              # tema claro/escuro (auto-inicializável)
  ui.js                 # toasts, modais, spinners
  utils.js              # datas, formatação, hashes
  openbanking.js        # ligação ao banco, sincronização, secção "Banco ligado"
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

## Categorização

Duas camadas, por esta ordem:

1. `fin_rules` — regras do utilizador (têm prioridade).
2. `DEFAULT_RULES` em `categories.js` — regras base.

Quando o utilizador corrige uma categoria manualmente, a app propõe guardar
a regra. É esta aprendizagem que reduz o trabalho mensal — não a remover.

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
