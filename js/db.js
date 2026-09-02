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

/**
 * Grava movimentos vindos do banco, ignorando os que já existem.
 *
 * A deduplicação é feita pela base de dados, no índice único
 * (bank_account_id, entry_reference), e não por um filtro do lado
 * do cliente: o estado local não vê movimentos apagados, mas o
 * índice continua a contá-los. Ver a migração 007.
 *
 * Devolve apenas as linhas efetivamente inseridas.
 */
export async function upsertBankTransactions(rows) {
  const withUser = rows.map(r => ({ ...r, user_id: currentUserId }));
  const inserted = [];

  for (const block of chunk(withUser, 200)) {
    const { data, error } = await sb
      .from("fin_transactions")
      .upsert(block, {
        onConflict: "bank_account_id,entry_reference",
        ignoreDuplicates: true,
      })
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

/**
 * Movimentos arquivados.
 *
 * Consulta à parte, e só quando pedida: são o histórico morto, e
 * carregá-los no arranque com os outros seria pagar por dados que
 * quase nunca se olham.
 */
export async function fetchArchivedTransactions() {
  const { data, error } = await sb
    .from("fin_transactions")
    .select("*")
    .not("deleted_at", "is", null)
    .order("value_date", { ascending: false });
  if (error) throw error;
  return data || [];
}

/** Desfaz o arquivo — o movimento volta a contar para os totais. */
export async function restoreTransaction(id) {
  const { error } = await sb
    .from("fin_transactions")
    .update({ deleted_at: null })
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

/**
 * Cria ou atualiza uma regra (a keyword é única por utilizador).
 *
 * A keyword é normalizada aqui para maiúsculas; o índice único é
 * sobre as colunas simples (user_id, keyword), não sobre upper() —
 * ver a migração 002.
 */
export async function upsertRule(keyword, categoryId) {
  const clean = keyword.trim().toUpperCase();
  const { data, error } = await sb
    .from("fin_rules")
    .upsert(
      { user_id: currentUserId, keyword: clean, category_id: categoryId },
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

// ─── Categorias ───

/** Grupos e categorias, carregados juntos no arranque. */
export async function fetchCategoryGroups() {
  const { data, error } = await sb
    .from("fin_category_groups")
    .select("*")
    .order("sort_order");
  if (error) throw error;
  return data || [];
}

export async function fetchCategories() {
  const { data, error } = await sb
    .from("fin_categories")
    .select("*")
    .order("sort_order");
  if (error) throw error;
  return data || [];
}

/** Cria uma categoria. O código é atribuído como max(code) + 1. */
export async function insertCategory({ groupId, name, kind = "expense" }) {
  const { data: maxes, error: errMax } = await sb
    .from("fin_categories")
    .select("code, sort_order, group_id")
    .order("code", { ascending: false });
  if (errMax) throw errMax;

  const nextCode = (Number(maxes?.[0]?.code) || 99) + 1;
  const noGrupo = (maxes || []).filter(c => c.group_id === groupId);
  const nextOrder = Math.max(0, ...noGrupo.map(c => Number(c.sort_order) || 0)) + 1;

  const { data, error } = await sb
    .from("fin_categories")
    .insert({
      user_id: currentUserId,
      group_id: groupId,
      name: name.trim(),
      kind,
      code: nextCode,
      sort_order: nextOrder,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateCategory(id, patch) {
  const { data, error } = await sb
    .from("fin_categories")
    .update(patch)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

/**
 * Apagar só é permitido se nada apontar para a categoria.
 * Devolve as contagens para a interface poder oferecer arquivar.
 */
export async function categoryUsage(id) {
  const [mov, reg] = await Promise.all([
    sb.from("fin_transactions").select("id", { count: "exact", head: true })
      .eq("category_id", id).is("deleted_at", null),
    sb.from("fin_rules").select("id", { count: "exact", head: true })
      .eq("category_id", id),
  ]);
  if (mov.error) throw mov.error;
  if (reg.error) throw reg.error;
  return { movimentos: mov.count || 0, regras: reg.count || 0 };
}

export async function deleteCategory(id) {
  const { error } = await sb.from("fin_categories").delete().eq("id", id);
  if (error) throw error;
}

/**
 * Persiste a ordem de várias categorias.
 *
 * Updates individuais em vez de um upsert: o upsert do PostgREST
 * envia a linha inteira e falharia nas colunas obrigatórias que
 * aqui não são enviadas.
 */
export async function updateCategoryOrder(items) {
  await Promise.all(items.map(({ id, sort_order }) =>
    sb.from("fin_categories").update({ sort_order }).eq("id", id)
      .then(({ error }) => { if (error) throw error; })
  ));
}

/** Quantas categorias tem um grupo (inclui arquivadas). */
export async function groupUsage(id) {
  const { count, error } = await sb
    .from("fin_categories")
    .select("id", { count: "exact", head: true })
    .eq("group_id", id);
  if (error) throw error;
  return count || 0;
}

/** Cria um grupo. O código é atribuído como max(code) + 1. */
export async function insertGroup({ name, emoji = "" }) {
  const { data: existentes, error: errMax } = await sb
    .from("fin_category_groups")
    .select("code, sort_order")
    .order("code", { ascending: false });
  if (errMax) throw errMax;

  const nextCode = (Number(existentes?.[0]?.code) || 10) + 1;
  const nextOrder = Math.max(0, ...(existentes || []).map(g => Number(g.sort_order) || 0)) + 1;

  const { data, error } = await sb
    .from("fin_category_groups")
    .insert({
      user_id: currentUserId,
      name: name.trim(),
      emoji: emoji.trim(),
      code: nextCode,
      sort_order: nextOrder,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateGroup(id, patch) {
  const { data, error } = await sb
    .from("fin_category_groups")
    .update(patch)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

/** Persiste a ordem dos grupos. Mesmo motivo do updateCategoryOrder. */
export async function updateGroupOrder(items) {
  await Promise.all(items.map(({ id, sort_order }) =>
    sb.from("fin_category_groups").update({ sort_order }).eq("id", id)
      .then(({ error }) => { if (error) throw error; })
  ));
}

export async function deleteGroup(id) {
  const { error } = await sb.from("fin_category_groups").delete().eq("id", id);
  if (error) throw error;
}

// ─── Contas bancárias ligadas (open banking) ───

/** Cria uma conta manual — sem open banking por trás. */
export async function insertManualAccount(name) {
  const { data, error } = await sb
    .from("fin_bank_accounts")
    .insert({
      user_id: currentUserId,
      kind: "manual",
      display_name: name.trim(),
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateAccount(id, patch) {
  const { data, error } = await sb
    .from("fin_bank_accounts")
    .update(patch)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

/** Soft delete, como em todo o resto da app. */
export async function archiveAccount(id) {
  const { error } = await sb
    .from("fin_bank_accounts")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

/** Carrega as contas ligadas que não foram desligadas. */
export async function fetchBankAccounts() {
  const { data, error } = await sb
    .from("fin_bank_accounts")
    .select("*")
    .is("deleted_at", null)
    .order("created_at");
  if (error) throw error;
  return data || [];
}
