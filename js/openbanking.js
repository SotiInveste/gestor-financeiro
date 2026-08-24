// ═══════════════════════════════════════════════════════════
// Ligação ao banco (open banking via Enable Banking)
//
// Módulo isolado: toda a lógica de open banking vive aqui.
//
// As Edge Functions tratam do que tem de ser feito no servidor —
// assinar o JWT e falar com o banco. Aqui mapeamos, categorizamos e
// gravamos, reutilizando o mesmo caminho da importação de Excel para
// as regras de categorização não ficarem em dois sítios.
// ═══════════════════════════════════════════════════════════

import { sb } from "./auth.js";
import * as db from "./db.js";
import { state, addLocal, existingHashes, existingEntryReferences } from "./state.js";
import { categorize } from "./import.js";
import { makeHash } from "./utils.js";
import { toast, confirmModal, setLoading } from "./ui.js";

// Guardado antes do reencaminhamento e comparado no regresso.
const STATE_KEY = "gestorfin-eb-state";

// Aviso quando faltam menos de 30 dias para o consentimento expirar.
const CONSENT_WARN_DAYS = 30;

let accounts = [];

// ═══ Arranque ═══

export async function initOpenBanking() {
  const btn = document.getElementById("btn-connect-bank");
  if (btn) btn.onclick = connectBank;

  await loadAccounts();
  await handleRedirect();
  renderBankSection();
}

async function loadAccounts() {
  try {
    accounts = await db.fetchBankAccounts();
  } catch (err) {
    console.error("Não foi possível carregar as contas ligadas:", err);
    accounts = [];
  }
}

// ═══ Ligar um banco ═══

async function connectBank() {
  const btn = document.getElementById("btn-connect-bank");
  setLoading(btn, true, "A procurar bancos…");

  try {
    const { data, error } = await sb.functions.invoke("eb-auth-start", {
      body: { action: "list", country: "PT" },
    });
    if (error || !data?.ok) throw new Error(describeError(error, data));

    const options = (data.aspsps || [])
      .map(a => a.name)
      .sort((a, b) => a.localeCompare(b, "pt"));

    if (!options.length) throw new Error("Nenhum banco disponível.");

    const choice = await confirmModal({
      title: "Ligar banco",
      text: "Escolhe o banco. Vais ser reencaminhado para autorizares o acesso.",
      okLabel: "Continuar",
      extraHTML: `<select class="select" data-field="bank">` +
        options.map(n =>
          `<option value="${escapeHtml(n)}"${n === "Activo Bank" ? " selected" : ""}>${escapeHtml(n)}</option>`
        ).join("") + `</select>`,
    });

    if (!choice || !choice.bank) return;

    setLoading(btn, true, "A preparar autorização…");

    const started = await sb.functions.invoke("eb-auth-start", {
      body: { action: "start", aspsp_name: choice.bank, aspsp_country: "PT" },
    });
    if (started.error || !started.data?.ok) {
      throw new Error(describeError(started.error, started.data));
    }
    if (!started.data.url) throw new Error("O banco não devolveu um endereço de autorização.");

    try {
      localStorage.setItem(STATE_KEY, started.data.state || "");
    } catch (e) {
      console.error("Não foi possível guardar o state da autorização:", e);
    }

    window.location.href = started.data.url;
  } catch (err) {
    console.error("Erro ao ligar o banco:", err);
    toast(err.message || "Não foi possível iniciar a ligação ao banco.", "err");
    setLoading(btn, false);
  }
}

// ═══ Regresso da autorização ═══

/**
 * O banco reencaminha para a app com ?code=…&state=…
 *
 * O magic link do Supabase também pode usar ?code=, por isso só
 * tratamos o pedido como sendo do banco quando o state corresponde
 * ao que guardámos antes de sair.
 */
async function handleRedirect() {
  const params = new URLSearchParams(window.location.search);
  const code = params.get("code");
  const returnedState = params.get("state");
  if (!code || !returnedState) return;

  let savedState = null;
  try { savedState = localStorage.getItem(STATE_KEY); } catch (e) { /* ignorado */ }
  if (!savedState || savedState !== returnedState) return;

  try { localStorage.removeItem(STATE_KEY); } catch (e) { /* ignorado */ }
  cleanUrl();

  toast("A concluir a ligação ao banco…");

  try {
    const { data, error } = await sb.functions.invoke("eb-auth-callback", {
      body: { code },
    });
    if (error || !data?.ok) throw new Error(describeError(error, data));

    await loadAccounts();
    renderBankSection();

    const novas = data.accounts?.length || 0;
    toast(`✅ Banco ligado — ${novas} conta${novas === 1 ? "" : "s"}.`, "ok");

    // O histórico completo só está disponível durante cerca de uma hora
    // após a autorização. Depois disso a maioria dos bancos limita a
    // 90 dias, por isso vale a pena sincronizar já.
    const first = accounts.find(a => !a.last_synced_at);
    if (first) {
      const go = await confirmModal({
        title: "Importar histórico agora?",
        text: "O histórico completo só está disponível durante cerca de 1 hora " +
              "após a autorização. Depois disso o banco limita a 90 dias.",
        okLabel: "Importar agora",
      });
      if (go) await syncAccount(first);
    }
  } catch (err) {
    console.error("Erro ao concluir a autorização:", err);
    toast(err.message || "Não foi possível concluir a ligação ao banco.", "err");
  }
}

/** Remove code/state do endereço sem recarregar a página. */
function cleanUrl() {
  const url = new URL(window.location.href);
  ["code", "state", "error"].forEach(p => url.searchParams.delete(p));
  window.history.replaceState({}, "", url.pathname + url.search + url.hash);
}

// ═══ Sincronização ═══

export async function syncAccount(account, btn = null) {
  if (!account) return;

  const first = !account.last_synced_at;
  setLoading(btn, true, "A sincronizar…");

  try {
    const { data, error } = await sb.functions.invoke("eb-sync", {
      body: {
        account_id: account.id,
        // A primeira recolha usa a estratégia mais longa disponível.
        strategy: first ? "longest" : null,
      },
    });
    if (error || !data?.ok) throw new Error(describeError(error, data));

    const result = await importTransactions(account, data.transactions || []);

    await loadAccounts();
    renderBankSection();
    document.dispatchEvent(new CustomEvent("data-changed"));

    if (!result.inserted) {
      toast(
        result.skipped
          ? `Nada de novo — ${result.skipped} movimentos já existiam.`
          : "O banco não devolveu movimentos novos.",
        "ok",
      );
    } else {
      toast(
        `✅ ${result.inserted} movimentos importados` +
        (result.autoCategorized ? `, ${result.autoCategorized} categorizados` : "") +
        (result.skipped ? `. ${result.skipped} já existiam` : "") + ".",
        "ok",
      );
    }

    if (data.truncado) {
      toast("Nem todos os movimentos couberam numa recolha. Sincroniza outra vez.", "err");
    }
  } catch (err) {
    console.error("Erro ao sincronizar:", err);
    toast(err.message || "Não foi possível sincronizar com o banco.", "err");

    // A gravação é feita em blocos: se falhar a meio, alguns já ficaram
    // no servidor sem estarem no estado local. Recarregar evita que a
    // tentativa seguinte tente inseri-los outra vez.
    try {
      state.transactions = await db.fetchTransactions();
      document.dispatchEvent(new CustomEvent("data-changed"));
    } catch (e) {
      console.error("Não foi possível recarregar os movimentos:", e);
    }
  } finally {
    setLoading(btn, false);
  }
}

/**
 * Mapeia, categoriza e grava os movimentos vindos do banco.
 *
 * Deduplicação em duas frentes: por entry_reference (movimentos já
 * vindos da API) e por source_hash (os mesmos movimentos já importados
 * do Excel). O hash não é infalível — a descrição da API nem sempre é
 * igual à do extrato — mas evita a maior parte das repetições.
 */
async function importTransactions(account, incoming) {
  const knownRefs = existingEntryReferences();
  const knownHashes = existingHashes();
  const seen = new Set();

  const rows = [];
  let skipped = 0;

  for (const t of incoming) {
    if (!t.value_date || !t.description) { skipped++; continue; }

    if (knownRefs.has(t.entry_reference) || seen.has(t.entry_reference)) {
      skipped++;
      continue;
    }

    const hash = makeHash(t.value_date, t.description, t.amount);
    if (knownHashes.has(hash)) { skipped++; continue; }

    seen.add(t.entry_reference);

    const { category, matched } = categorize(t.description, state.rules);

    rows.push({
      movement_date: t.movement_date || t.value_date,
      value_date: t.value_date,
      description: t.description,
      note: "",
      category: category || (t.amount > 0 ? "Valores Creditados" : "Outros"),
      amount: t.amount,
      is_manual: false,
      is_validated: false,
      is_confirmed: matched,
      // O source_hash fica por preencher de propósito. Ele é
      // data|descrição|montante, sem nada que distinga dois movimentos
      // legítimos iguais no mesmo dia (dois cafés de 1,50 €), e existe
      // um índice único sobre ele. Aqui a chave é o entry_reference.
      // O hash continua a ser usado acima, mas só para filtrar.
      source_hash: null,
      entry_reference: t.entry_reference,
      bank_account_id: account.id,
    });
  }

  if (!rows.length) return { inserted: 0, skipped, autoCategorized: 0 };

  const inserted = await db.insertTransactions(rows);
  addLocal(inserted);

  return {
    inserted: inserted.length,
    skipped,
    autoCategorized: rows.filter(r => r.is_confirmed).length,
  };
}

// ═══ Interface ═══

export function renderBankSection() {
  const list = document.getElementById("bank-list");
  if (!list) return;

  if (!accounts.length) {
    list.innerHTML = `<p class="muted">Nenhum banco ligado. ` +
      `Liga o teu banco para importar movimentos automaticamente.</p>`;
    return;
  }

  list.innerHTML = "";

  accounts.forEach(acc => {
    const row = document.createElement("div");
    row.className = "bank-row";

    const info = document.createElement("div");
    info.className = "bank-info";

    const name = document.createElement("strong");
    name.textContent = acc.display_name || acc.aspsp_name || "Conta";
    info.appendChild(name);

    const meta = document.createElement("span");
    meta.className = "muted";
    meta.textContent = describeAccount(acc);
    info.appendChild(meta);

    const warning = consentWarning(acc);
    if (warning) {
      const warn = document.createElement("span");
      warn.className = "bank-warn";
      warn.textContent = warning;
      info.appendChild(warn);
    }

    const btn = document.createElement("button");
    btn.className = "btn btn-primary";
    btn.textContent = acc.last_synced_at ? "Sincronizar" : "Importar histórico";
    btn.onclick = () => syncAccount(acc, btn);

    row.appendChild(info);
    row.appendChild(btn);
    list.appendChild(row);
  });
}

function describeAccount(acc) {
  if (!acc.last_synced_at) return "Nunca sincronizado";
  const d = new Date(acc.last_synced_at);
  return `Última sincronização: ${d.toLocaleString("pt-PT", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  })}`;
}

function consentWarning(acc) {
  if (!acc.consent_expires_at) return null;

  const expires = new Date(acc.consent_expires_at);
  const days = Math.ceil((expires - Date.now()) / 86_400_000);

  if (days <= 0) return "⚠ Consentimento expirado — é preciso voltar a ligar o banco.";
  if (days <= CONSENT_WARN_DAYS) return `⚠ O consentimento expira em ${days} dia${days === 1 ? "" : "s"}.`;
  return null;
}

// ═══ Auxiliares ═══

/** Constrói uma mensagem legível a partir da resposta da Edge Function. */
function describeError(error, data) {
  if (data?.error) return data.error;
  if (data?.detail?.message) return data.detail.message;
  if (data?.step) return `Falha no passo "${data.step}".`;
  if (error?.message) return error.message;
  return "Erro desconhecido na ligação ao banco.";
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}
