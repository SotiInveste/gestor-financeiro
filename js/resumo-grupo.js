// ═══════════════════════════════════════════════════════════
// Resumo de um grupo de categorias, por baixo dos totais
//
// Módulo isolado: se falhar, a tabela de movimentos continua a
// funcionar na mesma.
//
// O grupo é identificado pelo CÓDIGO, não pelo nome nem pelo id.
// O nome muda a qualquer momento na página de categorias e o id é
// um uuid diferente em cada base de dados; o código é estável e
// nunca é reutilizado (ver a migração 002).
// ═══════════════════════════════════════════════════════════

import { state, noPeriodo, ANUAL } from "./state.js";
import { fmt, esc, MONTHS } from "./utils.js";

/**
 * Código do grupo a resumir — fin_category_groups.code.
 *
 * Os 15 grupos semeados pela migração 002 ocupam os códigos 11..25;
 * os criados na aplicação começam em 26. O 27 é o «Despesas Wheelt».
 */
const GRUPO_CODE = 27;

/** Rótulo do período em curso, para o subtítulo do cartão. */
function rotuloPeriodo() {
  return state.month === ANUAL
    ? `ano de ${state.year}`
    : `${MONTHS[state.month]} de ${state.year}`;
}

export function renderResumoGrupo() {
  const card = document.getElementById("resumo-grupo");
  if (!card) return;

  const grupo = state.categoryGroups.find(g => Number(g.code) === GRUPO_CODE);

  // Sem o grupo não há nada a somar. Esconder em silêncio deixaria
  // a suspeita de que o quadro está avariado, por isso a consola diz
  // exactamente o que existe e com que código.
  if (!grupo) {
    card.classList.add("hidden");
    console.error(
      `Resumo: não existe nenhum grupo com o código ${GRUPO_CODE}. ` +
      `Grupos disponíveis:`,
      state.categoryGroups.map(g => `${g.code} — ${g.name}`),
    );
    return;
  }

  card.classList.remove("hidden");

  const nomes = new Map(
    state.categories
      .filter(c => c.group_id === grupo.id)
      .map(c => [c.id, c.name]),
  );

  // Sem filtro de conta, de propósito: as despesas deste grupo tanto
  // podem sair de uma conta como de outra, e o que interessa é o
  // total do grupo no período. Daí o noPeriodo em vez do
  // currentMonthTransactions, que aplicaria a conta escolhida.
  const porCategoria = new Map();
  let total = 0;
  let n = 0;

  state.transactions.filter(noPeriodo).forEach(t => {
    if (!nomes.has(t.category_id)) return;
    const v = Number(t.amount);
    porCategoria.set(t.category_id, (porCategoria.get(t.category_id) || 0) + v);
    total += v;
    n += 1;
  });

  const titulo = `${grupo.emoji || ""} ${grupo.name}`.trim();
  const linhas = [...porCategoria.entries()]
    // Maior gasto primeiro. Os valores são negativos nas despesas,
    // por isso a ordem crescente do valor é a decrescente do gasto.
    .sort((a, b) => a[1] - b[1]);

  card.innerHTML = `
    <div class="resumo-head">
      <h3 class="card-title">${esc(titulo)}</h3>
      <span class="muted">todas as contas · ${esc(rotuloPeriodo())}</span>
    </div>
    ${linhas.length ? `
      <div class="resumo-linhas">
        ${linhas.map(([id, v]) => `
          <div class="resumo-linha">
            <span>${esc(nomes.get(id))}</span>
            <span class="${v < 0 ? "red" : "green"}">${fmt(v)}</span>
          </div>`).join("")}
      </div>` : `<p class="muted resumo-vazio">Sem movimentos neste período.</p>`}
    <div class="resumo-total">
      <span>Total<span class="muted"> · ${n} movimento${n === 1 ? "" : "s"}</span></span>
      <span class="${total < 0 ? "red" : "green"}">${fmt(total)}</span>
    </div>`;
}
