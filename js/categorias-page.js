// ═══════════════════════════════════════════════════════════
// Página de gestão de categorias (Fase 5)
//
// Módulo isolado: nada aqui é necessário para a app funcionar.
// Se falhar, o resto continua a andar.
//
// Princípio da especificação: arquivar é a acção normal, apagar é
// a excepção. Renomear é seguro — o histórico acompanha sozinho,
// porque os movimentos apontam para o id e não para o nome.
// ═══════════════════════════════════════════════════════════

import * as db from "./db.js";
import { state } from "./state.js";
import { groupedCategories } from "./categories.js";
import { toast, confirmModal, setLoading } from "./ui.js";
import { esc } from "./utils.js";

let verArquivadas = false;
let arrastada = null;

// ═══ Arranque ═══

export function initCategoriesPage() {
  const btnNova = document.getElementById("btn-nova-categoria");
  if (btnNova) btnNova.onclick = criarCategoria;

  const chk = document.getElementById("chk-ver-arquivadas");
  if (chk) {
    chk.checked = verArquivadas;
    chk.onchange = () => { verArquivadas = chk.checked; renderCategoriesPage(); };
  }
}

/** Recarrega categorias e grupos do servidor e repinta tudo. */
async function recarregar() {
  const [categories, categoryGroups] = await Promise.all([
    db.fetchCategories(),
    db.fetchCategoryGroups(),
  ]);
  state.categories = categories;
  state.categoryGroups = categoryGroups;
  renderCategoriesPage();
  // Os rótulos da tabela e dos gráficos vêm daqui — repintar.
  document.dispatchEvent(new CustomEvent("data-changed"));
}

// ═══ Render ═══

export function renderCategoriesPage() {
  const wrap = document.getElementById("categorias-lista");
  if (!wrap) return;

  const usos = contagemPorCategoria();
  const grupos = groupedCategories({ includeArchived: verArquivadas });

  if (!grupos.length) {
    wrap.innerHTML = `<div class="card empty"><p>Sem categorias.</p></div>`;
    return;
  }

  wrap.innerHTML = "";

  grupos.forEach(({ group, items }) => {
    const bloco = document.createElement("div");
    bloco.className = "card cat-group";

    const cab = document.createElement("div");
    cab.className = "cat-group-head";
    cab.innerHTML =
      `<h3 class="card-title">${esc(`${group.emoji} ${group.name}`.trim())}</h3>` +
      `<span class="muted">${items.length} categoria${items.length === 1 ? "" : "s"}</span>`;

    // Apagar grupo só faz sentido com o grupo vazio. A verificação
    // real é feita no servidor antes de tentar.
    const btnGrupo = document.createElement("button");
    btnGrupo.className = "btn btn-ghost btn-sm";
    btnGrupo.textContent = "Apagar grupo";
    btnGrupo.onclick = () => apagarGrupo(group, btnGrupo);
    cab.appendChild(btnGrupo);

    bloco.appendChild(cab);

    const lista = document.createElement("div");
    lista.className = "cat-rows";

    items.forEach(c => lista.appendChild(linhaCategoria(c, usos.get(c.id) || 0)));

    bloco.appendChild(lista);
    wrap.appendChild(bloco);
  });
}

function linhaCategoria(c, nMovimentos) {
  const row = document.createElement("div");
  row.className = "cat-row" + (c.archived_at ? " arquivada" : "");
  row.draggable = true;
  row.dataset.id = c.id;
  row.dataset.group = c.group_id;

  const pega = document.createElement("span");
  pega.className = "cat-drag";
  pega.textContent = "⠿";
  pega.title = "Arrastar para reordenar";

  const nome = document.createElement("span");
  nome.className = "cat-nome";
  nome.textContent = c.name;

  const marcas = document.createElement("span");
  marcas.className = "cat-marcas";
  marcas.innerHTML =
    `<span class="cat-tag ${c.kind}">${c.kind === "income" ? "receita" : "despesa"}</span>` +
    (c.is_system ? `<span class="cat-tag sistema">sistema</span>` : "") +
    (c.archived_at ? `<span class="cat-tag arquivada">arquivada</span>` : "");

  const uso = document.createElement("span");
  uso.className = "muted cat-uso";
  uso.textContent = `${nMovimentos} mov.`;

  const accoes = document.createElement("span");
  accoes.className = "cat-accoes";

  const btnEditar = document.createElement("button");
  btnEditar.className = "btn btn-ghost btn-sm";
  btnEditar.textContent = "Editar";
  btnEditar.onclick = () => editarCategoria(c, btnEditar);
  accoes.appendChild(btnEditar);

  // A categoria de sistema é o destino por omissão do importador:
  // não pode ser arquivada nem apagada.
  if (!c.is_system) {
    const btnArquivar = document.createElement("button");
    btnArquivar.className = "btn btn-outline btn-sm";
    btnArquivar.textContent = c.archived_at ? "Reativar" : "Arquivar";
    btnArquivar.onclick = () => alternarArquivo(c, btnArquivar);
    accoes.appendChild(btnArquivar);

    // Apagar só aparece quando nada aponta para a categoria. Deixá-lo
    // sempre visível convidaria ao engano; a acção normal é arquivar.
    if (nMovimentos === 0) {
      const btnApagar = document.createElement("button");
      btnApagar.className = "btn btn-ghost btn-sm perigo";
      btnApagar.textContent = "Apagar";
      btnApagar.onclick = () => apagarCategoria(c, btnApagar);
      accoes.appendChild(btnApagar);
    }
  }

  row.append(pega, nome, marcas, uso, accoes);
  ligarArrasto(row);
  return row;
}

/** Contagem local — evita uma consulta por categoria. */
function contagemPorCategoria() {
  const m = new Map();
  state.transactions.forEach(t => {
    if (!t.category_id) return;
    m.set(t.category_id, (m.get(t.category_id) || 0) + 1);
  });
  return m;
}

// ═══ Acções ═══

async function criarCategoria() {
  const res = await confirmModal({
    title: "Nova categoria",
    text: "O código é atribuído automaticamente e nunca é reutilizado.",
    okLabel: "Criar",
    extraHTML:
      `<label>Nome</label>
       <input type="text" data-field="nome" placeholder="Ex: Ginásio">
       <label>Grupo</label>
       <select data-field="grupo">${opcoesGrupo()}</select>
       <label>Tipo</label>
       <select data-field="tipo">
         <option value="expense">Despesa</option>
         <option value="income">Receita</option>
       </select>`,
  });
  if (!res || !res.nome?.trim()) return;

  try {
    await db.insertCategory({
      groupId: res.grupo,
      name: res.nome.trim(),
      kind: res.tipo,
    });
    await recarregar();
    toast("Categoria criada.", "ok");
  } catch (err) {
    console.error("Erro ao criar categoria:", err);
    toast(mensagemErro(err, res.nome.trim()), "err");
  }
}

async function editarCategoria(c, btn) {
  const res = await confirmModal({
    title: "Editar categoria",
    text: "Renomear é seguro: o histórico e os gráficos acompanham sozinhos.",
    okLabel: "Guardar",
    extraHTML:
      `<label>Nome</label>
       <input type="text" data-field="nome" value="${esc(c.name)}">
       <label>Grupo</label>
       <select data-field="grupo">${opcoesGrupo(c.group_id)}</select>
       <label>Tipo</label>
       <select data-field="tipo">
         <option value="expense"${c.kind === "expense" ? " selected" : ""}>Despesa</option>
         <option value="income"${c.kind === "income" ? " selected" : ""}>Receita</option>
       </select>`,
  });
  if (!res || !res.nome?.trim()) return;

  const patch = {};
  if (res.nome.trim() !== c.name) patch.name = res.nome.trim();
  if (res.grupo !== c.group_id) patch.group_id = res.grupo;
  if (res.tipo !== c.kind) patch.kind = res.tipo;
  if (!Object.keys(patch).length) return;

  setLoading(btn, true, "A gravar…");
  try {
    await db.updateCategory(c.id, patch);
    await recarregar();
    toast("Categoria atualizada.", "ok");
  } catch (err) {
    console.error("Erro ao atualizar categoria:", err);
    toast(mensagemErro(err, res.nome.trim()), "err");
  } finally {
    setLoading(btn, false);
  }
}

async function alternarArquivo(c, btn) {
  const arquivar = !c.archived_at;

  if (arquivar) {
    const ok = await confirmModal({
      title: `Arquivar «${c.name}»?`,
      text: "Sai dos seletores, mas o histórico mantém-se intacto e continua " +
            "a aparecer nos gráficos. Podes reativar quando quiseres.",
      okLabel: "Arquivar",
    });
    if (!ok) return;
  }

  setLoading(btn, true, "…");
  try {
    await db.updateCategory(c.id, {
      archived_at: arquivar ? new Date().toISOString() : null,
    });
    await recarregar();
    toast(arquivar ? "Categoria arquivada." : "Categoria reativada.", "ok");
  } catch (err) {
    console.error("Erro ao arquivar:", err);
    toast("Não foi possível concluir.", "err");
  } finally {
    setLoading(btn, false);
  }
}

async function apagarCategoria(c, btn) {
  setLoading(btn, true, "…");

  let uso;
  try {
    // A contagem no ecrã é local e ignora regras. Antes de apagar,
    // confirmar no servidor — é a verificação que conta.
    uso = await db.categoryUsage(c.id);
  } catch (err) {
    console.error("Erro ao verificar utilização:", err);
    toast("Não foi possível verificar se a categoria está em uso.", "err");
    setLoading(btn, false);
    return;
  }

  if (uso.movimentos > 0 || uso.regras > 0) {
    setLoading(btn, false);
    const partes = [];
    if (uso.movimentos) partes.push(`${uso.movimentos} movimento${uso.movimentos === 1 ? "" : "s"}`);
    if (uso.regras) partes.push(`${uso.regras} regra${uso.regras === 1 ? "" : "s"}`);

    const arquivar = await confirmModal({
      title: "Categoria em uso",
      text: `«${c.name}» tem ${partes.join(" e ")} a apontar para ela, por isso ` +
            `não pode ser apagada. Queres arquivá-la?`,
      okLabel: "Arquivar",
    });
    if (arquivar) await alternarArquivo(c, btn);
    return;
  }

  const ok = await confirmModal({
    title: `Apagar «${c.name}»?`,
    text: "Nada aponta para esta categoria. A ação não pode ser desfeita, " +
          "e o código não volta a ser reutilizado.",
    okLabel: "Apagar",
  });
  if (!ok) { setLoading(btn, false); return; }

  try {
    await db.deleteCategory(c.id);
    await recarregar();
    toast("Categoria apagada.", "ok");
  } catch (err) {
    console.error("Erro ao apagar categoria:", err);
    toast("Não foi possível apagar a categoria.", "err");
  } finally {
    setLoading(btn, false);
  }
}

async function apagarGrupo(g, btn) {
  setLoading(btn, true, "…");
  try {
    const n = await db.groupUsage(g.id);
    if (n > 0) {
      toast(
        `«${g.name}» tem ${n} categoria${n === 1 ? "" : "s"}. ` +
        `Move-as ou apaga-as antes de apagar o grupo.`,
        "err",
      );
      return;
    }

    const ok = await confirmModal({
      title: `Apagar o grupo «${g.name}»?`,
      text: "O grupo está vazio.",
      okLabel: "Apagar",
    });
    if (!ok) return;

    await db.deleteGroup(g.id);
    await recarregar();
    toast("Grupo apagado.", "ok");
  } catch (err) {
    console.error("Erro ao apagar grupo:", err);
    toast("Não foi possível apagar o grupo.", "err");
  } finally {
    setLoading(btn, false);
  }
}

// ═══ Reordenar ═══

function ligarArrasto(row) {
  row.ondragstart = e => {
    arrastada = row;
    row.classList.add("a-arrastar");
    e.dataTransfer.effectAllowed = "move";
  };

  row.ondragend = () => {
    row.classList.remove("a-arrastar");
    arrastada = null;
  };

  row.ondragover = e => {
    if (!arrastada || arrastada === row) return;
    // Só dentro do mesmo grupo: mudar de grupo faz-se em «Editar».
    if (arrastada.dataset.group !== row.dataset.group) return;
    e.preventDefault();

    const meio = row.getBoundingClientRect().top + row.offsetHeight / 2;
    row.parentNode.insertBefore(
      arrastada,
      e.clientY < meio ? row : row.nextSibling,
    );
  };

  row.ondrop = async e => {
    e.preventDefault();
    await gravarOrdem(row.parentNode);
  };
}

async function gravarOrdem(lista) {
  const items = [...lista.querySelectorAll(".cat-row")]
    .map((el, i) => ({ id: el.dataset.id, sort_order: i + 1 }));

  // Gravar só o que mudou.
  const mudou = items.filter(({ id, sort_order }) =>
    state.categories.find(c => c.id === id)?.sort_order !== sort_order
  );
  if (!mudou.length) return;

  try {
    await db.updateCategoryOrder(mudou);
    mudou.forEach(({ id, sort_order }) => {
      const c = state.categories.find(x => x.id === id);
      if (c) c.sort_order = sort_order;
    });
    toast("Ordem guardada.", "ok");
  } catch (err) {
    console.error("Erro ao gravar a ordem:", err);
    toast("Não foi possível guardar a ordem.", "err");
    renderCategoriesPage();
  }
}

// ═══ Auxiliares ═══

function opcoesGrupo(selectedId) {
  return [...state.categoryGroups]
    .sort((a, b) => a.sort_order - b.sort_order)
    .map(g =>
      `<option value="${g.id}"${g.id === selectedId ? " selected" : ""}>` +
      `${esc(`${g.emoji} ${g.name}`.trim())}</option>`
    ).join("");
}

/** Traduz o erro do Postgres em algo legível. */
function mensagemErro(err, nome) {
  if (err?.code === "23505") {
    return `Já existe uma categoria chamada «${nome}».`;
  }
  return err?.message || "Não foi possível gravar.";
}
