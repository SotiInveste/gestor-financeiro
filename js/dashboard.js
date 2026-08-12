// ═══════════════════════════════════════════════════════════
// Dashboard — KPIs, donut de categorias e evolução anual
// ═══════════════════════════════════════════════════════════

import { state, currentMonthTransactions, monthTotals, expensesByCategory, yearlySeries } from "./state.js";
import { fmt, MONTHS_SHORT, CHART_COLORS, esc } from "./utils.js";
import { themeColors } from "./theme.js";

let categoryChart = null;
let evolutionChart = null;

export function renderDashboard() {
  const list = currentMonthTransactions();
  const totals = monthTotals(list);

  // ─── KPIs ───
  const incomeEl = document.getElementById("kpi-income");
  const expenseEl = document.getElementById("kpi-expense");
  const balanceEl = document.getElementById("kpi-balance");
  if (!incomeEl || !expenseEl || !balanceEl) return; // guarda defensiva

  incomeEl.textContent = fmt(totals.income);
  expenseEl.textContent = fmt(totals.expense);
  balanceEl.textContent = fmt(totals.balance);
  balanceEl.className = "kpi-value " + (totals.balance >= 0 ? "green" : "red");

  // ─── Estado vazio ───
  const empty = document.getElementById("dashboard-empty");
  const charts = document.getElementById("dashboard-charts");
  const isEmpty = list.length === 0;
  empty.classList.toggle("hidden", !isEmpty);
  charts.classList.toggle("hidden", isEmpty);

  const yearLabel = document.getElementById("year-label");
  if (yearLabel) yearLabel.textContent = state.year;

  if (!isEmpty) {
    renderCategoryChart(expensesByCategory(list), totals.expense);
    renderTopCategories(expensesByCategory(list), totals.expense);
  }
  renderEvolutionChart();
}

function renderCategoryChart(data, totalExpense) {
  const canvas = document.getElementById("chart-categories");
  const legend = document.getElementById("legend-categories");
  if (!canvas || !legend) return;

  if (categoryChart) categoryChart.destroy();

  const colors = themeColors();

  if (!data.length) {
    legend.innerHTML = '<span class="muted">Sem despesas neste mês.</span>';
    return;
  }

  categoryChart = new Chart(canvas, {
    type: "doughnut",
    data: {
      labels: data.map(d => d.name),
      datasets: [{
        data: data.map(d => d.value),
        backgroundColor: data.map((_, i) => CHART_COLORS[i % CHART_COLORS.length]),
        borderWidth: 2,
        borderColor: colors.surface,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: "58%",
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => {
              const pct = totalExpense ? ((ctx.parsed / totalExpense) * 100).toFixed(1) : 0;
              return ` ${ctx.label}: ${fmt(ctx.parsed)} (${pct}%)`;
            },
          },
        },
      },
    },
  });

  // Legenda com percentagens
  legend.innerHTML = data.slice(0, 10).map((d, i) => {
    const pct = totalExpense ? ((d.value / totalExpense) * 100).toFixed(0) : 0;
    const color = CHART_COLORS[i % CHART_COLORS.length];
    return `<span class="legend-item">
      <span class="legend-dot" style="background:${color}"></span>
      ${esc(d.name)} <b>${pct}%</b>
    </span>`;
  }).join("");
}

function renderTopCategories(data, totalExpense) {
  const container = document.getElementById("top-categories");
  if (!container) return;

  if (!data.length) {
    container.innerHTML = '<span class="muted">Sem despesas neste mês.</span>';
    return;
  }

  container.innerHTML = data.slice(0, 9).map((c, i) => {
    const pct = totalExpense ? ((c.value / totalExpense) * 100).toFixed(0) : 0;
    const color = CHART_COLORS[i % CHART_COLORS.length];
    return `<div class="top-row">
      <span class="legend-dot" style="background:${color}"></span>
      <span class="name">${esc(c.name)}</span>
      <span class="val">${fmt(c.value)}</span>
      <span class="pct">${pct}%</span>
    </div>`;
  }).join("");
}

function renderEvolutionChart() {
  const canvas = document.getElementById("chart-evolution");
  if (!canvas) return;

  const series = yearlySeries();
  const colors = themeColors();
  if (evolutionChart) evolutionChart.destroy();

  evolutionChart = new Chart(canvas, {
    type: "bar",
    data: {
      labels: MONTHS_SHORT,
      datasets: [
        { label: "Receitas", data: series.income, backgroundColor: "#16a34a", borderRadius: 4 },
        { label: "Despesas", data: series.expense, backgroundColor: "#dc2626", borderRadius: 4 },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: "bottom",
          labels: { boxWidth: 12, font: { size: 12 }, color: colors.text },
        },
        tooltip: { callbacks: { label: ctx => ` ${ctx.dataset.label}: ${fmt(ctx.parsed.y)}` } },
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { color: colors.muted, font: { size: 12 } },
        },
        y: {
          border: { display: false },
          ticks: { callback: v => `${v}€`, font: { size: 11 }, color: colors.muted },
          grid: { color: colors.grid },
        },
      },
      onClick: (_evt, elements) => {
        if (!elements.length) return;
        state.month = elements[0].index;
        document.getElementById("select-month").value = state.month;
        document.dispatchEvent(new CustomEvent("period-changed"));
      },
    },
  });
}
