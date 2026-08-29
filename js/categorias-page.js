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
import { toast, confirmModal } from "./ui.js";
import { esc } from "./utils.js";

let verArquivadas = false;
let arrastada = null;       // linha de categoria
let grupoArrastado = null;  // bloco de grupo

// ═══ Arranque ═══

export function initCategoriesPage() {
  const btnNova = document.getElementById("btn-nova-categoria");
  if (btnNova) btnNova.onclick = criarCategoria;

  const btnGrupo = document.getElementById("btn-novo-grupo");
  if (btnGrupo) btnGrupo.onclick = criarGrupo;

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
  const grupos = groupedCategories({
    includeArchived: verArquivadas,
    includeEmpty: true,
  });

  if (!grupos.length) {
    wrap.innerHTML = `<div class="card empty"><p>Sem grupos nem categorias.</p></div>`;
    return;
  }

  wrap.innerHTML = "";

  grupos.forEach(({ group, items }) => {
    const bloco = document.createElement("div");
    bloco.className = "card cat-group";
    bloco.dataset.groupId = group.id;

    const cab = document.createElement("div");
    cab.className = "cat-group-head";

    // O arrasto do grupo só arranca pela pega. Sem isso colidiria
    // com o arrasto das linhas que estão lá dentro.
    const pegaGrupo = document.createElement("span");
    pegaGrupo.className = "cat-drag grupo";
    pegaGrupo.textContent = "\u283F";
    pegaGrupo.title = "Arrastar para reordenar o grupo";
    pegaGrupo.onmousedown = () => { bloco.draggable = true; };
    pegaGrupo.onmouseup = () => { bloco.draggable = false; };
    cab.appendChild(pegaGrupo);

    const titulo = document.createElement("h3");
    titulo.className = "card-title";
    titulo.textContent = (group.emoji + " " + group.name).trim();
    cab.appendChild(titulo);

    const cont = document.createElement("span");
    cont.className = "muted";
    cont.textContent = items.length + " categoria" + (items.length === 1 ? "" : "s");
    cab.appendChild(cont);

    cab.appendChild(botaoIcone(
      "editar", "Editar grupo", b => editarGrupo(group, b)));

    // Apagar grupo só faz sentido com o grupo vazio. A verificação
    // real é feita no servidor antes de tentar.
    cab.appendChild(botaoIcone(
      "apagar", "Apagar grupo", b => apagarGrupo(group, b), "perigo"));

    bloco.appendChild(cab);
    ligarArrastoGrupo(bloco);

    const lista = document.createElement("div");
    lista.className = "cat-rows";

    items.forEach(c => lista.appendChild(linhaCategoria(c, usos.get(c.id) || 0)));

    bloco.appendChild(lista);
    wrap.appendChild(bloco);
  });
}

// ═══ Ícones ═══
//
// SVG em vez de texto: os símbolos unicode equivalentes desenham-se
// de forma diferente em cada sistema, e alguns nem existem. O traço
// segue o mesmo estilo do ícone de tema no index.html.

const SVG_ATTRS =
  'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" ' +
  'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';

const ICONES = {
  editar: `<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/>`,
  arquivar: `<rect x="3" y="4" width="18" height="4" rx="1"/>` +
            `<path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8"/><path d="M10 12h4"/>`,
  reativar: `<rect x="3" y="4" width="18" height="4" rx="1"/>` +
            `<path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8"/>` +
            `<path d="M12 17v-5"/><path d="M9.5 14.5 12 12l2.5 2.5"/>`,
  apagar: `<path d="M3 6h18"/><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/>` +
          `<path d="M6 6v14a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V6"/><path d="M10 11v6M14 11v6"/>`,
};

/**
 * Botão só com ícone.
 *
 * O title e o aria-label são obrigatórios: sem texto visível, são a
 * única forma de saber o que o botão faz.
 */
function botaoIcone(tipo, titulo, aoClicar, classe = "") {
  const b = document.createElement("button");
  b.className = ("btn-icone " + classe).trim();
  b.innerHTML = `<svg ${SVG_ATTRS}>${ICONES[tipo]}</svg>`;
  b.title = titulo;
  b.setAttribute("aria-label", titulo);
  b.onclick = () => aoClicar(b);
  return b;
}

/**
 * Estado de ocupado para botões de ícone.
 *
 * O setLoading do ui.js troca o textContent, o que aqui apagaria o
 * SVG. Basta desativar e esbater — o botão é recriado no render
 * seguinte de qualquer forma.
 */
function ocupado(btn, sim) {
  if (!btn) return;
  btn.disabled = sim;
  btn.classList.toggle("ocupado", sim);
}

function linhaCategoria(c, nMovimentos) {
  const row = document.createElement("div");
  // O tipo deixou de ter rótulo: passa a ser a cor da barra lateral,
  // a mesma convenção da coluna Valor (verde receita, vermelho despesa).
  row.className = "cat-row " + (c.kind === "income" ? "receita" : "despesa") +
    (c.archived_at ? " arquivada" : "");
  row.draggable = true;
  row.dataset.id = c.id;
  row.dataset.group = c.group_id;
  row.title = c.kind === "income" ? "Receita" : "Despesa";

  const pega = document.createElement("span");
  pega.className = "cat-drag";
  pega.textContent = "⠿";
  pega.title = "Arrastar para reordenar";

  const nome = document.createElement("span");
  nome.className = "cat-nome";
  nome.textContent = c.name;
  if (c.is_system) nome.title = "Categoria de sistema — não pode ser apagada";

  const uso = document.createElement("span");
  uso.className = "muted cat-uso";
  uso.textContent = nMovimentos;
  uso.title = `${nMovimentos} movimento${nMovimentos === 1 ? "" : "s"}`;

  const accoes = document.createElement("span");
  accoes.className = "cat-accoes";

  accoes.appendChild(
    botaoIcone("editar", "Editar", b => editarCategoria(c, b)));

  // A categoria de sistema é o destino por omissão do importador:
  // não pode ser arquivada nem apagada.
  if (!c.is_system) {
    accoes.appendChild(botaoIcone(
      c.archived_at ? "reativar" : "arquivar",
      c.archived_at ? "Reativar" : "Arquivar",
      b => alternarArquivo(c, b),
    ));

    // Apagar só aparece quando nada aponta para a categoria. Deixá-lo
    // sempre visível convidaria ao engano; a acção normal é arquivar.
    if (nMovimentos === 0) {
      accoes.appendChild(
        botaoIcone("apagar", "Apagar", b => apagarCategoria(c, b), "perigo"));
    }
  }

  row.append(pega, nome, uso, accoes);
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

  ocupado(btn, true);
  try {
    await db.updateCategory(c.id, patch);
    await recarregar();
    toast("Categoria atualizada.", "ok");
  } catch (err) {
    console.error("Erro ao atualizar categoria:", err);
    toast(mensagemErro(err, res.nome.trim()), "err");
  } finally {
    ocupado(btn, false);
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

  ocupado(btn, true);
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
    ocupado(btn, false);
  }
}

async function apagarCategoria(c, btn) {
  ocupado(btn, true);

  let uso;
  try {
    // A contagem no ecrã é local e ignora regras. Antes de apagar,
    // confirmar no servidor — é a verificação que conta.
    uso = await db.categoryUsage(c.id);
  } catch (err) {
    console.error("Erro ao verificar utilização:", err);
    toast("Não foi possível verificar se a categoria está em uso.", "err");
    ocupado(btn, false);
    return;
  }

  if (uso.movimentos > 0 || uso.regras > 0) {
    ocupado(btn, false);
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
  if (!ok) { ocupado(btn, false); return; }

  try {
    await db.deleteCategory(c.id);
    await recarregar();
    toast("Categoria apagada.", "ok");
  } catch (err) {
    console.error("Erro ao apagar categoria:", err);
    toast("Não foi possível apagar a categoria.", "err");
  } finally {
    ocupado(btn, false);
  }
}

// ═══ Seletor de emoji ═══

// Paleta curada para grupos de despesa. O campo continua editável,
// para quem quiser colar um emoji que não esteja aqui.
const EMOJIS = [
  "\u{1F4B0}", "\u{1F3E0}", "\u{1F697}", "\u{1F6D2}", "\u2764\uFE0F", "\u{1F389}",
  "\u2708\uFE0F", "\u{1F455}", "\u{1F476}", "\u{1F4F1}", "\u{1F68C}", "\u{1F3E6}",
  "\u{1F4C8}", "\u2699\uFE0F", "\u{1F527}", "\u{1F393}", "\u{1F4DA}", "\u{1F415}",
  "\u{1F431}", "\u{1F381}", "\u{1F37D}\uFE0F", "\u2615", "\u{1F37A}", "\u{1F3CB}\uFE0F",
  "\u26BD", "\u{1F3AE}", "\u{1F3AC}", "\u{1F3B5}", "\u{1F48A}", "\u{1FA7A}",
  "\u{1F9FE}", "\u{1F4A1}", "\u{1F525}", "\u{1F4A7}", "\u{1F310}", "\u{1F4BB}",
  "\u{1F3A8}", "\u{1F9F3}", "\u{1F3D6}\uFE0F", "\u{1F6B2}", "\u{1F6E0}\uFE0F", "\u{1FAB4}",
];

/** Campo de emoji: texto livre + grelha de escolha rápida. */
function campoEmoji(atual = "") {
  return (
    `<label>Emoji</label>
     <input type="text" data-field="emoji" id="campo-emoji"
            value="${esc(atual)}" maxlength="4" class="emoji-campo"
            placeholder="Escolhe abaixo ou cola aqui">
     <div class="emoji-grelha" id="emoji-grelha">` +
    EMOJIS.map(e =>
      `<button type="button" class="emoji-op${e === atual ? " ativo" : ""}" ` +
      `data-emoji="${e}" title="${e}">${e}</button>`
    ).join("") +
    `</div>`
  );
}

/**
 * Liga a grelha ao campo.
 *
 * Tem de ser chamado depois de confirmModal montar o DOM, mas antes
 * de esperar pela promessa — o modal escreve o innerHTML de forma
 * síncrona, por isso os elementos já existem quando esta corre.
 */
function ligarSeletorEmoji() {
  const grelha = document.getElementById("emoji-grelha");
  const campo = document.getElementById("campo-emoji");
  if (!grelha || !campo) return;

  grelha.onclick = e => {
    const btn = e.target.closest(".emoji-op");
    if (!btn) return;
    campo.value = btn.dataset.emoji;
    grelha.querySelectorAll(".emoji-op").forEach(b =>
      b.classList.toggle("ativo", b === btn));
  };
}

async function criarGrupo() {
  const promessa = confirmModal({
    title: "Novo grupo",
    text: "Os grupos organizam as categorias nos seletores.",
    okLabel: "Criar",
    extraHTML:
      `<label>Nome</label>
       <input type="text" data-field="nome" placeholder="Ex: Educa\u00e7\u00e3o">` +
      campoEmoji(),
  });
  ligarSeletorEmoji();
  const res = await promessa;
  if (!res || !res.nome?.trim()) return;

  try {
    await db.insertGroup({ name: res.nome.trim(), emoji: res.emoji || "" });
    await recarregar();
    toast("Grupo criado.", "ok");
  } catch (err) {
    console.error("Erro ao criar grupo:", err);
    toast(mensagemErroGrupo(err, res.nome.trim()), "err");
  }
}

async function editarGrupo(g, btn) {
  const promessa = confirmModal({
    title: "Editar grupo",
    text: "Renomear \u00e9 seguro: as categorias apontam para o id do grupo, n\u00e3o para o nome.",
    okLabel: "Guardar",
    extraHTML:
      `<label>Nome</label>
       <input type="text" data-field="nome" value="${esc(g.name)}">` +
      campoEmoji(g.emoji || ""),
  });
  ligarSeletorEmoji();
  const res = await promessa;
  if (!res || !res.nome?.trim()) return;

  const patch = {};
  if (res.nome.trim() !== g.name) patch.name = res.nome.trim();
  if ((res.emoji || "") !== (g.emoji || "")) patch.emoji = res.emoji || "";
  if (!Object.keys(patch).length) return;

  ocupado(btn, true);
  try {
    await db.updateGroup(g.id, patch);
    await recarregar();
    toast("Grupo atualizado.", "ok");
  } catch (err) {
    console.error("Erro ao atualizar grupo:", err);
    toast(mensagemErroGrupo(err, res.nome.trim()), "err");
  } finally {
    ocupado(btn, false);
  }
}

async function apagarGrupo(g, btn) {
  ocupado(btn, true);
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
    ocupado(btn, false);
  }
}

// ═══ Reordenar ═══

function ligarArrasto(row) {
  row.ondragstart = e => {
    // Sem isto o bloco do grupo tamb\u00e9m reagia ao arrasto da linha.
    e.stopPropagation();
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

    // Em grelha os vizinhos estão ao lado, não por cima; em lista
    // estão por cima. O eixo é escolhido pela largura da célula
    // face à do contentor.
    const r = row.getBoundingClientRect();
    const emColunas = r.width < row.parentNode.clientWidth - 20;
    const antes = emColunas
      ? e.clientX < r.left + r.width / 2
      : e.clientY < r.top + r.height / 2;

    row.parentNode.insertBefore(arrastada, antes ? row : row.nextSibling);
  };

  row.ondrop = async e => {
    e.preventDefault();
    await gravarOrdem(row.parentNode);
  };
}

function ligarArrastoGrupo(bloco) {
  bloco.ondragstart = e => {
    if (!bloco.draggable) return;
    e.stopPropagation();
    grupoArrastado = bloco;
    bloco.classList.add("a-arrastar");
    e.dataTransfer.effectAllowed = "move";
  };

  bloco.ondragend = () => {
    bloco.classList.remove("a-arrastar");
    bloco.draggable = false;
    grupoArrastado = null;
  };

  bloco.ondragover = e => {
    if (!grupoArrastado || grupoArrastado === bloco) return;
    e.preventDefault();

    // Mesmo critério das categorias: em grelha os vizinhos estão ao
    // lado, em coluna única estão por cima.
    const r = bloco.getBoundingClientRect();
    const emColunas = r.width < bloco.parentNode.clientWidth - 20;
    const antes = emColunas
      ? e.clientX < r.left + r.width / 2
      : e.clientY < r.top + r.height / 2;

    bloco.parentNode.insertBefore(grupoArrastado, antes ? bloco : bloco.nextSibling);
  };

  bloco.ondrop = async e => {
    if (!grupoArrastado) return;
    e.preventDefault();
    await gravarOrdemGrupos(bloco.parentNode);
  };
}

async function gravarOrdemGrupos(lista) {
  const items = [...lista.querySelectorAll(".cat-group")]
    .map((el, i) => ({ id: el.dataset.groupId, sort_order: i + 1 }));

  const mudou = items.filter(({ id, sort_order }) =>
    state.categoryGroups.find(g => g.id === id)?.sort_order !== sort_order
  );
  if (!mudou.length) return;

  try {
    await db.updateGroupOrder(mudou);
    mudou.forEach(({ id, sort_order }) => {
      const g = state.categoryGroups.find(x => x.id === id);
      if (g) g.sort_order = sort_order;
    });
    toast("Ordem dos grupos guardada.", "ok");
  } catch (err) {
    console.error("Erro ao gravar a ordem dos grupos:", err);
    toast("N\u00e3o foi poss\u00edvel guardar a ordem.", "err");
    renderCategoriesPage();
  }
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

function mensagemErroGrupo(err, nome) {
  if (err?.code === "23505") return `J\u00e1 existe um grupo chamado \u00ab${nome}\u00bb.`;
  return err?.message || "N\u00e3o foi poss\u00edvel gravar.";
}

/** Traduz o erro do Postgres em algo legível. */
function mensagemErro(err, nome) {
  if (err?.code === "23505") {
    return `Já existe uma categoria chamada «${nome}».`;
  }
  return err?.message || "Não foi possível gravar.";
}
