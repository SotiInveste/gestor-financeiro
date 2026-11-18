// ═══════════════════════════════════════════════════════════
// Botões só com ícone
//
// Partilhados pela gestão de categorias e pela de regras. Saíram do
// categorias-page.js tal como estavam quando a página ganhou a área
// das regras: duas cópias do mesmo SVG acabariam por divergir.
// ═══════════════════════════════════════════════════════════

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
  seta: `<path d="m9 6 6 6-6 6"/>`,
};

/**
 * Botão só com ícone.
 *
 * O title e o aria-label são obrigatórios: sem texto visível, são a
 * única forma de saber o que o botão faz.
 */
export function botaoIcone(tipo, titulo, aoClicar, classe = "") {
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
export function ocupado(btn, sim) {
  if (!btn) return;
  btn.disabled = sim;
  btn.classList.toggle("ocupado", sim);
}
