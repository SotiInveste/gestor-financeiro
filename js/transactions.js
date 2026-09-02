// ═══════════════════════════════════════════════════════════
// Página de Movimentos — tabela, edição inline, entrada manual
// ═══════════════════════════════════════════════════════════

import {
  state, currentMonthTransactions, monthTotals,
  updateLocal, addLocal, guardarOrdenacao, accountName,
  findTransaction, archiveLocal, restoreLocal,
} from "./state.js";
import { fmt, shortDate, esc, today } from "./utils.js";
import {
  fillCategorySelect, suggestKeyword, categoryName,
  groupedCategories, categoryById,
} from "./categories.js";
import * as db from "./db.js";
import { toast, confirmModal, setLoading } from "./ui.js";

let manualType = "expense";

// Mostrar ou não os movimentos arquivados. Não é guardado entre
// sessões, tal como na página de categorias: cada visita começa pela
// vista normal, e o arquivo é uma consulta pontual.
let verArquivados = false;

// ═══ Arquivo ═══

/**
 * Liga o interruptor "Ver arquivados".
 *
 * Os arquivados são carregados à primeira vez que são pedidos e
 * ficam em memória até ao fim da sessão. Se a consulta falhar, o
 * interruptor volta atrás — mostrar a caixa marcada sem ter dados
 * daria a entender que não há nada arquivado.
 */
export function initArquivadosToggle() {
  const chk = document.getElementById("chk-ver-arquivados");
  if (!chk) return;

  chk.checked = verArquivados;
  chk.onchange = async () => {
    verArquivados = chk.checked;

    if (verArquivados && !state.archivedLoaded) {
      chk.disabled = true;
      try {
        state.archived = await db.fetchArchivedTransactions();
        state.archivedLoaded = true;
      } catch (err) {
        console.error("Erro ao carregar os movimentos arquivados:", err);
        toast("Não foi possível carregar os movimentos arquivados.", "err");
        verArquivados = false;
        chk.checked = false;
      } finally {
        chk.disabled = false;
      }
    }

    renderTransactions();
  };
}

// ═══ Ordenação da tabela ═══

/**
 * Liga os cabeçalhos. Chamado uma vez no arranque — o <thead> é
 * estático, só o indicador é repintado a cada render.
 */
export function initTableSorting() {
  document.querySelectorAll("#table-wrap th.sortable").forEach(th => {
    const aplicar = () => ordenarPor(th.dataset.sort);
    th.onclick = aplicar;
    th.onkeydown = e => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); aplicar(); }
    };
  });
  atualizarIndicadores();
}

function ordenarPor(col) {
  if (!col) return;
  // Clicar na coluna já ativa inverte o sentido; noutra coluna
  // começa sempre por crescente.
  if (state.sort.col === col) {
    state.sort.dir = state.sort.dir === "asc" ? "desc" : "asc";
  } else {
    state.sort = { col, dir: "asc" };
  }
  guardarOrdenacao();
  renderTransactions();
}

function atualizarIndicadores() {
  document.querySelectorAll("#table-wrap th.sortable").forEach(th => {
    const ativa = th.dataset.sort === state.sort.col;
    const ind = th.querySelector(".sort-ind");
    th.classList.toggle("ordenada", ativa);
    th.setAttribute("aria-sort",
      ativa ? (state.sort.dir === "asc" ? "ascending" : "descending") : "none");
    if (ind) ind.textContent = ativa ? (state.sort.dir === "asc" ? "\u25B2" : "\u25BC") : "";
  });
}

/**
 * Repõe as opções do seletor de categoria do formulário manual.
 *
 * O seletor era preenchido só no arranque, dentro de initManualForm.
 * Categorias criadas ou renomeadas durante a sessão não chegavam lá,
 * e a lista aparecia incompleta até recarregar a página.
 *
 * A escolha em curso é preservada; se essa categoria tiver entretanto
 * desaparecido, volta-se à predefinição.
 */
function refreshManualCategorySelect() {
  const sel = document.getElementById("m-category");
  if (!sel) return;

  const atual = sel.value;
  const aindaExiste = state.categories.some(c => c.id === atual);

  // Sem escolha válida em curso, fica na primeira da lista — não há
  // categoria predefinida que sirva para todos os lançamentos.
  fillCategorySelect(sel, aindaExiste ? atual : null);
  if (!aindaExiste) sel.selectedIndex = 0;
}

/**
 * Mostra no título do formulário em que conta o movimento vai entrar.
 *
 * Não há seletor de conta: o filtro do topo tem sempre exatamente uma
 * conta escolhida, e é essa. Um seletor que só podia repetir essa
 * escolha era um campo a mais e uma hipótese de divergência.
 */
function refreshManualAccountLabel() {
  const el = document.getElementById("m-conta-label");
  if (!el) return;
  el.textContent = state.accountFilter
    ? ` · ${accountName(state.accountFilter)}`
    : "";
}

/**
 * Data com que o formulário abre.
 *
 * No mês corrente é hoje. Noutro mês é o dia 1, para o calendário
 * abrir logo no mês que está selecionado no topo em vez de saltar
 * para o mês atual.
 */
function dataPredefinida() {
  const hoje = new Date();
  if (state.month === hoje.getMonth() && state.year === hoje.getFullYear()) {
    return today();
  }
  return `${state.year}-${String(state.month + 1).padStart(2, "0")}-01`;
}

export function renderTransactions() {
  // Duas listas: a que se mostra e a que conta. Os totais do rodapé
  // saem sempre dos activos, para não mudarem consoante o
  // interruptor esteja ligado ou não.
  const activos = currentMonthTransactions();
  const list = verArquivados
    ? currentMonthTransactions({ incluirArquivados: true })
    : activos;

  const body = document.getElementById("table-body");
  const foot = document.getElementById("table-foot");
  const wrap = document.getElementById("table-wrap");
  const empty = document.getElementById("table-empty");
  if (!body || !foot) return; // guarda defensiva

  // O estado das categorias e contas pode ter mudado noutra página.
  refreshManualCategorySelect();
  refreshManualAccountLabel();

  const nArquivados = list.length - activos.length;
  const cont = document.getElementById("arquivados-count");
  if (cont) {
    cont.textContent = nArquivados
      ? `(${nArquivados} neste período)`
      : (verArquivados ? "(nenhum neste período)" : "");
  }

  const isEmpty = list.length === 0;
  wrap.classList.toggle("hidden", isEmpty);
  empty.classList.toggle("hidden", !isEmpty);

  if (isEmpty) {
    body.innerHTML = "";
    foot.innerHTML = "";
    atualizarIndicadores();
    return;
  }

  body.innerHTML = list.map(t => rowHTML(t)).join("");
  foot.innerHTML = footHTML(monthTotals(activos));
  bindRowEvents();
  atualizarIndicadores();
}

function rowHTML(t) {
  if (t.deleted_at) return rowArquivadaHTML(t);

  const pending = t.is_confirmed ? "" : " pending";
  const validated = t.is_validated ? " class=\"validated\"" : "";
  const amountColor = t.amount >= 0 ? "green" : "red";

  return `
  <tr data-id="${t.id}"${validated}>
    <td class="cell-date">${shortDate(t.movement_date)}</td>
    <td class="cell-valuedate">
      <span class="editable-date" data-action="edit-date" title="Clica para editar a data de valor">
        ${shortDate(t.value_date)}
      </span>
    </td>
    <td class="cell-desc">
      <div class="desc-text">
        <span>${esc(t.description)}</span>
        ${t.is_manual ? '<span class="tag-manual">manual</span>' : ""}
      </div>
    </td>
    <td class="cell-note">
      <div class="note-view" data-action="edit-note" title="Clica para adicionar nota">
        ${t.note
          ? `<span class="note-filled">📝 ${esc(t.note)}</span>`
          : '<span class="note-empty">+ nota</span>'}
      </div>
    </td>
    <td>
      <span class="cat-badge${pending}" data-action="edit-category" title="Clica para editar">
        ${esc(categoryName(t.category_id))}
      </span>
    </td>
    <td class="cell-amount ${amountColor}">${fmt(t.amount)}</td>
    <td class="cell-actions">
      <div class="row-actions">
        <button class="btn-check${t.is_validated ? " on" : ""}" data-action="toggle-validated"
          title="${t.is_validated ? "Marcar como não tratado" : "Marcar como tratado"}">✓</button>
        <button class="btn-del" data-action="delete" title="Arquivar movimento">✕</button>
      </div>
    </td>
  </tr>`;
}

/**
 * Linha de um movimento arquivado.
 *
 * Sem data-action nos campos: um movimento arquivado não se edita.
 * A única acção é tirá-lo do arquivo — depois disso volta a ser uma
 * linha normal e edita-se como as outras.
 */
function rowArquivadaHTML(t) {
  const amountColor = t.amount >= 0 ? "green" : "red";

  return `
  <tr data-id="${t.id}" class="arquivada">
    <td class="cell-date">${shortDate(t.movement_date)}</td>
    <td class="cell-valuedate">${shortDate(t.value_date)}</td>
    <td class="cell-desc">
      <div class="desc-text">
        <span>${esc(t.description)}</span>
        <span class="tag-arquivado">arquivado</span>
      </div>
    </td>
    <td class="cell-note">
      ${t.note ? `<span class="note-filled">\u{1F4DD} ${esc(t.note)}</span>` : ""}
    </td>
    <td><span class="cat-badge">${esc(categoryName(t.category_id))}</span></td>
    <td class="cell-amount ${amountColor}">${fmt(t.amount)}</td>
    <td class="cell-actions">
      <div class="row-actions">
        <button class="btn-restore" data-action="restore"
          title="Retirar do arquivo">\u21A9</button>
      </div>
    </td>
  </tr>`;
}

function footHTML(totals) {
  const balanceClass = totals.balance >= 0 ? "green" : "red";
  return `
  <tr>
    <td colspan="4" class="foot-label">Totais do mês</td>
    <td></td>
    <td class="foot-value green">${fmt(totals.income)}<div class="muted">receitas</div></td>
    <td></td>
  </tr>
  <tr>
    <td colspan="4"></td>
    <td></td>
    <td class="foot-value red">${fmt(totals.expense)}<div class="muted">despesas</div></td>
    <td></td>
  </tr>
  <tr>
    <td colspan="4"></td>
    <td></td>
    <td class="foot-value gold">${fmt(totals.saving)}<div class="muted">poupança</div></td>
    <td></td>
  </tr>
  <tr class="foot-balance">
    <td colspan="4" class="foot-label">Saldo do mês</td>
    <td></td>
    <td class="foot-value ${balanceClass}">${fmt(totals.balance)}</td>
    <td></td>
  </tr>`;
}

// ═══ Eventos da tabela (delegação) ═══

function bindRowEvents() {
  const body = document.getElementById("table-body");
  body.onclick = async (e) => {
    const target = e.target.closest("[data-action]");
    if (!target) return;
    const row = target.closest("tr");
    const id = row.dataset.id;
    const t = findTransaction(id);
    if (!t) return;

    switch (target.dataset.action) {
      case "edit-date": editDate(target, t); break;
      case "edit-note": editNote(target, t); break;
      case "edit-category": editCategory(target, t); break;
      case "toggle-validated": await toggleValidated(row, target, t); break;
      case "delete": await deleteTransaction(t); break;
      case "restore": await restoreTransaction(t, target); break;
    }
  };
}

function editDate(span, t) {
  const input = document.createElement("input");
  input.type = "date";
  input.className = "inline";
  input.value = t.value_date;
  span.replaceWith(input);
  input.focus();

  let done = false;
  const save = async () => {
    if (done) return;
    done = true;
    const newDate = input.value;
    if (!newDate || newDate === t.value_date) return renderTransactions();
    try {
      await db.updateTransaction(t.id, { value_date: newDate });
      updateLocal(t.id, { value_date: newDate });
      toast("Data de valor atualizada.", "ok");
      document.dispatchEvent(new CustomEvent("data-changed"));
    } catch (err) {
      toast("Erro ao gravar a data.", "err");
      renderTransactions();
    }
  };

  input.onblur = save;
  input.onkeydown = e => {
    if (e.key === "Enter") input.blur();
    if (e.key === "Escape") { done = true; renderTransactions(); }
  };
}

function editNote(div, t) {
  const input = document.createElement("input");
  input.type = "text";
  input.className = "inline";
  input.value = t.note || "";
  input.placeholder = "Adicionar nota…";
  div.replaceWith(input);
  input.focus();

  let done = false;
  const save = async () => {
    if (done) return;
    done = true;
    const note = input.value.trim();
    if (note === (t.note || "")) return renderTransactions();
    try {
      await db.updateTransaction(t.id, { note });
      updateLocal(t.id, { note });
      renderTransactions();
    } catch (err) {
      console.error("Erro ao gravar a nota:", err);
      toast("Erro ao gravar a nota.", "err");
      renderTransactions();
    }
  };

  input.onblur = save;
  input.onkeydown = e => {
    if (e.key === "Enter") input.blur();
    if (e.key === "Escape") { done = true; renderTransactions(); }
  };
}

function editCategory(span, t) {
  const select = document.createElement("select");
  select.className = "inline";
  fillCategorySelect(select, t.category_id);
  span.replaceWith(select);
  select.focus();

  let done = false;
  const save = async () => {
    if (done) return;
    done = true;
    const categoryId = select.value;
    if (categoryId === t.category_id) return renderTransactions();
    try {
      await db.updateTransaction(t.id, { category_id: categoryId, is_confirmed: true });
      updateLocal(t.id, { category_id: categoryId, is_confirmed: true });
      renderTransactions();
      document.dispatchEvent(new CustomEvent("data-changed"));
      offerRule(t.description, categoryId);
    } catch (err) {
      console.error("Erro ao gravar a categoria:", err);
      toast("Erro ao gravar a categoria.", "err");
      renderTransactions();
    }
  };

  select.onchange = save;
  select.onblur = save;
  select.onkeydown = e => { if (e.key === "Escape") { done = true; renderTransactions(); } };
}

/** Depois de corrigir uma categoria, propõe guardar a regra. */
function offerRule(description, categoryId) {
  const keyword = suggestKeyword(description);
  if (!keyword || keyword.length < 3) return;

  const already = state.rules.some(r =>
    String(r.keyword).toUpperCase() === keyword.toUpperCase() && r.category_id === categoryId
  );
  if (already) return;

  toast(`Categorizar sempre "${esc(keyword)}" como ${esc(categoryName(categoryId))}?`, "", {
    label: "Criar regra",
    onClick: async () => {
      const result = await confirmModal({
        title: "Nova regra de categorização",
        text: "Nas próximas importações, movimentos com esta palavra-chave são categorizados automaticamente.",
        okLabel: "Guardar regra",
        extraHTML: `
          <label>Palavra-chave</label>
          <input type="text" data-field="keyword" value="${esc(keyword)}">
          <label>Categoria</label>
          <select data-field="categoryId">${categoryOptions(categoryId)}</select>`,
      });
      if (!result) return;
      try {
        const rule = await db.upsertRule(result.keyword, result.categoryId);
        state.rules = state.rules.filter(r => r.id !== rule.id).concat(rule);
        toast("Regra guardada.", "ok");
      } catch (err) {
        console.error("Erro ao guardar a regra:", err);
        toast(err?.message || "Não foi possível guardar a regra.", "err");
      }
    },
  });
}

function categoryOptions(selectedId) {
  return groupedCategories({ keepId: selectedId }).map(({ group, items }) =>
    `<optgroup label="${esc(`${group.emoji} ${group.name}`.trim())}">` +
    items.map(c =>
      `<option value="${c.id}"${c.id === selectedId ? " selected" : ""}>${esc(c.name)}</option>`
    ).join("") +
    `</optgroup>`
  ).join("");
}

async function toggleValidated(row, btn, t) {
  const next = !t.is_validated;
  // Feedback imediato (otimista)
  row.classList.toggle("validated", next);
  btn.classList.toggle("on", next);
  try {
    await db.updateTransaction(t.id, { is_validated: next });
    updateLocal(t.id, { is_validated: next });
  } catch (err) {
    console.error("Erro ao validar o movimento:", err);
    row.classList.toggle("validated", !next);
    btn.classList.toggle("on", !next);
    toast("Erro ao gravar. Tenta novamente.", "err");
  }
}

async function deleteTransaction(t) {
  const ok = await confirmModal({
    title: "Arquivar movimento?",
    text: `"${t.description}" — ${fmt(t.amount)}. O registo deixa de aparecer, mas o histórico é preservado.`,
    okLabel: "Arquivar",
  });
  if (!ok) return;
  try {
    await db.archiveTransaction(t.id);
    archiveLocal(t.id);
    toast("Movimento arquivado.", "ok");
    document.dispatchEvent(new CustomEvent("data-changed"));
  } catch (err) {
    console.error("Erro:", err);
    toast("Erro ao arquivar.", "err");
  }
}

/**
 * Tira um movimento do arquivo.
 *
 * Sem confirmação, ao contrário de arquivar: é a acção que desfaz, e
 * pedir confirmação para desfazer põe-se no caminho de quem já
 * percebeu que se enganou.
 */
async function restoreTransaction(t, btn) {
  if (btn) btn.disabled = true;
  try {
    await db.restoreTransaction(t.id);
    restoreLocal(t.id);
    toast("Movimento retirado do arquivo.", "ok");
    document.dispatchEvent(new CustomEvent("data-changed"));
  } catch (err) {
    console.error("Erro ao retirar do arquivo:", err);
    toast("Não foi possível retirar do arquivo.", "err");
    if (btn) btn.disabled = false;
  }
}

// ═══ Validar todos ═══

export async function validateAll() {
  const list = currentMonthTransactions().filter(t => !t.is_validated);
  if (!list.length) return toast("Todos os movimentos já estão validados.", "ok");

  const ok = await confirmModal({
    title: "Validar todos?",
    text: `${list.length} movimento(s) deste mês ficam marcados como tratados.`,
    okLabel: "Validar todos",
  });
  if (!ok) return;

  try {
    await db.validateMany(list.map(t => t.id));
    list.forEach(t => updateLocal(t.id, { is_validated: true }));
    renderTransactions();
    toast(`${list.length} movimentos validados.`, "ok");
  } catch (err) {
    console.error("Erro:", err);
    toast("Erro ao validar.", "err");
  }
}

// ═══ Formulário manual ═══

export function initManualForm() {
  const form = document.getElementById("manual-form");
  const toggleBtn = document.getElementById("btn-toggle-manual");

  refreshManualCategorySelect();
  resetManualForm();

  toggleBtn.onclick = () => {
    const isHidden = form.classList.toggle("hidden");
    toggleBtn.textContent = isHidden ? "+ Movimento manual" : "✕ Fechar";
    if (!isHidden) {
      // A data acompanha o período escolhido no topo, que pode ter
      // mudado desde a última vez que o formulário esteve aberto.
      document.getElementById("m-date").value = dataPredefinida();
      refreshManualAccountLabel();
      document.getElementById("m-description").focus();
    }
  };

  document.getElementById("m-cancel").onclick = () => {
    form.classList.add("hidden");
    toggleBtn.textContent = "+ Movimento manual";
  };

  document.querySelectorAll(".type-btn").forEach(btn => {
    btn.onclick = () => definirTipo(btn.dataset.type);
  });

  // O que classifica um movimento é o tipo da CATEGORIA, não este
  // botão — que só decide o sinal. Fazer o botão seguir a categoria
  // evita o caso incoerente de gravar numa categoria de poupança com
  // o botão em despesa. Continua a poder ser mudado a seguir, para
  // casos legítimos como um levantamento da poupança.
  const catSel = document.getElementById("m-category");
  if (catSel) {
    catSel.onchange = () => {
      const c = categoryById(catSel.value);
      if (c) definirTipo(c.kind);
    };
  }

  document.getElementById("m-save").onclick = saveManual;
}

/** Marca o tipo escolhido e acende o botão correspondente. */
function definirTipo(tipo) {
  manualType = tipo;
  document.querySelectorAll(".type-btn").forEach(b =>
    b.classList.toggle("active", b.dataset.type === tipo));
}

function resetManualForm() {
  document.getElementById("m-date").value = dataPredefinida();
  document.getElementById("m-description").value = "";
  document.getElementById("m-amount").value = "";

  // O seletor de categoria volta ao início da lista, para não
  // herdar a escolha do lançamento anterior.
  const cat = document.getElementById("m-category");
  if (cat) cat.selectedIndex = 0;
  definirTipo("expense");
}

async function saveManual() {
  const btn = document.getElementById("m-save");
  const description = document.getElementById("m-description").value.trim();
  const rawAmount = parseFloat(document.getElementById("m-amount").value);
  // Um só campo: a mesma data serve de data do movimento e data
  // valor. Num lançamento manual não há desfasamento entre as duas.
  const data = document.getElementById("m-date").value;
  const categoryId = document.getElementById("m-category").value;
  // A conta é a que está filtrada no topo — não há seletor.
  const accountId = state.accountFilter;

  if (!description || !Number.isFinite(rawAmount) || rawAmount === 0) {
    return toast("Preenche a descrição e um valor válido.", "err");
  }
  if (!data) return toast("Indica a data do movimento.", "err");
  if (!accountId) return toast("Não há nenhuma conta selecionada.", "err");

  // Poupança é saída de conta, tal como a despesa. Só a receita entra.
  const amount = manualType === "income" ? Math.abs(rawAmount) : -Math.abs(rawAmount);

  setLoading(btn, true, "A gravar…");
  try {
    const row = await db.insertTransaction({
      movement_date: data,
      value_date: data,
      description,
      note: "",
      category_id: categoryId,
      bank_account_id: accountId,
      amount: Number(amount.toFixed(2)),
      is_manual: true,
      is_validated: false,
      is_confirmed: true,
      source_hash: null,
    });
    addLocal([row]);
    resetManualForm();
    document.getElementById("manual-form").classList.add("hidden");
    document.getElementById("btn-toggle-manual").textContent = "+ Movimento manual";
    toast("Movimento adicionado.", "ok");
    document.dispatchEvent(new CustomEvent("data-changed"));
  } catch (err) {
    console.error(err);
    toast("Erro ao gravar o movimento.", "err");
  } finally {
    setLoading(btn, false);
  }
}
