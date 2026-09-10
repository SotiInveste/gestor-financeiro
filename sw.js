// ═══════════════════════════════════════════════════════════
// Service worker do GestorFin
//
// NÃO INTERCETA PEDIDOS — de propósito, e não por esquecimento.
//
// Não há handler de "fetch", portanto o browser vai sempre à rede
// buscar o HTML, o JS e o CSS, como faria sem service worker. Um
// service worker com cache servia a versão guardada mesmo depois de
// uma publicação nova, e a correção nunca chegava ao telemóvel.
// Este projeto já teve versões presas pela cache do GitHub Pages;
// uma segunda camada de cache, mais teimosa, seria pior.
//
// Também não faz falta: a app vive de dados do Supabase, e dados
// financeiros desactualizados não servem para nada offline.
//
// Existe para duas coisas:
//   · a app ser instalável no Android
//   · receber notificações push, na Fase 3
//
// Antes de acrescentar um handler de fetch, ler a secção PWA do
// CLAUDE_1.md.
// ═══════════════════════════════════════════════════════════

// Uma versão nova deste ficheiro entra logo em funções, em vez de
// esperar que todos os separadores da app sejam fechados.
self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});
