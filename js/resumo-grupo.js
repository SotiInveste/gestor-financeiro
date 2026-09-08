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

import * as db from "./db.js";
import { state, noPeriodo, ANUAL, accountName } from "./state.js";
import { toast } from "./ui.js";
import { fmt, esc, shortDate, MONTHS } from "./utils.js";

/**
 * Código do grupo a resumir — fin_category_groups.code.
 *
 * Os 15 grupos semeados pela migração 002 ocupam os códigos 11..25;
 * os criados na aplicação começam em 26. O 27 é o «Despesas Wheelt».
 */
const GRUPO_CODE = 27;

// ─── Visto "Pago" ───
//
// Estado por período, carregado à primeira pintura e mantido a par
// localmente a seguir. Null enquanto não chegou: o visto aparece
// desactivado em vez de aparecer em branco e mentir.
let pagos = null;
let aCarregar = null;

/** Chave do período no conjunto local. O mês é 1..12, como na tabela. */
const chavePeriodo = () => `${state.year}-${state.month + 1}`;

function garantirPagos() {
  if (pagos || aCarregar) return;
  aCarregar = db.fetchGroupPaid(GRUPO_CODE)
    .then(linhas => {
      pagos = new Set(linhas.map(l => `${l.year}-${l.month}`));
      renderResumoGrupo();
    })
    .catch(err => {
      // O quadro é útil mesmo sem o visto — provavelmente falta
      // correr a migração 013. Falhar tudo por causa disto seria pior.
      console.error("Erro ao carregar o estado de pagamento:", err);
      pagos = new Set();
    })
    .finally(() => { aCarregar = null; });
}

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
  garantirPagos();

  const nomes = new Map(
    state.categories
      .filter(c => c.group_id === grupo.id)
      .map(c => [c.id, c.name]),
  );

  // Sem filtro de conta, de propósito: as despesas deste grupo tanto
  // podem sair de uma conta como de outra, e o que interessa é o
  // total do grupo no período. Daí o noPeriodo em vez do
  // currentMonthTransactions, que aplicaria a conta escolhida.
  //
  // É também por isso que a coluna da conta existe: sem ela, um total
  // que junta contas diferentes não se consegue reconciliar com nada.
  const movimentos = state.transactions
    .filter(t => noPeriodo(t) && nomes.has(t.category_id))
    .sort((a, b) =>
      String(a.value_date).localeCompare(String(b.value_date)) ||
      String(a.description || "").localeCompare(String(b.description || ""), "pt"));

  const total = movimentos.reduce((s, t) => s + Number(t.amount), 0);
  const n = movimentos.length;
  const titulo = `${grupo.emoji || ""} ${grupo.name}`.trim();

  // No modo anual não há visto: o quadro mostra o total do ano e um
  // único visto para doze meses entraria em contradição com os vistos
  // mensais que estivessem por marcar.
  const mensal = state.month !== ANUAL;
  const pago = mensal && pagos?.has(chavePeriodo());
  // O visto vive numa coluna própria, à direita, e não dentro da
  // célula do valor: metido lá, empurrava o total para a esquerda e
  // ele deixava de ficar alinhado com os valores das linhas de cima.
  const vistoPago = mensal ? `
    <label class="pago-toggle" title="Marcar este mês como pago">
      <input type="checkbox" id="resumo-pago"${pago ? " checked" : ""}${
        pagos ? "" : " disabled"}>
      Pago
    </label>` : "";

  const corpo = n ? `
    <div class="table-scroll">
      <table class="table resumo-table">
        <thead>
          <tr>
            <th>Data</th>
            <th>Descrição</th>
            <th>Categoria</th>
            <th>Conta</th>
            <th class="right">Valor</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${movimentos.map(t => `
            <tr>
              <td class="cell-date">${shortDate(t.value_date)}</td>
              <td class="cell-desc">${esc(t.description)}</td>
              <td>${esc(nomes.get(t.category_id))}</td>
              <td class="resumo-conta">${esc(accountName(t.bank_account_id))}</td>
              <td class="cell-amount ${Number(t.amount) < 0 ? "red" : "green"}">${fmt(t.amount)}</td>
              <td></td>
            </tr>`).join("")}
        </tbody>
        <tfoot>
          <tr class="${pago ? "pago" : ""}">
            <td colspan="4" class="foot-label">
              Total<span class="muted"> · ${n} movimento${n === 1 ? "" : "s"}</span>
            </td>
            <td class="foot-value ${total < 0 ? "red" : "green"}">${fmt(total)}</td>
            <td class="foot-pago">${vistoPago}</td>
          </tr>
        </tfoot>
      </table>
    </div>` : `<p class="muted resumo-vazio">Sem movimentos neste período.</p>`;

  card.innerHTML = `
    <div class="resumo-head">
      <h3 class="card-title">${esc(titulo)}</h3>
      <span class="muted">todas as contas · ${esc(rotuloPeriodo())}</span>
    </div>
    ${corpo}`;

  const chk = card.querySelector("#resumo-pago");
  if (chk) chk.onchange = () => alternarPago(chk);
}

/**
 * Marca ou desmarca o período como pago.
 *
 * Optimista: o visto responde logo e só volta atrás se a gravação
 * falhar. Sem isso, a caixa ficava a piscar entre o clique e a
 * resposta do servidor.
 */
async function alternarPago(chk) {
  const marcar = chk.checked;
  const ano = state.year;
  const mes = state.month + 1;
  const chave = `${ano}-${mes}`;

  chk.disabled = true;
  try {
    if (marcar) {
      await db.setGroupPaid(GRUPO_CODE, ano, mes);
      pagos.add(chave);
    } else {
      await db.unsetGroupPaid(GRUPO_CODE, ano, mes);
      pagos.delete(chave);
    }
    renderResumoGrupo();
  } catch (err) {
    console.error("Erro ao gravar o estado de pagamento:", err);
    toast(/relation|does not exist|schema cache/i.test(err?.message || "")
      ? "Falta correr a migração 013_grupo_pago.sql no Supabase."
      : "Não foi possível gravar.", "err");
    chk.checked = !marcar;
    chk.disabled = false;
  }
}
