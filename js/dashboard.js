// ═══════════════════════════════════════════════════════════
// Dashboard — KPIs, donut de categorias e evolução anual
// ═══════════════════════════════════════════════════════════

import {
  state, currentMonthTransactions, monthTotals,
  expensesByCategory, expensesByGroup, expenseMovementsByCategory,
  yearlySeries, ANUAL,
} from "./state.js";
import { fmt, MONTHS_SHORT, CHART_COLORS, esc, shortDate } from "./utils.js";
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

  // ─── Vista anual ou mensal ───
  //
  // Os KPIs servem as duas: no modo anual os totais são do ano, porque
  // o currentMonthTransactions passa a devolver o ano inteiro. O que
  // muda é o resto — a anual tem a evolução ao longo do ano, a mensal
  // tem os gráficos por grupo e por categoria.
  //
  // O gráfico de evolução saiu da vista mensal: repetia-se em todos os
  // meses e não dizia nada sobre o mês escolhido.
  const anual = state.month === ANUAL;

  const empty = document.getElementById("dashboard-empty");
  const charts = document.getElementById("dashboard-charts");
  const evolucao = document.getElementById("card-evolution");
  const isEmpty = list.length === 0;

  if (evolucao) evolucao.classList.toggle("hidden", !anual);
  empty.classList.toggle("hidden", !isEmpty);
  charts.classList.toggle("hidden", anual || isEmpty);

  const yearLabel = document.getElementById("year-label");
  if (yearLabel) yearLabel.textContent = state.year;

  renderDestino(totals);

  if (anual) {
    renderEvolutionChart();
    return;
  }

  if (!isEmpty) {
    const porCategoria = expensesByCategory(list);
    const porGrupo = expensesByGroup(list);

    renderDonutGrupos(porGrupo, porCategoria, totals.expense);
    renderDonut("categorias", "chart-categories", "legend-categories", porCategoria, totals.expense);
    renderGruposComCategorias(porGrupo, porCategoria, totals.expense, list);
  }
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

  // Sem legenda: o donut vive agora ao lado dos KPIs, e cada fatia
  // corresponde a um deles — as cores fazem a ligação.
  renderDonut("destino", "chart-destino", null, fatias, total);

  const base = document.getElementById("destino-base");
  if (base) {
    if (!fatias.length) base.textContent = "";
    else base.textContent = totals.balance >= 0
      ? "% das receitas"
      : "sem sobra este mês";
  }
}

/**
 * Donut de despesas. Serve categorias e grupos — só mudam os dados e
 * os elementos onde desenha.
 */
/**
 * Clareia uma cor da paleta, misturando-a com branco.
 *
 * As categorias de um grupo são tons da mesma cor: assim o anel
 * continua a ler-se como as fatias do grupo, e não como uma salada
 * de cores sem relação entre si.
 */
function clarear(hex, quanto) {
  const n = parseInt(hex.slice(1), 16);
  const mistura = c => Math.round(c + (255 - c) * quanto);
  const r = mistura((n >> 16) & 255);
  const g = mistura((n >> 8) & 255);
  const b = mistura(n & 255);
  return `rgb(${r}, ${g}, ${b})`;
}

/**
 * Donut dos grupos, com cada fatia a dividir-se nas suas categorias
 * quando o rato lá passa.
 *
 * Um anel só, e não dois: o gráfico desenha SEMPRE uma fatia por
 * categoria, mas todas as de um grupo partilham a cor do grupo. Em
 * repouso lê-se como uma fatia inteira; ao passar o rato, as do
 * grupo apontado ganham tons distintos e as divisões aparecem.
 *
 * O número de fatias nunca muda — só as cores e o deslocamento. Se
 * mudasse, o índice da fatia sob o rato mudava com ele e o gráfico
 * entrava a piscar entre dois estados.
 */
function renderDonutGrupos(porGrupo, porCategoria, totalExpense) {
  const canvas = document.getElementById("chart-groups");
  const legend = document.getElementById("legend-groups");
  if (!canvas) return;

  if (graficos.grupos) graficos.grupos.destroy();
  const cores = themeColors();

  if (!porGrupo.length) {
    if (legend) legend.innerHTML = '<span class="muted">Sem dados neste mês.</span>';
    return;
  }

  const porG = categoriasPorGrupo(porCategoria);

  // Uma entrada por fatia desenhada, a saber a que grupo pertence.
  const fatias = [];
  porGrupo.forEach((g, gi) => {
    const base = g.cor || CHART_COLORS[gi % CHART_COLORS.length];
    const cats = porG.get(g.id) || [];
    const lista = cats.length ? cats : [{ name: g.name, value: g.value }];

    lista.forEach((c, ci) => {
      fatias.push({
        grupo: gi,
        grupoNome: g.name,
        nome: c.name,
        valor: c.value,
        base,
        // A maior categoria fica com a cor pura e as seguintes vão
        // clareando — a ordem de leitura acompanha a do tamanho.
        tom: clarear(base, lista.length > 1 ? (ci / lista.length) * 0.55 : 0),
      });
    });
  });

  let apontado = -1;   // índice do grupo sob o rato, ou -1

  const fundos = () => fatias.map(f => (apontado === f.grupo ? f.tom : f.base));
  const saltos = () => fatias.map(f => (apontado === f.grupo ? 12 : 0));
  // A borda só aparece no grupo apontado: é o que separa as
  // categorias umas das outras. Em repouso seria uma teia de linhas
  // a cortar fatias que se querem inteiras.
  const bordas = () => fatias.map(f => (apontado === f.grupo ? 2 : 0));

  graficos.grupos = new Chart(canvas, {
    type: "doughnut",
    data: {
      labels: fatias.map(f => f.nome),
      datasets: [{
        data: fatias.map(f => f.valor),
        backgroundColor: fundos(),
        offset: saltos(),
        borderWidth: bordas(),
        borderColor: cores.surface,
        hoverBorderColor: cores.surface,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: "58%",
      animation: { duration: 250 },
      onHover: (evt, elementos, chart) => {
        const alvo = elementos.length ? fatias[elementos[0].index].grupo : -1;
        if (alvo === apontado) return;
        apontado = alvo;
        const d = chart.data.datasets[0];
        d.backgroundColor = fundos();
        d.offset = saltos();
        d.borderWidth = bordas();
        // "none": sem animação, senão cada passagem do rato
        // recomeçava o desenho todo.
        chart.update("none");
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: ctx => fatias[ctx[0].dataIndex].grupoNome,
            label: ctx => {
              const pct = totalExpense ? ((ctx.parsed / totalExpense) * 100).toFixed(1) : 0;
              return ` ${ctx.label}: ${fmt(ctx.parsed)} (${pct}%)`;
            },
          },
        },
      },
    },
  });

  // Legenda só com os grupos: com 59 categorias passaria das vinte
  // etiquetas e empurrava o gráfico para fora do cartão. As
  // categorias dizem-se no tooltip e estão todas na lista por baixo.
  if (!legend) return;
  legend.innerHTML = porGrupo.map((g, i) => {
    const pct = totalExpense ? ((g.value / totalExpense) * 100).toFixed(0) : 0;
    const cor = g.cor || CHART_COLORS[i % CHART_COLORS.length];
    return `<span class="legend-item">
      <span class="legend-dot" style="background:${cor}"></span>
      ${esc(g.name)} <b>${pct}%</b>
    </span>`;
  }).join("");
}

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
/**
 * As categorias de cada grupo, a partir da lista já agregada.
 *
 * O expensesByCategory devolve-as ordenadas por valor, e separá-las
 * por grupo mantém essa ordem — a maior de cada grupo aparece
 * primeiro, como no gráfico.
 *
 * Um movimento sem categoria cai em "sem-categoria" na lista das
 * categorias e em "sem-grupo" na dos grupos. O get() falha, o || a
 * seguir apanha-o, e os dois lados encontram-se na mesma chave.
 */
function categoriasPorGrupo(porCategoria) {
  const grupoDe = new Map(state.categories.map(c => [c.id, c.group_id]));
  const mapa = new Map();

  porCategoria.forEach(c => {
    const g = grupoDe.get(c.id) || "sem-grupo";
    if (!mapa.has(g)) mapa.set(g, []);
    mapa.get(g).push(c);
  });
  return mapa;
}

/**
 * Uma categoria do painel, a abrir para os seus movimentos.
 *
 * Sem percentagem ao nível do movimento: três colunas de
 * percentagens encavalitadas são ruído, e ali o que interessa é
 * quanto custou.
 *
 * A descrição é a do banco, a mesma que aparece na página de
 * Movimentos — é por ela que se reconhece a linha.
 */
function categoriaHTML(c, movimentos, pct) {
  const n = movimentos.length;

  // A nota, quando existe, fica numa segunda linha por baixo da
  // descrição: lado a lado as duas competiam pelo mesmo espaço e
  // ambas ficavam cortadas.
  const linhas = movimentos.map(t => `
    <div class="top-row mov-dash">
      <span class="mov-data">${shortDate(t.value_date)}</span>
      <span class="name">
        <span class="mov-desc" title="${esc(t.description)}">${esc(t.description)}</span>
        ${t.note ? `<span class="mov-nota">${esc(t.note)}</span>` : ""}
      </span>
      <span class="val">${fmt(Math.abs(Number(t.amount)))}</span>
    </div>`).join("");

  return `
    <details class="cat-dash">
      <summary>
        <div class="top-row">
          <span class="chevron" aria-hidden="true">\u203A</span>
          <span class="name">${esc(c.name)}</span>
          <span class="mov-conta">${n} mov.</span>
          <span class="val">${fmt(c.value)}</span>
          <span class="pct">${pct(c.value)}%</span>
        </div>
      </summary>
      <div class="cat-dash-movs">${linhas}</div>
    </details>`;
}

/**
 * Todos os grupos com despesa no mês, cada um a abrir para as suas
 * categorias.
 *
 * Sem corte: a lista antiga parava nos 9 maiores e o resto do mês
 * ficava invisível.
 *
 * As percentagens — a do grupo e a das categorias — são sobre o
 * total de despesas do mês, não sobre o grupo. Assim uma categoria
 * vale o mesmo número onde quer que apareça, e podem comparar-se
 * linhas de grupos diferentes.
 *
 * O <details> fecha-se sozinho a cada repintura, que é o que se
 * quer: o painel abre pela vista geral e abre-se só o que interessa.
 */
function renderGruposComCategorias(porGrupo, porCategoria, totalExpense, list) {
  const container = document.getElementById("top-groups");
  if (!container) return;

  if (!porGrupo.length) {
    container.innerHTML = '<span class="muted">Sem despesas neste mês.</span>';
    return;
  }

  const pct = v => (totalExpense ? ((v / totalExpense) * 100).toFixed(0) : 0);
  const porG = categoriasPorGrupo(porCategoria);
  const movsDe = expenseMovementsByCategory(list);

  container.innerHTML = porGrupo.map((g, i) => {
    // Mesmo índice que o gráfico usa, para a bolinha ficar com a cor
    // da fatia correspondente.
    const cor = g.cor || CHART_COLORS[i % CHART_COLORS.length];
    const cats = porG.get(g.id) || [];

    const linhas = cats.length
      ? cats.map(c => categoriaHTML(c, movsDe.get(c.id) || [], pct)).join("")
      : '<span class="muted">Sem categorias.</span>';

    return `
      <details class="grupo-dash">
        <summary>
          <div class="top-row">
            <span class="chevron" aria-hidden="true">\u203A</span>
            <span class="legend-dot" style="background:${cor}"></span>
            <span class="name">${esc(g.name)}</span>
            <span class="val">${fmt(g.value)}</span>
            <span class="pct">${pct(g.value)}%</span>
          </div>
        </summary>
        <div class="grupo-dash-cats">${linhas}</div>
      </details>`;
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
      // Clicar numa barra desce ao mês respectivo — é a forma natural
      // de passar da vista anual para o detalhe.
      onClick: (_evt, elements) => {
        if (!elements.length) return;
        state.month = elements[0].index;
        document.getElementById("select-month").value = state.month;
        document.dispatchEvent(new CustomEvent("period-changed"));
      },
    },
  });
}
