// ═══════════════════════════════════════════════════════════
// Estado partilhado da aplicação
//
// Depois de gravar no Supabase, atualizamos o estado local em
// vez de refazer o fetch completo — muito mais rápido.
// ═══════════════════════════════════════════════════════════

import { monthOf, yearOf } from "./utils.js";

export const state = {
  transactions: [],
  rules: [],
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
  const map = {};
  list.filter(t => t.amount < 0).forEach(t => {
    map[t.category] = (map[t.category] || 0) + Math.abs(Number(t.amount));
  });
  return Object.entries(map)
    .map(([name, value]) => ({ name, value: Number(value.toFixed(2)) }))
    .sort((a, b) => b.value - a.value);
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
  return new Set(state.transactions.map(t => t.source_hash).filter(Boolean));
}

/** Referências dos movimentos já vindos da API do banco. */
export function existingEntryReferences() {
  return new Set(state.transactions.map(t => t.entry_reference).filter(Boolean));
}
