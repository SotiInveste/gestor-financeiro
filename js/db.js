// ═══════════════════════════════════════════════════════════
// Camada de acesso a dados (Supabase)
// ═══════════════════════════════════════════════════════════

import { sb } from "./auth.js";
import { chunk } from "./utils.js";

let currentUserId = null;

export function setUserId(id) { currentUserId = id; }
export function getUserId() { return currentUserId; }

// ─── Movimentos ───

/** Carrega todos os movimentos não arquivados do utilizador. */
export async function fetchTransactions() {
  const { data, error } = await sb
    .from("fin_transactions")
    .select("*")
    .is("deleted_at", null)
    .order("value_date", { ascending: false });
  if (error) throw error;
  return data || [];
}

/** Insere vários movimentos de uma vez (importação). */
export async function insertTransactions(rows) {
  const withUser = rows.map(r => ({ ...r, user_id: currentUserId }));
  const inserted = [];

  // Blocos de 200 para não exceder limites do payload
  for (const block of chunk(withUser, 200)) {
    const { data, error } = await sb
      .from("fin_transactions")
      .insert(block)
      .select();
    if (error) throw error;
    inserted.push(...(data || []));
  }
  return inserted;
}

export async function insertTransaction(row) {
  const { data, error } = await sb
    .from("fin_transactions")
    .insert({ ...row, user_id: currentUserId })
    .select()
    .single();
  if (error) throw error;
  return data;
}

/** Atualiza campos de um movimento. */
export async function updateTransaction(id, patch) {
  const { data, error } = await sb
    .from("fin_transactions")
    .update(patch)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

/** Marca vários movimentos como validados. */
export async function validateMany(ids) {
  if (!ids.length) return;
  const { error } = await sb
    .from("fin_transactions")
    .update({ is_validated: true })
    .in("id", ids);
  if (error) throw error;
}

/** Soft delete — preserva o histórico. */
export async function archiveTransaction(id) {
  const { error } = await sb
    .from("fin_transactions")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

// ─── Regras de categorização ───

export async function fetchRules() {
  const { data, error } = await sb
    .from("fin_rules")
    .select("*")
    .order("keyword");
  if (error) throw error;
  return data || [];
}

/** Cria ou atualiza uma regra (a keyword é única por utilizador). */
export async function upsertRule(keyword, category) {
  const clean = keyword.trim().toUpperCase();
  const { data, error } = await sb
    .from("fin_rules")
    .upsert(
      { user_id: currentUserId, keyword: clean, category },
      { onConflict: "user_id,keyword" }
    )
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteRule(id) {
  const { error } = await sb.from("fin_rules").delete().eq("id", id);
  if (error) throw error;
}
