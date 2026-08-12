// ═══════════════════════════════════════════════════════════
// Tema claro / escuro
//
// A preferência fica no localStorage (é só uma opção visual,
// não são dados). Se nunca foi escolhida, segue a preferência
// do sistema operativo.
// ═══════════════════════════════════════════════════════════

const STORAGE_KEY = "gestorfin-theme";

/** Aplica o tema ao documento e avisa quem precisa de redesenhar. */
export function applyTheme(theme, { notify = true } = {}) {
  document.documentElement.dataset.theme = theme;

  const btn = document.getElementById("btn-theme");
  if (btn) {
    btn.textContent = theme === "dark" ? "☀️" : "🌙";
    btn.title = theme === "dark" ? "Mudar para tema claro" : "Mudar para tema escuro";
    btn.setAttribute("aria-label", btn.title);
  }

  if (notify) document.dispatchEvent(new CustomEvent("theme-changed"));
}

export function currentTheme() {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

export function toggleTheme() {
  const next = currentTheme() === "dark" ? "light" : "dark";
  try { localStorage.setItem(STORAGE_KEY, next); } catch { /* modo privado */ }
  applyTheme(next);
}

/** Liga o botão e acompanha a preferência do sistema. */
export function initTheme() {
  // O tema já foi aplicado pelo script inline do <head> para evitar
  // o flash de ecrã branco. Aqui só sincronizamos o ícone.
  applyTheme(currentTheme(), { notify: false });

  const btn = document.getElementById("btn-theme");
  if (btn) btn.onclick = toggleTheme;

  // Se o utilizador nunca escolheu, segue o sistema em tempo real.
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  media.addEventListener("change", e => {
    let saved = null;
    try { saved = localStorage.getItem(STORAGE_KEY); } catch { /* ignorar */ }
    if (!saved) applyTheme(e.matches ? "dark" : "light");
  });
}

/** Cores atuais do tema, para o Chart.js. */
export function themeColors() {
  const cs = getComputedStyle(document.documentElement);
  const read = name => cs.getPropertyValue(name).trim();
  return {
    text: read("--text-soft"),
    muted: read("--muted"),
    grid: read("--border-soft"),
    surface: read("--surface"),
  };
}
