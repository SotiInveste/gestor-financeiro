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
    renderGruposComCategorias(porGrupo, porCategoria, totals.expense, list);
    ligarExpandirTudo();
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
/** Quanto a fatia apontada salta para fora do anel, em pixéis. */
const SALTO = 26;

/** E quanto engorda, além de saltar. */
const CRESCIMENTO = 14;

/**
 * Intervalo entre fatias, em pixéis. É metade disto de cada lado,
 * por ser desenhado como contorno à volta de cada arco.
 */
const INTERVALO = 5;

/**
 * Esbate uma cor, para os grupos que não estão a ser apontados.
 *
 * Com um grupo em destaque, os outros recuam em vez de desaparecer:
 * continuam a dar a noção das proporções, mas deixam de competir
 * pela atenção.
 */
function esbater(cor) {
  const hex = cor.match(/^#([0-9a-f]{6})$/i);
  if (hex) {
    const n = parseInt(hex[1], 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, .32)`;
  }
  const rgb = cor.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
  return rgb ? `rgba(${rgb[1]}, ${rgb[2]}, ${rgb[3]}, .32)` : cor;
}

/**
 * Engorda as fatias do grupo apontado.
 *
 * O Chart.js não tem raio por fatia — o controlador recalcula-o a
 * cada desenho. Por isso o aumento é feito mesmo antes de pintar e
 * desfeito logo a seguir: assim sobrevive a cada repintura em vez
 * de ser apagado por ela.
 */
const crescerApontado = {
  id: "crescerApontado",
  beforeDatasetDraw(chart) {
    const arcos = chart.$arcos;
    const ap = chart.$apontado;
    if (!arcos || ap == null || ap < 0) return;
    chart.getDatasetMeta(0).data.forEach((arc, i) => {
      if (arcos[i] && arcos[i].grupo === ap) {
        arc.$raioBase = arc.outerRadius;
        arc.outerRadius += CRESCIMENTO;
      }
    });
  },
  afterDatasetDraw(chart) {
    chart.getDatasetMeta(0).data.forEach(arc => {
      if (arc.$raioBase != null) {
        arc.outerRadius = arc.$raioBase;
        arc.$raioBase = null;
      }
    });
  },
};

/**
 * Sombra por baixo das fatias.
 *
 * O Chart.js não desenha sombras; isto liga as do próprio canvas
 * antes do dataset e desliga-as a seguir. Dá relevo ao anel sem
 * mudar geometria nenhuma — e a geometria é precisamente o que não
 * se pode mexer, para o gráfico não saltar.
 */
const sombraDasFatias = {
  id: "sombraDasFatias",
  beforeDatasetDraw(chart) {
    const ctx = chart.ctx;
    ctx.save();
    ctx.shadowColor = "rgba(0, 0, 0, .28)";
    ctx.shadowBlur = 12;
    ctx.shadowOffsetY = 3;
  },
  afterDatasetDraw(chart) {
    chart.ctx.restore();
  },
};

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
  const centro = document.getElementById("donut-centro");
  if (!canvas) return;

  if (graficos.grupos) graficos.grupos.destroy();
  const cores = themeColors();

  if (!porGrupo.length) {
    if (centro) centro.innerHTML = '<span class="muted">Sem dados neste mês.</span>';
    return;
  }

  const porG = categoriasPorGrupo(porCategoria);
  const corDe = (g, i) => g.cor || CHART_COLORS[i % CHART_COLORS.length];

  // ─── Os dois estados de cada grupo ───
  //
  // Em repouso o gráfico tem UM arco por grupo: é isso que deixa o
  // arredondamento das pontas e o intervalo entre fatias caírem onde
  // devem. Ao apontar um grupo, só esse se parte nas suas categorias
  // — e aí o mesmo arredondamento e o mesmo intervalo passam a
  // desenhar as divisões lá dentro, de graça.
  const total = porGrupo.reduce((soma, g) => soma + g.value, 0) || 1;

  // Fatias angulares de cada grupo, para saber qual está sob o rato
  // sem depender do índice do arco. O índice muda quando um grupo se
  // parte; o ângulo que ele ocupa não muda nunca, e é por isso que a
  // deteção é feita assim.
  const limites = [];
  let acumulado = 0;
  porGrupo.forEach(g => {
    const de = acumulado / total;
    acumulado += g.value;
    limites.push({ de, ate: acumulado / total });
  });

  const arcosDe = (apontado) => {
    const out = [];
    porGrupo.forEach((g, gi) => {
      const base = corDe(g, gi);
      const cats = porG.get(g.id) || [];

      if (gi !== apontado || cats.length < 2) {
        out.push({ grupo: gi, nome: g.name, valor: g.value, cor: base });
        return;
      }
      cats.forEach((c, ci) => {
        out.push({
          grupo: gi,
          nome: c.name,
          valor: c.value,
          // A maior fica com a cor pura e as seguintes vão clareando:
          // a ordem de leitura acompanha a do tamanho.
          cor: clarear(base, (ci / cats.length) * 0.55),
        });
      });
    });
    return out;
  };

  let apontado = -1;
  let arcos = arcosDe(-1);

  // Uma casa decimal, e com vírgula: arredondar a zero casas fazia
  // 82,9% virar 83% e as fatias pequenas confundirem-se umas com as
  // outras — várias apareciam todas como "2%".
  const percent = v => (totalExpense ? (v / totalExpense) * 100 : 0)
    .toLocaleString("pt-PT", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

  const escrever = (gi) => {
    if (!centro) return;
    const g = gi >= 0 ? porGrupo[gi] : null;
    const valor = g ? g.value : totalExpense;
    centro.innerHTML = `
      <span class="donut-nome">${esc(g ? g.name : "Despesas do mês")}</span>
      <span class="donut-valor">${fmt(valor)}</span>
      <span class="donut-pct">${g ? `${percent(valor)}% do mês` : "total"}</span>`;
  };
  escrever(-1);

  const corFinal = a =>
    (apontado < 0 || a.grupo === apontado ? a.cor : esbater(a.cor));

  const aplicar = () => {
    const d = graficos.grupos.data;
    d.labels = arcos.map(a => a.nome);
    d.datasets[0].data = arcos.map(a => a.valor);
    d.datasets[0].backgroundColor = arcos.map(corFinal);
    d.datasets[0].offset = arcos.map(a => (a.grupo === apontado ? SALTO : 0));
    // Os plugins de desenho leem daqui: é o que lhes diz qual o grupo
    // a engordar e a que arco corresponde cada fatia.
    graficos.grupos.$arcos = arcos;
    graficos.grupos.$apontado = apontado;
    // "none": sem animação. Com ela, cada passagem do rato recomeçava
    // o desenho e o anel ficava a tremer.
    graficos.grupos.update("none");
  };

  /** Que grupo está sob o rato, pelo ângulo e não pelo índice do arco. */
  const grupoEm = (evt) => {
    const meta = graficos.grupos.getDatasetMeta(0);
    const arco = meta.data[0];
    if (!arco) return -1;

    const dx = evt.x - arco.x;
    const dy = evt.y - arco.y;
    const raio = Math.hypot(dx, dy);
    // Fora do anel não há grupo nenhum apontado — nem no buraco do
    // meio, onde está o texto.
    if (raio < arco.innerRadius || raio > arco.outerRadius + SALTO + CRESCIMENTO) return -1;

    // O donut começa ao cimo; o atan2 começa à direita.
    const t = (((Math.atan2(dy, dx) + Math.PI / 2) % (2 * Math.PI)) + 2 * Math.PI)
      % (2 * Math.PI) / (2 * Math.PI);
    const i = limites.findIndex(l => t >= l.de && t < l.ate);
    return i;
  };

  // O raio em pixéis, e não em percentagem, é o que impede o salto:
  // o Chart.js desconta o maior offset do espaço disponível, por isso
  // ao destacar uma fatia o anel inteiro encolhia 13 px e dava um
  // solavanco. Fixo, fica do mesmo tamanho nos dois estados.
  const raioDisponivel = () => {
    const lado = Math.min(canvas.clientWidth || 300, canvas.clientHeight || 300);
    // Reserva o salto E o crescimento: as duas coisas acontecem ao
    // mesmo tempo na fatia apontada, e sem esta margem ela sairia
    // pela borda do cartão.
    return Math.max(50, lado / 2 - SALTO - CRESCIMENTO - 4);
  };

  graficos.grupos = new Chart(canvas, {
    type: "doughnut",
    plugins: [sombraDasFatias, crescerApontado],
    data: {
      labels: arcos.map(a => a.nome),
      datasets: [{
        data: arcos.map(a => a.valor),
        backgroundColor: arcos.map(a => a.cor),
        offset: arcos.map(() => 0),
        // O intervalo entre fatias é um CONTORNO da cor do cartão, e
        // não o spacing do Chart.js. Medido: o spacing não afasta os
        // arcos — os ângulos ficam colados, e o efeito é pintado no
        // desenho e encolhido nas fatias pequenas para elas não
        // desaparecerem. Daí umas ficarem com mais espaço que outras.
        // Um contorno é uma espessura em pixéis: igual em todas.
        borderWidth: INTERVALO,
        borderColor: cores.surface,
        borderAlign: "inner",
        // Cantos menos redondos do que o intervalo: com 6 px de
        // arredondamento, uma fatia pequena ficava quase toda
        // arredondada e o espaço à volta dela parecia maior que os
        // outros. Com 4, o intervalo lê-se igual em todas.
        borderRadius: 4,
        spacing: 0,
        hoverBorderColor: cores.surface,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: "72%",
      radius: raioDisponivel(),
      animation: { duration: 400, easing: "easeOutQuart" },
      // Ao mudar a janela, o raio tem de ser recalculado à mão: sendo
      // um número fixo, não acompanha sozinho.
      onResize: (chart) => {
        chart.options.radius = raioDisponivel();
      },
      onHover: (evt) => {
        const alvo = grupoEm(evt);
        if (alvo === apontado) return;
        apontado = alvo;
        arcos = arcosDe(alvo);
        escrever(alvo);
        aplicar();
      },
      plugins: {
        legend: { display: false },
        // Sem tooltip: a informação já está no centro do anel, e uma
        // caixa a seguir o rato por cima do gráfico tapava justamente
        // as fatias que se está a tentar ver.
        tooltip: { enabled: false },
      },
    },
  });

  graficos.grupos.$arcos = arcos;
  graficos.grupos.$apontado = -1;

  // Sair do gráfico devolve tudo ao estado de repouso: sem isto, o
  // último grupo apontado ficava aceso depois de o rato sair.
  canvas.onmouseleave = () => {
    if (apontado === -1) return;
    apontado = -1;
    arcos = arcosDe(-1);
    escrever(-1);
    aplicar();
  };
}

/**
 * Abre ou fecha todos os niveis da lista de uma vez.
 *
 * O botao diz o que vai fazer, nao o estado em que esta: com algum
 * fechado, abre tudo; so quando esta tudo aberto e que passa a fechar.
 */
function ligarExpandirTudo() {
  const btn = document.getElementById("btn-expandir-tudo");
  const lista = document.getElementById("top-groups");
  if (!btn || !lista) return;

  const todos = () => [...lista.querySelectorAll("details")];

  const sincronizar = () => {
    const d = todos();
    btn.textContent = d.length && d.every(x => x.open) ? "Fechar tudo" : "Expandir tudo";
    btn.classList.toggle("hidden", d.length === 0);
  };

  btn.onclick = () => {
    const d = todos();
    const abrir = !(d.length && d.every(x => x.open));
    d.forEach(x => { x.open = abrir; });
    sincronizar();
  };

  // Um clique num grupo qualquer pode deixar tudo aberto ou fechado:
  // o rotulo tem de acompanhar. O toggle nao borbulha, dai o true.
  lista.addEventListener("toggle", sincronizar, true);
  sincronizar();
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

  // Mesma regra do centro do gráfico: uma casa decimal. Com zero
  // casas, o gráfico dizia 82,9% e a lista 83% para o mesmo grupo.
  const pct = v => (totalExpense ? (v / totalExpense) * 100 : 0)
    .toLocaleString("pt-PT", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
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
