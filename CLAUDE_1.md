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
  app.js                # arranque e navegação
supabase/
  schema.sql            # esquema + políticas RLS
  functions/            # cópia de referência das Edge Functions
```

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

- Movimentos importados de Excel: hash de `value_date | description | amount`.
- Movimentos vindos da API: `entry_reference` do Enable Banking (imutável por conta).
- **Bug conhecido por resolver**: o índice único em `fin_rules` foi criado sobre
  `upper(keyword)` mas os upserts em `db.js` usam a coluna `keyword` simples.
  É preciso recriar o índice sem a expressão `upper()`.

## Integração open banking (em curso)

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
