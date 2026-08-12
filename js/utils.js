// ═══════════════════════════════════════════════════════════
// Utilitários
// ═══════════════════════════════════════════════════════════

export const MONTHS = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

export const MONTHS_SHORT = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun",
  "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

export const CHART_COLORS = [
  "#2563eb", "#16a34a", "#dc2626", "#d97706", "#7c3aed", "#0891b2", "#be185d",
  "#065f46", "#92400e", "#1e40af", "#166534", "#991b1b", "#78350f", "#5b21b6",
  "#0e7490", "#9d174d", "#064e3b", "#a16207", "#312e81", "#134e4a",
];

/** Formata em euros (pt-PT). */
export function fmt(n) {
  return new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR" })
    .format(Number(n) || 0);
}

/** Data de hoje em YYYY-MM-DD. */
export function today() {
  return toISODate(new Date());
}

/** Converte Date → YYYY-MM-DD sem desvios de fuso horário. */
export function toISODate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Normaliza qualquer valor de data vindo do Excel para YYYY-MM-DD.
 * Trata objetos Date, números de série do Excel e strings.
 */
export function parseExcelDate(value) {
  if (!value) return null;

  if (value instanceof Date || (typeof value === "object" && value.getFullYear)) {
    return toISODate(value);
  }

  if (typeof value === "number") {
    const js = new Date(Math.round((value - 25569) * 86400 * 1000));
    const y = js.getUTCFullYear();
    const m = String(js.getUTCMonth() + 1).padStart(2, "0");
    const d = String(js.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  const str = String(value).trim();
  // DD-MM-YYYY ou DD/MM/YYYY
  const m = str.match(/^(\d{2})[-/](\d{2})[-/](\d{4})/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  // Já em ISO
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) return str.slice(0, 10);
  return null;
}

/** Mês (0-11) de uma data YYYY-MM-DD, sem construir objetos Date. */
export function monthOf(isoDate) {
  return Number(String(isoDate).slice(5, 7)) - 1;
}

/** Ano de uma data YYYY-MM-DD. */
export function yearOf(isoDate) {
  return Number(String(isoDate).slice(0, 4));
}

/** Data em formato curto para a tabela: DD/MM. */
export function shortDate(isoDate) {
  if (!isoDate) return "—";
  const [y, m, d] = String(isoDate).split("-");
  return `${d}/${m}/${y.slice(2)}`;
}

/** Chave de deduplicação de um movimento importado. */
export function makeHash(valueDate, description, amount) {
  const clean = String(description).replace(/\s+/g, " ").trim().toUpperCase();
  return `${valueDate}|${clean}|${Number(amount).toFixed(2)}`;
}

/** Escapa HTML para inserção segura no DOM. */
export function esc(str) {
  return String(str ?? "").replace(/[&<>"']/g, c => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

/** Divide um array em blocos de tamanho n. */
export function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}
