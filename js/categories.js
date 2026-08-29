// ═══════════════════════════════════════════════════════════
// Categorias — leitura do estado + regras base
//
// As categorias deixaram de ser constantes: vivem em
// fin_categories / fin_category_groups e são carregadas para
// state.categories no arranque (ver app.js).
//
// Aqui ficam só as consultas sobre esse estado. As escritas
// estão em db.js.
// ═══════════════════════════════════════════════════════════

import { state } from "./state.js";

// Regras base — semente de arranque, não estrutura. Continuam a
// referir categorias pelo nome; o id é resolvido em categorize().
// As regras do utilizador (fin_rules) têm sempre prioridade.
export const DEFAULT_RULES = [
  ["TRANSFERENCIA - VENCIMENTO", "Salário"],
  ["RENDA", "Renda Habitação"],
  ["SU ELETRICIDADE", "Eletricidade"],
  ["CTT - CORREIOS DE PORT", "Água"],
  ["SETGAS", "Gás"],
  ["NOS ", "TV+NET+VOZ"],
  ["SUPERMERCADO", "Supermercado"],
  ["CONTINENTE", "Compras Continente"],
  ["PINGO DOCE", "Supermercado"],
  ["LIDL", "Supermercado"],
  ["ALDI", "Supermercado"],
  ["MINIPRECO", "Supermercado"],
  ["INTERMARCHE", "Supermercado"],
  ["MERCADONA", "Supermercado"],
  ["VIAVERDE", "Via Verde"],
  ["COMBUSTIVEL", "Combustível"],
  ["GALP", "Combustível"],
  ["REPSOL", "Combustível"],
  ["PRIO", "Combustível"],
  ["ASSOC SOCORROS VENTEIRA", "O Vigilante"],
  ["WELLS", "Compras Wells"],
  ["FARMACIA", "Farmácia"],
  ["FARMÁCIA", "Farmácia"],
  ["CUF", "Consultas"],
  ["RESTAURANTE", "Restaurante"],
  ["MCDONALD", "Restaurante"],
  ["BURGER KING", "Restaurante"],
  ["ZARA", "Vestuário"],
  ["STRADIVARIUS", "Vestuário"],
  ["PULL&BEAR", "Vestuário"],
  ["BERSHKA", "Vestuário"],
  ["BERTRAND", "Cultura"],
  ["FNAC", "Tecnologia"],
  ["WORTEN", "Tecnologia"],
  ["CANVA", "Tecnologia"],
  ["AMAZON", "Compras Online"],
  ["LEROY MERLIN", "Casa"],
  ["IKEA", "Casa"],
  ["IMPOSTO DO SELO", "Outros"],
  ["CUSTO DE SERVICO", "Outros"],
  ["LEVANTAMENTO", "Levantamentos"],
];

// ─── Consultas ───

export function categoryById(id) {
  if (!id) return null;
  return state.categories.find(c => c.id === id) || null;
}

export function categoryByName(name) {
  const clean = String(name || "").trim().toLowerCase();
  if (!clean) return null;
  return state.categories.find(c => c.name.trim().toLowerCase() === clean) || null;
}

export function categoryByCode(code) {
  const n = Number(code);
  if (!Number.isFinite(n)) return null;
  return state.categories.find(c => Number(c.code) === n) || null;
}

/** Nome a mostrar. Nunca devolve vazio, para a tabela não ficar com buracos. */
export function categoryName(id) {
  return categoryById(id)?.name || "—";
}

export function isIncome(id) {
  return categoryById(id)?.kind === "income";
}

export function isSaving(id) {
  return categoryById(id)?.kind === "saving";
}

/** Os três tipos, num só sítio: rótulo e classe CSS de cada um. */
export const TIPOS = {
  expense: { rotulo: "Despesa", classe: "despesa" },
  income:  { rotulo: "Receita", classe: "receita" },
  saving:  { rotulo: "Poupança", classe: "poupanca" },
};

export function rotuloTipo(kind) {
  return TIPOS[kind]?.rotulo || TIPOS.expense.rotulo;
}

export function classeTipo(kind) {
  return TIPOS[kind]?.classe || TIPOS.expense.classe;
}

/** A categoria de sistema («Outros»): destino por omissão do importador. */
export function systemCategoryId() {
  return state.categories.find(c => c.is_system)?.id || null;
}

/**
 * Categoria a usar quando nenhuma regra corresponde.
 * Entradas vão para «Valores Creditados» se existir; tudo o resto
 * cai na categoria de sistema.
 */
export function fallbackCategoryId(amount) {
  if (Number(amount) > 0) {
    const creditos = categoryByName("Valores Creditados");
    if (creditos) return creditos.id;
  }
  return systemCategoryId();
}

/** Grupos ordenados, cada um com as suas categorias ordenadas. */
export function groupedCategories(
  { includeArchived = false, keepId = null, includeEmpty = false } = {},
) {
  const grupos = [...state.categoryGroups]
    .filter(g => includeArchived || !g.archived_at)
    .sort((a, b) => a.sort_order - b.sort_order);

  return grupos.map(g => ({
    group: g,
    items: state.categories
      .filter(c => c.group_id === g.id)
      // Arquivadas saem dos seletores — exceto a que está em uso no
      // movimento a ser editado, senão desaparecia do próprio seletor.
      .filter(c => includeArchived || !c.archived_at || c.id === keepId)
      .sort((a, b) => a.sort_order - b.sort_order),
  }))
    // Grupos vazios saem dos seletores — um <optgroup> sem opcoes
    // nao serve para nada. Mas a pagina de gestao precisa de os
    // mostrar, senao um grupo acabado de criar fica invisivel e
    // nao ha como lhe mover categorias.
    .filter(g => includeEmpty || g.items.length > 0);
}

/** Preenche um <select> com as categorias agrupadas. */
export function fillCategorySelect(selectEl, selectedId) {
  if (!selectEl) return;

  selectEl.innerHTML = groupedCategories({ keepId: selectedId })
    .map(({ group, items }) =>
      `<optgroup label="${escapeAttr(`${group.emoji} ${group.name}`.trim())}">` +
      items.map(c =>
        `<option value="${c.id}"${c.id === selectedId ? " selected" : ""}>` +
        `${escapeAttr(c.name)}${c.archived_at ? " (arquivada)" : ""}</option>`
      ).join("") +
      `</optgroup>`
    ).join("");
}

/**
 * Sugere uma palavra-chave a partir da descrição do banco,
 * removendo ruído como "COMPRA *1234" ou "PAG BXVAL- 7712".
 */
export function suggestKeyword(description) {
  return String(description || "")
    .toUpperCase()
    .replace(/COMPRA|PAG\s*BXVAL-?|TRANSFERENCIA|CRED\.|DEB\.|\*+/g, " ")
    .replace(/\b\d{2,}\b/g, " ")
    .replace(/[^\wÀ-ÿ&\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 3)
    .join(" ")
    .trim();
}

function escapeAttr(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}
