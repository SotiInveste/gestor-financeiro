// ═══════════════════════════════════════════════════════════
// Estado partilhado da aplicação
//
// Depois de gravar no Supabase, atualizamos o estado local em
// vez de refazer o fetch completo — muito mais rápido.
// ═══════════════════════════════════════════════════════════

import { monthOf, yearOf, makeHash } from "./utils.js";

export const state = {
  transactions: [],
  rules: [],
  categories: [],
  categoryGroups: [],
  month: new Date().getMonth(),
  year: new Date().getFullYear(),
  page: "dashboard",
};

/** Movimentos do período selecionado (filtrados pela DATA VALOR). */
export function currentMonthTransactions() {
  return state.transactions
    .filter(t => monthOf(t.value_date) === state.month && yearOf(t.value_date) === state.year)
    .sort((a, b) => a.value_date.localeCompare(b.value_date));
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
