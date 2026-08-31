// ═══════════════════════════════════════════════════════════
// Contas — listagem e gestão
//
// Cobre os dois tipos: as ligadas por open banking (kind "bank")
// e as manuais (kind "manual"), como um cartão refeição.
//
// A conversa com o banco fica toda em openbanking.js. Este módulo
// importa de lá o botão de sincronizar, mas nunca o contrário: o
// openbanking avisa das mudanças por evento, para não haver um
// ciclo de imports entre os dois.
// ═══════════════════════════════════════════════════════════

import * as db from "./db.js";
import { state, guardarConta } from "./state.js";
import { syncAccount, connectBank } from "./openbanking.js";
import { toast, confirmModal, setLoading } from "./ui.js";
import { esc } from "./utils.js";

// Aviso quando faltam menos de 30 dias para o consentimento expirar.
const CONSENT_AVISO_DIAS = 30;

// ═══ Arranque ═══

export function initContas() {
  const btnNova = document.getElementById("btn-nova-conta");
  if (btnNova) btnNova.onclick = criarContaManual;

  const btnLigar = document.getElementById("btn-connect-bank");
  if (btnLigar) btnLigar.onclick = () => connectBank();

  // O openbanking avisa por evento em vez de importar este módulo.
  document.addEventListener("contas-changed", () => {
    recarregar().catch(err => console.error("Erro ao recarregar contas:", err));
  });
}

export async function recarregar() {
  state.accounts = await db.fetchBankAccounts();
  renderContas();
  construirFiltroContas();
  document.dispatchEvent(new CustomEvent("data-changed"));
}

// ═══ Filtro na barra de período ═══

export function construirFiltroContas() {
  const sel = document.getElementById("select-account");
  if (!sel) return;

  const contas = state.accounts;

  // Não há opção "todas": juntar contas somava saldos que devem
  // ficar separados, e sem a coluna Conta a vista seria ambígua.
  // Há sempre exatamente uma conta escolhida.
  if (!contas.some(a => a.id === state.accountFilter)) {
    state.accountFilter = contas[0]?.id || null;
    guardarConta();
  }

  // Com uma conta só, o seletor é ruído — mas o filtro continua ativo.
  const wrap = sel.parentElement;
  if (wrap) wrap.classList.toggle("hidden", contas.length < 2);

  sel.innerHTML = contas.map(a =>
    `<option value="${a.id}"${a.id === state.accountFilter ? " selected" : ""}>` +
    `${esc(nomeConta(a))}</option>`
  ).join("");

  sel.onchange = () => {
    state.accountFilter = sel.value || null;
    guardarConta();
    document.dispatchEvent(new CustomEvent("data-changed"));
  };
}

function nomeConta(a) {
  return a.display_name || a.aspsp_name || "Conta";
}

// ═══ Listagem ═══

export function renderContas() {
  const lista = document.getElementById("bank-list");
  if (!lista) return;

  if (!state.accounts.length) {
    lista.innerHTML =
      `<p class="muted">Sem contas. Liga o teu banco ou cria uma conta manual.</p>`;
    return;
  }

  const usos = contagemPorConta();
  lista.innerHTML = "";

  state.accounts.forEach(acc => {
    const row = document.createElement("div");
    row.className = "bank-row";

    const info = document.createElement("div");
    info.className = "bank-info";

    const nome = document.createElement("strong");
    nome.textContent = nomeConta(acc);
    info.appendChild(nome);

    const meta = document.createElement("span");
    meta.className = "muted";
    meta.textContent = descrever(acc, usos.get(acc.id) || 0);
    info.appendChild(meta);

    const aviso = avisoConsentimento(acc);
    if (aviso) {
      const el = document.createElement("span");
      el.className = "bank-warn";
      el.textContent = aviso;
      info.appendChild(el);
    }

    const accoes = document.createElement("span");
    accoes.className = "conta-accoes";

    if (acc.kind === "manual") {
      const btnEditar = document.createElement("button");
      btnEditar.className = "btn btn-ghost btn-sm";
      btnEditar.textContent = "Renomear";
      btnEditar.onclick = () => renomearConta(acc, btnEditar);
      accoes.appendChild(btnEditar);
    } else {
      const btnSync = document.createElement("button");
      btnSync.className = "btn btn-primary";
      btnSync.textContent = "Sincronizar";
      btnSync.onclick = () => syncAccount(acc, btnSync);
      accoes.appendChild(btnSync);
    }

    // Arquivar vale para os dois tipos, e só sem movimentos: uma conta
    // arquivada com histórico deixaria esses movimentos a apontar para
    // algo invisível.
    //
    // Nas contas de banco isto importa mais do que parece: a
    // autorização do ActivoBank devolve quatro contas, três delas sem
    // uso, e ter todas na lista convida a sincronizar a errada.
    if ((usos.get(acc.id) || 0) === 0) {
      const btnArquivar = document.createElement("button");
      btnArquivar.className = "btn btn-ghost btn-sm perigo";
      btnArquivar.textContent = "Arquivar";
      btnArquivar.onclick = () => arquivarConta(acc, btnArquivar);
      accoes.appendChild(btnArquivar);
    }

    row.append(info, accoes);
    lista.appendChild(row);
  });
}

/** Contagem local — evita uma consulta por conta. */
function contagemPorConta() {
  const m = new Map();
  state.transactions.forEach(t => {
    if (!t.bank_account_id) return;
    m.set(t.bank_account_id, (m.get(t.bank_account_id) || 0) + 1);
  });
  return m;
}

function descrever(acc, nMovimentos) {
  const partes = [];

  if (acc.kind === "manual") {
    partes.push("Conta manual");
  } else if (acc.last_synced_at) {
    const d = new Date(acc.last_synced_at);
    partes.push(`Sincronizada a ${d.toLocaleString("pt-PT", {
      day: "2-digit", month: "2-digit", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    })}`);
  } else {
    partes.push("Nunca sincronizada");
  }

  partes.push(`${nMovimentos} movimento${nMovimentos === 1 ? "" : "s"}`);
  return partes.join(" · ");
}

function avisoConsentimento(acc) {
  if (acc.kind !== "bank" || !acc.consent_expires_at) return null;

  const dias = Math.ceil((new Date(acc.consent_expires_at) - Date.now()) / 86_400_000);
  if (dias <= 0) return "⚠ Consentimento expirado — é preciso voltar a ligar o banco.";
  if (dias <= CONSENT_AVISO_DIAS) return `⚠ O consentimento expira em ${dias} dia${dias === 1 ? "" : "s"}.`;
  return null;
}

// ═══ Acções ═══

async function criarContaManual() {
  const res = await confirmModal({
    title: "Nova conta manual",
    text: "Para movimentos que não vêm de um banco ligado — cartão refeição, " +
          "dinheiro, outra conta. O saldo é contado à parte.",
    okLabel: "Criar",
    extraHTML:
      `<label>Nome</label>
       <input type="text" data-field="nome" placeholder="Ex: Cartão Refeição">`,
  });
  if (!res || !res.nome?.trim()) return;

  try {
    await db.insertManualAccount(res.nome.trim());
    await recarregar();
    toast("Conta criada.", "ok");
  } catch (err) {
    console.error("Erro ao criar conta:", err);
    toast(err?.message || "Não foi possível criar a conta.", "err");
  }
}

async function renomearConta(acc, btn) {
  const res = await confirmModal({
    title: "Renomear conta",
    text: "Os movimentos apontam para o id da conta, por isso o histórico acompanha.",
    okLabel: "Guardar",
    extraHTML:
      `<label>Nome</label>
       <input type="text" data-field="nome" value="${esc(nomeConta(acc))}">`,
  });
  if (!res || !res.nome?.trim() || res.nome.trim() === nomeConta(acc)) return;

  setLoading(btn, true, "A gravar…");
  try {
    await db.updateAccount(acc.id, { display_name: res.nome.trim() });
    await recarregar();
    toast("Conta renomeada.", "ok");
  } catch (err) {
    console.error("Erro ao renomear conta:", err);
    toast(err?.message || "Não foi possível renomear.", "err");
  } finally {
    setLoading(btn, false);
  }
}

async function arquivarConta(acc, btn) {
  const ok = await confirmModal({
    title: `Arquivar «${nomeConta(acc)}»?`,
    text: "A conta sai das listas e dos filtros. Não tem movimentos, " +
          "por isso nada se perde.",
    okLabel: "Arquivar",
  });
  if (!ok) return;

  setLoading(btn, true, "…");
  try {
    await db.archiveAccount(acc.id);
    // Se a conta arquivada era a filtrada, o construirFiltroContas
    // escolhe a primeira que sobrar.
    if (state.accountFilter === acc.id) state.accountFilter = null;
    await recarregar();
    toast("Conta arquivada.", "ok");
  } catch (err) {
    console.error("Erro ao arquivar conta:", err);
    toast(err?.message || "Não foi possível arquivar.", "err");
  } finally {
    setLoading(btn, false);
  }
}
