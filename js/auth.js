// ═══════════════════════════════════════════════════════════
// Cliente Supabase + autenticação por magic link
//
// NOTA: o SDK é carregado como <script> direto no index.html.
// Não o carregar dinamicamente — provoca race conditions em
// que o listener onAuthStateChange nunca resolve.
// ═══════════════════════════════════════════════════════════

import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

if (!window.supabase) {
  throw new Error("SDK do Supabase não carregou. Verifica o <script> no index.html.");
}

export const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/** Devolve a sessão atual (ou null). */
export async function getSession() {
  const { data, error } = await sb.auth.getSession();
  if (error) {
    console.error("Erro ao obter sessão:", error);
    return null;
  }
  return data.session;
}

/** Envia o magic link para o email indicado. */
export async function sendMagicLink(email) {
  const { error } = await sb.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: window.location.href.split("#")[0] },
  });
  if (error) throw error;
}

export async function signOut() {
  await sb.auth.signOut();
  window.location.reload();
}

/** Reage a mudanças de sessão (incluindo expiração). */
export function onAuthChange(callback) {
  sb.auth.onAuthStateChange((event, session) => callback(event, session));
}
