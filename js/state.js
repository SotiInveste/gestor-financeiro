// ═══════════════════════════════════════════════════════════
// Estado partilhado da aplicação
//
// Depois de gravar no Supabase, atualizamos o estado local em
// vez de refazer o fetch completo — muito mais rápido.
// ═══════════════════════════════════════════════════════════

import { monthOf, yearOf, makeHash } from "./utils.js";

// ─── Ordenação da tabela, guardada entre sessões ───

/**
 * Valor de state.month que representa o ano inteiro.
 *
 * Fica a seguir aos doze meses de propósito: o seletor lista 0..11 e
 * depois este, e a ordem no ecrã é a mesma da do valor.
 */
export const ANUAL = 12;

const SORT_KEY = "gestorfin-sort";
const CONTA_KEY = "gestorfin-conta";
const SORT_OMISSAO = { col: "value_date", dir: "asc" };

export const COLUNAS_ORDENAVEIS = [
  "movement_date", "value_date", "description", "note", "category", "amount",
];

/**
 * O localStorage pode estar indisponível (janela privada, dados
 * limpos) ou conter lixo de uma versão anterior — daí a validação
 * e o try/catch. Em qualquer falha volta-se à ordenação por omissão.
 */
function ordenacaoGuardada() {
  try {
    const bruto = localStorage.getItem(SORT_KEY);
    if (!bruto) return { ...SORT_OMISSAO };
    const s = JSON.parse(bruto);
    if (COLUNAS_ORDENAVEIS.includes(s?.col) && (s.dir === "asc" || s.dir === "desc")) {
      return { col: s.col, dir: s.dir };
    }
  } catch (err) {
    console.error("Ordenação guardada ilegível:", err);
  }
  return { ...SORT_OMISSAO };
}

/** Conta filtrada, ou null para todas. Sobrevive a recarregamentos. */
function contaGuardada() {
  try {
    return localStorage.getItem(CONTA_KEY) || null;
  } catch (err) {
    console.error("Filtro de conta ilegível:", err);
    return null;
  }
}

export function guardarConta() {
  try {
    if (state.accountFilter) localStorage.setItem(CONTA_KEY, state.accountFilter);
    else localStorage.removeItem(CONTA_KEY);
  } catch (err) {
    console.error("Não foi possível guardar o filtro de conta:", err);
  }
}

export function guardarOrdenacao() {
  try {
    localStorage.setItem(SORT_KEY, JSON.stringify(state.sort));
  } catch (err) {
    console.error("Não foi possível guardar a ordenação:", err);
  }
}

export const state = {
  transactions: [],
  // Arquivados à parte, e não misturados com os activos: o painel,
  // os totais e a exportação leem state.transactions, e um movimento
  // arquivado que aparecesse aí voltaria a contar para o saldo.
  archived: [],
  archivedLoaded: false,
  rules: [],
  categories: [],
  categoryGroups: [],
  accounts: [],
  // Conta filtrada; null mostra todas.
  accountFilter: contaGuardada(),
  // Coluna e sentido da ordenação, recuperados do localStorage.
  sort: ordenacaoGuardada(),
  month: new Date().getMonth(),
  year: new Date().getFullYear(),
  page: "dashboard",
};

const texto = (a, b) =>
  String(a || "").localeCompare(String(b || ""), "pt", { sensitivity: "base" });

/** Comparadores por coluna. Todos crescentes; o sentido aplica-se depois. */
const COMPARADORES = {
  movement_date: (a, b) => texto(a.movement_date, b.movement_date),
  value_date:    (a, b) => texto(a.value_date, b.value_date),
  description:   (a, b) => texto(a.description, b.description),
  note:          (a, b) => texto(a.note, b.note),
  category:      (a, b) => texto(catName(a.category_id), catName(b.category_id)),
  amount:        (a, b) => Number(a.amount) - Number(b.amount),
};

/**
 * Movimentos do período selecionado (filtrados pela DATA VALOR).
 *
 * Por omissão devolve só os activos. Os arquivados entram apenas
 * quando pedidos explicitamente — a lista de movimentos é a única
 * que os pede, e mesmo aí só para os mostrar.
 */
export function currentMonthTransactions({ incluirArquivados = false } = {}) {
  const { col, dir } = state.sort;
  const cmp = COMPARADORES[col] || COMPARADORES.value_date;
  const sinal = dir === "desc" ? -1 : 1;

  const lista = incluirArquivados
    ? [...state.transactions, ...state.archived]
    : state.transactions;

  return lista
    // No modo anual conta o ano inteiro. Sem isto, a página de
    // movimentos e o saldo do cabeçalho ficavam vazios ao escolher
    // "Anual", em vez de mostrarem o ano.
    .filter(t => yearOf(t.value_date) === state.year &&
      (state.month === ANUAL || monthOf(t.value_date) === state.month))
    .filter(passaFiltroConta)
    .sort((a, b) => {
      const r = cmp(a, b) * sinal;
      // Desempate sempre pela data valor, no mesmo sentido: linhas
      // equivalentes deixam de trocar de lugar entre repinturas.
      return r !== 0 ? r : COMPARADORES.value_date(a, b);
    });
}

/** Tipo de cada categoria, para classificar movimentos. */
function mapaDeTipos() {
  return new Map(state.categories.map(c => [c.id, c.kind]));
}

/**
 * Totais do período selecionado.
 *
 * A poupança sai do saldo: o dinheiro saiu mesmo da conta, e o saldo
 * tem de continuar a bater certo com o do banco. O que se separa é a
 * natureza da saída — poupar não é gastar.
 *
 * Um levantamento da poupança (montante positivo numa categoria de
 * poupança) reduz o total poupado, em vez de contar como receita.
 */
export function monthTotals(list = currentMonthTransactions()) {
  const tipos = mapaDeTipos();
  let income = 0, expense = 0, saving = 0;

  list.forEach(t => {
    const v = Number(t.amount);
    if (tipos.get(t.category_id) === "saving") saving += -v;
    else if (v > 0) income += v;
    else expense += Math.abs(v);
  });

  return { income, expense, saving, balance: income - expense - saving };
}

/** Despesas agregadas por categoria, ordenadas. */
export function expensesByCategory(list = currentMonthTransactions()) {
  // Agrupado por category_id, não pelo nome: duas categorias com
  // nomes parecidos deixam de ser fundidas por acaso, e renomear
  // uma categoria passa a refletir-se sozinho no histórico.
  const tipos = mapaDeTipos();
  const map = new Map();

  // A poupança fica de fora: não é despesa, e incluí-la faria o total
  // do gráfico deixar de bater certo com o KPI das Despesas.
  list
    .filter(t => t.amount < 0 && tipos.get(t.category_id) !== "saving")
    .forEach(t => {
      const key = t.category_id || "sem-categoria";
      map.set(key, (map.get(key) || 0) + Math.abs(Number(t.amount)));
    });

  return [...map.entries()]
    .map(([id, value]) => ({
      id,
      name: catName(id),
      value: Number(value.toFixed(2)),
    }))
    .sort((a, b) => b.value - a.value);
}

/**
 * Nome de uma categoria a partir do estado local.
 *
 * Resolvido aqui em vez de importar categories.js: esse módulo já
 * importa este, e um ciclo entre os dois seria frágil.
 */
/** Respeita o filtro de conta ativo. Sem filtro, deixa passar tudo. */
export function passaFiltroConta(t) {
  return !state.accountFilter || t.bank_account_id === state.accountFilter;
}

/** Nome de uma conta a partir do estado local. */
export function accountName(id) {
  if (!id) return "—";
  const a = state.accounts.find(x => x.id === id);
  return a ? (a.display_name || a.aspsp_name || "Conta") : "—";
}

export function catName(id) {
  if (!id) return "Sem categoria";
  return state.categories.find(c => c.id === id)?.name || "—";
}

/** Nome de um grupo, com o emoji à frente quando existe. */
export function groupName(id) {
  if (!id) return "Sem grupo";
  const g = state.categoryGroups.find(x => x.id === id);
  if (!g) return "—";
  return (g.emoji ? g.emoji + " " + g.name : g.name).trim();
}

/**
 * Despesas agregadas por grupo, ordenadas.
 *
 * O movimento aponta para a categoria, não para o grupo — daí o mapa
 * de categoria para grupo, construído uma vez em vez de uma procura
 * por cada movimento.
 */
export function expensesByGroup(list = currentMonthTransactions()) {
  const grupoDe = new Map(state.categories.map(c => [c.id, c.group_id]));
  const tipos = mapaDeTipos();
  const map = new Map();

  list
    .filter(t => t.amount < 0 && tipos.get(t.category_id) !== "saving")
    .forEach(t => {
      const key = grupoDe.get(t.category_id) || "sem-grupo";
      map.set(key, (map.get(key) || 0) + Math.abs(Number(t.amount)));
    });

  return [...map.entries()]
    .map(([id, value]) => ({
      id,
      name: groupName(id === "sem-grupo" ? null : id),
      value: Number(value.toFixed(2)),
    }))
    .sort((a, b) => b.value - a.value);
}

/** Série mensal do ano selecionado, para o gráfico de evolução. */
export function yearlySeries() {
  const tipos = mapaDeTipos();
  const income = Array(12).fill(0);
  const expense = Array(12).fill(0);
  const saving = Array(12).fill(0);

  state.transactions.forEach(t => {
    if (yearOf(t.value_date) !== state.year) return;
    if (!passaFiltroConta(t)) return;

    const m = monthOf(t.value_date);
    const v = Number(t.amount);

    if (tipos.get(t.category_id) === "saving") saving[m] += -v;
    else if (v > 0) income[m] += v;
    else expense[m] += Math.abs(v);
  });

  const arredondar = a => a.map(v => Number(v.toFixed(2)));
  return {
    income: arredondar(income),
    expense: arredondar(expense),
    saving: arredondar(saving),
  };
}

// ─── Mutações locais (após gravar com sucesso) ───

export function addLocal(rows) {
  state.transactions.push(...rows);
}

export function updateLocal(id, patch) {
  const t = state.transactions.find(x => x.id === id);
  if (t) Object.assign(t, patch);
  return t;
}

/** Procura nas duas listas — o id pode ser de um movimento arquivado. */
export function findTransaction(id) {
  return state.transactions.find(t => t.id === id)
    || state.archived.find(t => t.id === id)
    || null;
}

/**
 * Passa um movimento para o arquivo, localmente.
 *
 * Move em vez de apagar: se a lista de arquivados já estiver
 * carregada, o movimento aparece lá de imediato sem ir ao servidor.
 * Se ainda não estiver, o fetch posterior traz a lista completa e
 * substitui esta entrada — não há duplicado possível.
 */
export function archiveLocal(id, quando = new Date().toISOString()) {
  const i = state.transactions.findIndex(t => t.id === id);
  if (i === -1) return null;
  const [t] = state.transactions.splice(i, 1);
  t.deleted_at = quando;
  state.archived.push(t);
  return t;
}

/** O caminho inverso: sai do arquivo e volta a contar para os totais. */
export function restoreLocal(id) {
  const i = state.archived.findIndex(t => t.id === id);
  if (i === -1) return null;
  const [t] = state.archived.splice(i, 1);
  t.deleted_at = null;
  state.transactions.push(t);
  return t;
}

export function existingHashes() {
  const set = new Set();
  state.transactions.forEach(t => {
    if (t.source_hash) {
      set.add(t.source_hash);
    } else if (t.value_date && t.description) {
      // Os movimentos vindos da API não guardam source_hash (ver
      // openbanking.js). Calcula-se aqui para que a importação de
      // Excel os reconheça e não os volte a inserir.
      set.add(makeHash(t.value_date, t.description, t.amount));
    }
  });
  return set;
}

/** Referências dos movimentos já vindos da API do banco. */
export function existingEntryReferences() {
  return new Set(state.transactions.map(t => t.entry_reference).filter(Boolean));
}
