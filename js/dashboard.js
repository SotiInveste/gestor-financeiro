// ═══════════════════════════════════════════════════════════
// Dashboard — KPIs, donut de categorias e evolução anual
// ═══════════════════════════════════════════════════════════

import {
  state, currentMonthTransactions, monthTotals,
  expensesByCategory, expensesByGroup, yearlySeries,
} from "./state.js";
import { fmt, MONTHS_SHORT, CHART_COLORS, esc } from "./utils.js";
import { themeColors } from "./theme.js";

// Guardados para poderem ser destruídos antes de repintar: o Chart.js
// não substitui um gráfico existente no mesmo canvas.
const graficos = { destino: null, categorias: null, grupos: null, evolucao: null };

export function renderDashboard() {
  const list = currentMonthTransactions();
  const totals = monthTotals(list);

  // ─── KPIs ───
  const incomeEl = document.getElementById("kpi-income");
  const expenseEl = document.getElementById("kpi-expense");
  const savingEl = document.getElementById("kpi-saving");
  const balanceEl = document.getElementById("kpi-balance");
  if (!incomeEl || !expenseEl || !balanceEl) return; // guarda defensiva

  incomeEl.textContent = fmt(totals.income);
  expenseEl.textContent = fmt(totals.expense);
  if (savingEl) savingEl.textContent = fmt(totals.saving);
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
    renderDestino(totals);

    const porCategoria = expensesByCategory(list);
    const porGrupo = expensesByGroup(list);

    renderDonut("grupos", "chart-groups", "legend-groups", porGrupo, totals.expense);
    renderTopList("top-groups", porGrupo, totals.expense);

    renderDonut("categorias", "chart-categories", "legend-categories", porCategoria, totals.expense);
    renderTopList("top-categories", porCategoria, totals.expense);
  }
  renderEvolutionChart();
}

/**
 * Para onde foi o dinheiro do mês.
 *
 * A base dos 100% são as receitas, não a soma de tudo: somar receitas
 * com saídas daria um total sem significado, e as percentagens não
 * responderiam a nada. Assim lê-se "das receitas, X% foi para
 * despesas".
 *
 * Num mês em que se gastou mais do que se recebeu não há sobra, e a
 * base passa a ser o que saiu — as percentagens continuam a somar
 * 100%, mas de uma pergunta diferente. O rótulo diz qual é.
 */
function renderDestino(totals) {
  const fatias = [
    { name: "Despesas", value: totals.expense, cor: "#dc2626" },
    { name: "Poupança", value: totals.saving, cor: "#c9a227" },
    { name: "Sobra", value: Math.max(0, totals.balance), cor: "#16a34a" },
  ].filter(f => f.value > 0);

  const total = fatias.reduce((s, f) => s + f.value, 0);

  // Só a legenda com percentagens: os valores em euros já estão nos
  // KPIs logo acima, e repeti-los aqui não acrescentava nada.
  renderDonut("destino", "chart-destino", "legend-destino", fatias, total);

  const base = document.getElementById("destino-base");
  if (base) {
    base.textContent = totals.balance >= 0
      ? `100% = ${fmt(totals.income)} de receitas`
      : `Gastou-se mais do que se recebeu — 100% = ${fmt(total)} de saídas`;
  }
}

/**
 * Donut de despesas. Serve categorias e grupos — só mudam os dados e
 * os elementos onde desenha.
 */
function renderDonut(chave, canvasId, legendId, data, totalExpense) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;

  // A legenda é opcional: o cartão do destino do dinheiro usa uma
  // lista em vez dela.
  const legend = legendId ? document.getElementById(legendId) : null;

  if (graficos[chave]) graficos[chave].destroy();

  const colors = themeColors();

  if (!data.length) {
    if (legend) legend.innerHTML = '<span class="muted">Sem dados neste mês.</span>';
    return;
  }

  graficos[chave] = new Chart(canvas, {
    type: "doughnut",
    data: {
      labels: data.map(d => d.name),
      datasets: [{
        data: data.map(d => d.value),
        // Uma fatia pode trazer cor própria: no destino do dinheiro
        // cada uma tem significado fixo, e a paleta rotativa trocaria
        // as cores conforme houvesse ou não poupança nesse mês.
        backgroundColor: data.map((d, i) => d.cor || CHART_COLORS[i % CHART_COLORS.length]),
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
  if (!legend) return;
  legend.innerHTML = data.slice(0, 10).map((d, i) => {
    const pct = totalExpense ? ((d.value / totalExpense) * 100).toFixed(0) : 0;
    const color = d.cor || CHART_COLORS[i % CHART_COLORS.length];
    return `<span class="legend-item">
      <span class="legend-dot" style="background:${color}"></span>
      ${esc(d.name)} <b>${pct}%</b>
    </span>`;
  }).join("");
}

/** Lista ordenada de despesas. Serve categorias e grupos. */
function renderTopList(containerId, data, totalExpense) {
  const container = document.getElementById(containerId);
  if (!container) return;

  if (!data.length) {
    container.innerHTML = '<span class="muted">Sem despesas neste mês.</span>';
    return;
  }

  container.innerHTML = data.slice(0, 9).map((c, i) => {
    const pct = totalExpense ? ((c.value / totalExpense) * 100).toFixed(0) : 0;
    const color = c.cor || CHART_COLORS[i % CHART_COLORS.length];
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
  if (graficos.evolucao) graficos.evolucao.destroy();

  graficos.evolucao = new Chart(canvas, {
    type: "bar",
    data: {
      labels: MONTHS_SHORT,
      datasets: [
        { label: "Receitas", data: series.income, backgroundColor: "#16a34a", borderRadius: 4 },
        { label: "Despesas", data: series.expense, backgroundColor: "#dc2626", borderRadius: 4 },
        { label: "Poupança", data: series.saving, backgroundColor: "#c9a227", borderRadius: 4 },
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
