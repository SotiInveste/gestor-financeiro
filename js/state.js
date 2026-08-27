// ═══════════════════════════════════════════════════════════
// Estado partilhado da aplicação
//
// Depois de gravar no Supabase, atualizamos o estado local em
// vez de refazer o fetch completo — muito mais rápido.
// ═══════════════════════════════════════════════════════════

import { monthOf, yearOf, makeHash } from "./utils.js";

// ─── Ordenação da tabela, guardada entre sessões ───

const SORT_KEY = "gestorfin-sort";
const CONTA_KEY = "gestorfin-conta";
const SORT_OMISSAO = { col: "value_date", dir: "asc" };

export const COLUNAS_ORDENAVEIS = [
  "movement_date", "value_date", "description", "note", "category", "amount",
  "account",
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
  account:       (a, b) => texto(accountName(a.bank_account_id),
                                accountName(b.bank_account_id)),
};

/** Movimentos do período selecionado (filtrados pela DATA VALOR). */
export function currentMonthTransactions() {
  const { col, dir } = state.sort;
  const cmp = COMPARADORES[col] || COMPARADORES.value_date;
  const sinal = dir === "desc" ? -1 : 1;

  return state.transactions
    .filter(t => monthOf(t.value_date) === state.month && yearOf(t.value_date) === state.year)
    .filter(passaFiltroConta)
    .sort((a, b) => {
      const r = cmp(a, b) * sinal;
      // Desempate sempre pela data valor, no mesmo sentido: linhas
      // equivalentes deixam de trocar de lugar entre repinturas.
      return r !== 0 ? r : COMPARADORES.value_date(a, b);
    });
}

/** Totais do período selecionado. */
export function monthTotals(list = currentMonthTransactions()) {
  const income = list.filter(t => t.amount > 0).reduce((s, t) => s + Number(t.amount), 0);
  const expense = list.filter(t => t.amount < 0).reduce((s, t) => s + Math.abs(Number(t.amount)), 0);
  return { income, expense, balance: income - expense };
}

/** Despesas agregadas por categoria, ordenadas. */
export function expensesByCategory(list = currentMonthTransactions()) {
  // Agrupado por category_id, não pelo nome: duas categorias com
  // nomes parecidos deixam de ser fundidas por acaso, e renomear
  // uma categoria passa a refletir-se sozinho no histórico.
  const map = new Map();
  list.filter(t => t.amount < 0).forEach(t => {
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

/** Série mensal do ano selecionado, para o gráfico de evolução. */
export function yearlySeries() {
  const income = Array(12).fill(0);
  const expense = Array(12).fill(0);
  state.transactions.forEach(t => {
    if (yearOf(t.value_date) !== state.year) return;
    if (!passaFiltroConta(t)) return;
    const m = monthOf(t.value_date);
    if (t.amount > 0) income[m] += Number(t.amount);
    else expense[m] += Math.abs(Number(t.amount));
  });
  return {
    income: income.map(v => Number(v.toFixed(2))),
    expense: expense.map(v => Number(v.toFixed(2))),
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

export function removeLocal(id) {
  state.transactions = state.transactions.filter(t => t.id !== id);
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
