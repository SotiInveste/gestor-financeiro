// ═══════════════════════════════════════════════════════════
// Componentes de interface: toasts, modais, spinners
// ═══════════════════════════════════════════════════════════

/** Mostra um toast. type: "" | "ok" | "err". */
export function toast(message, type = "", action = null) {
  const container = document.getElementById("toast-container");
  if (!container) return;

  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.innerHTML = `<span>${message}</span>`;

  if (action) {
    const btn = document.createElement("button");
    btn.textContent = action.label;
    btn.onclick = () => { el.remove(); action.onClick(); };
    el.appendChild(btn);
  }

  container.appendChild(el);
  setTimeout(() => el.remove(), action ? 8000 : 3800);
}

/**
 * Modal de confirmação baseado em promessa.
 * Resolve com true/false, ou com o valor dos campos extra.
 */
export function confirmModal({ title, text, okLabel = "Confirmar", extraHTML = "" }) {
  return new Promise(resolve => {
    const overlay = document.getElementById("modal");
    const titleEl = document.getElementById("modal-title");
    const textEl = document.getElementById("modal-text");
    const extraEl = document.getElementById("modal-extra");
    const okBtn = document.getElementById("modal-ok");
    const cancelBtn = document.getElementById("modal-cancel");

    titleEl.textContent = title;
    textEl.textContent = text || "";
    textEl.classList.toggle("hidden", !text);
    extraEl.innerHTML = extraHTML;
    okBtn.textContent = okLabel;
    overlay.classList.remove("hidden");

    const first = extraEl.querySelector("input, select");
    if (first) first.focus();

    function cleanup(result) {
      overlay.classList.add("hidden");
      okBtn.onclick = null;
      cancelBtn.onclick = null;
      overlay.onclick = null;
      document.removeEventListener("keydown", onKey);
      resolve(result);
    }

    function collect() {
      const inputs = extraEl.querySelectorAll("input, select");
      if (!inputs.length) return true;
      const data = {};
      inputs.forEach(i => { data[i.dataset.field || i.id] = i.value; });
      return data;
    }

    function onKey(e) {
      if (e.key === "Escape") cleanup(false);
      if (e.key === "Enter" && e.target.tagName !== "TEXTAREA") cleanup(collect());
    }

    okBtn.onclick = () => cleanup(collect());
    cancelBtn.onclick = () => cleanup(false);
    overlay.onclick = e => { if (e.target === overlay) cleanup(false); };
    document.addEventListener("keydown", onKey);
  });
}

/** Coloca um botão em estado de carregamento. */
export function setLoading(btn, isLoading, loadingText = "A processar…") {
  if (!btn) return;
  if (isLoading) {
    btn.dataset.original = btn.textContent;
    btn.textContent = loadingText;
    btn.disabled = true;
  } else {
    if (btn.dataset.original) btn.textContent = btn.dataset.original;
    btn.disabled = false;
  }
}
