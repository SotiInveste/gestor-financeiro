// ═══════════════════════════════════════════════════════════
// Categorias agrupadas + regras de categorização por defeito
// ═══════════════════════════════════════════════════════════

export const CATEGORY_GROUPS = [
  { group: "💰 Receitas",         items: ["Salário", "Outras Receitas", "Valores Creditados", "Devolução Empregador 1", "Devolução Empregador 2"] },
  { group: "🏠 Habitação",        items: ["Renda Habitação", "Eletricidade", "Água", "Gás", "TV+NET+VOZ", "Casa"] },
  { group: "🚗 Carro",            items: ["Combustível", "Via Verde", "Mecânico", "Seguro Automóvel", "IUC", "Inspeção Automóvel", "Estacionamento", "Outros Carro"] },
  { group: "🛒 Alimentação",      items: ["Supermercado", "Compras Continente", "Restaurante", "Convívio"] },
  { group: "❤️ Saúde",           items: ["Consultas", "Farmácia", "Análises Clínicas", "Compras Wells", "Outros Saúde"] },
  { group: "🎉 Lazer & Cultura",  items: ["Cinema", "Espetáculos", "Museus", "Lazer", "Festas", "Cultura"] },
  { group: "✈️ Viagens",          items: ["Viagem", "Férias", "Alojamento", "Seguro Viagem"] },
  { group: "👕 Compras Pessoais", items: ["Vestuário", "Beleza", "Prendas", "Acessórios", "Desporto", "Tecnologia", "Compras Online"] },
  { group: "👶 Bebé",             items: ["Bebé"] },
  { group: "📱 Telecomunicações", items: ["Telemóvel Tiago", "O Vigilante"] },
  { group: "🚌 Transportes",      items: ["Transportes", "Levantamentos"] },
  { group: "🏦 Poupanças",        items: ["Poupança Casa", "Poupança Extra"] },
  { group: "📈 Investimentos",    items: ["Investimento", "Investimento Extra"] },
  { group: "⚙️ Momentâneas",      items: ["Momentanea Empregador 1", "Momentanea Empregador 2"] },
  { group: "🔧 Outros",           items: ["Outros", "Erro", "Devoluções"] },
];

export const INCOME_CATEGORIES = [
  "Salário", "Outras Receitas", "Valores Creditados",
  "Devolução Empregador 1", "Devolução Empregador 2",
];

export const ALL_CATEGORIES = CATEGORY_GROUPS.flatMap(g => g.items);

// Regras base — servem de arranque. As tuas próprias regras
// (tabela fin_rules) têm sempre prioridade sobre estas.
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

export function isIncome(category) {
  return INCOME_CATEGORIES.includes(category);
}

/** Preenche um <select> com as categorias agrupadas. */
export function fillCategorySelect(selectEl, selected) {
  selectEl.innerHTML = CATEGORY_GROUPS.map(({ group, items }) =>
    `<optgroup label="${group}">` +
    items.map(c => `<option value="${c}"${c === selected ? " selected" : ""}>${c}</option>`).join("") +
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
