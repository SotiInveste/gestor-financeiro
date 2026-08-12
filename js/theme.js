// ═══════════════════════════════════════════════════════════
// Tema claro / escuro
//
// Este módulo inicializa-se sozinho — é carregado diretamente
// pelo index.html e não depende da ordem de arranque do app.js.
// O clique é apanhado por delegação no document, por isso
// funciona mesmo que o botão seja redesenhado.
// ═══════════════════════════════════════════════════════════

const STORAGE_KEY = "gestorfin-theme";

function readStored() {
  try { return localStorage.getItem(STORAGE_KEY); } catch { return null; }
}

function store(theme) {
  try { localStorage.setItem(STORAGE_KEY, theme); } catch { /* modo privado */ }
}

export function currentTheme() {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

/** Aplica o tema e avisa quem precisa de redesenhar (gráficos). */
export function applyTheme(theme, { notify = true } = {}) {
  document.documentElement.dataset.theme = theme;

  const btn = document.getElementById("btn-theme");
  if (btn) {
    const label = theme === "dark" ? "Mudar para tema claro" : "Mudar para tema escuro";
    btn.title = label;
    btn.setAttribute("aria-label", label);
    btn.setAttribute("aria-pressed", String(theme === "dark"));
  }

  if (notify) document.dispatchEvent(new CustomEvent("theme-changed"));
}

export function toggleTheme() {
  const next = currentTheme() === "dark" ? "light" : "dark";
  store(next);
  applyTheme(next);
}

/**
 * Mantida por compatibilidade: o app.js chama-a, mas a
 * inicialização já aconteceu no carregamento deste módulo.
 */
export function initTheme() {
  applyTheme(currentTheme(), { notify: false });
}

/** Cores atuais do tema, para o Chart.js. */
export function themeColors() {
  const cs = getComputedStyle(document.documentElement);
  const read = (name, fallback) => cs.getPropertyValue(name).trim() || fallback;
  return {
    text: read("--text-soft", "#666666"),
    muted: read("--muted", "#999999"),
    grid: read("--border-soft", "#f0ede8"),
    surface: read("--surface", "#ffffff"),
  };
}

// ─── Arranque automático ───

// Delegação: apanha o clique mesmo que o botão ainda não exista
// quando este módulo corre, ou que venha a ser recriado.
document.addEventListener("click", (event) => {
  if (event.target.closest("#btn-theme")) {
    event.preventDefault();
    toggleTheme();
  }
});

// Segue a preferência do sistema enquanto não houver escolha explícita.
const media = window.matchMedia("(prefers-color-scheme: dark)");
const onSystemChange = (e) => { if (!readStored()) applyTheme(e.matches ? "dark" : "light"); };
if (media.addEventListener) media.addEventListener("change", onSystemChange);
else if (media.addListener) media.addListener(onSystemChange); // Safari antigo

// Sincroniza o estado do botão assim que o DOM estiver pronto.
function sync() { applyTheme(currentTheme(), { notify: false }); }
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", sync);
} else {
  sync();
}
