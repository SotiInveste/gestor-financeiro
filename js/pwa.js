// ═══════════════════════════════════════════════════════════
// Registo do service worker (PWA)
//
// Carregado à parte pelo index.html, como o theme.js: não depende do
// arranque do app.js nem do login. Se falhar, a app funciona na
// mesma — só deixa de ser instalável.
// ═══════════════════════════════════════════════════════════

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      // updateViaCache "none": o próprio sw.js é sempre pedido à rede.
      // Sem isto, a cache HTTP do GitHub Pages podia atrasar a entrada
      // de uma versão nova do service worker.
      .register("sw.js", { updateViaCache: "none" })
      .catch(err => console.error("Service worker não registado:", err));
  });
}
