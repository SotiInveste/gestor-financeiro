// ═══════════════════════════════════════════════════════════
// Arranque, autenticação e navegação
// ═══════════════════════════════════════════════════════════

import { getSession, sendMagicLink, signOut, onAuthChange } from "./auth.js";
import * as db from "./db.js";
import { state, currentMonthTransactions, monthTotals, addLocal, existingHashes } from "./state.js";
import { renderDashboard } from "./dashboard.js";
import { renderTransactions, initManualForm, validateAll } from "./transactions.js";
import { exportToExcel } from "./export.js";
import { parseStatement, readFile } from "./import.js";
import { MONTHS, fmt } from "./utils.js";
import { toast } from "./ui.js";

// ═══ Arranque ═══

async function boot() {
  try {
    const session = await getSession();
    if (session) {
      await startApp(session);
    } else {
      showLogin();
    }
  } catch (err) {
    console.error("Erro no arranque:", err);
    showLogin("Não foi possível ligar ao servidor. Verifica a configuração em js/config.js.");
  }

  // Sessão expirada ou terminada noutro separador
  onAuthChange((event, session) => {
    if (event === "SIGNED_OUT" || (!session && state.transactions.length)) {
      toast("A sessão terminou. A recarregar…", "err");
      setTimeout(() => window.location.reload(), 1500);
    }
  });
}

function showLogin(message) {
  document.getElementById("boot").classList.add("hidden");
  document.getElementById("login-screen").classList.remove("hidden");
  if (message) {
    const el = document.getElementById("login-msg");
    el.textContent = message;
    el.className = "login-msg err";
  }
}

async function startApp(session) {
  db.setUserId(session.user.id);

  const [transactions, rules] = await Promise.all([
    db.fetchTransactions(),
    db.fetchRules(),
  ]);
  state.transactions = transactions;
  state.rules = rules;

  document.getElementById("boot").classList.add("hidden");
  document.getElementById("login-screen").classList.add("hidden");
  document.getElementById("app").classList.remove("hidden");

  buildPeriodSelectors();
  initManualForm();
  bindEvents();

  // Espera que o DOM esteja pintado antes de desenhar os gráficos —
  // evita erros de referência nula nos canvas.
  requestAnimationFrame(() => renderAll());
}

// ═══ Login ═══

document.getElementById("login-btn").onclick = async () => {
  const input = document.getElementById("login-email");
  const msg = document.getElementById("login-msg");
  const email = input.value.trim();

  if (!email || !email.includes("@")) {
    msg.textContent = "Indica um email válido.";
    msg.className = "login-msg err";
    return;
  }

  const btn = document.getElementById("login-btn");
  btn.disabled = true;
  btn.textContent = "A enviar…";

  try {
    await sendMagicLink(email);
    msg.textContent = "✅ Link enviado. Verifica o teu email.";
    msg.className = "login-msg ok";
  } catch (err) {
    console.error(err);
    msg.textContent = "Erro ao enviar o link. Tenta novamente.";
    msg.className = "login-msg err";
  } finally {
    btn.disabled = false;
    btn.textContent = "Entrar com link mágico";
  }
};

document.getElementById("login-email").onkeydown = e => {
  if (e.key === "Enter") document.getElementById("login-btn").click();
};

// ═══ Período ═══

function buildPeriodSelectors() {
  const monthSel = document.getElementById("select-month");
  const yearSel = document.getElementById("select-year");

  monthSel.innerHTML = MONTHS.map((m, i) =>
    `<option value="${i}"${i === state.month ? " selected" : ""}>${m}</option>`).join("");

  const years = new Set(state.transactions.map(t => Number(t.value_date.slice(0, 4))));
  years.add(new Date().getFullYear());
  years.add(state.year);
  const sorted = [...years].sort((a, b) => b - a);

  yearSel.innerHTML = sorted.map(y =>
    `<option value="${y}"${y === state.year ? " selected" : ""}>${y}</option>`).join("");
}

function shiftMonth(delta) {
  let m = state.month + delta;
  let y = state.year;
  if (m < 0) { m = 11; y -= 1; }
  if (m > 11) { m = 0; y += 1; }
  state.month = m;
  state.year = y;
  buildPeriodSelectors();
  renderAll();
}

// ═══ Navegação ═══

function switchPage(page) {
  state.page = page;
  document.querySelectorAll(".nav-btn").forEach(b =>
    b.classList.toggle("active", b.dataset.page === page));
  document.getElementById("page-dashboard").classList.toggle("hidden", page !== "dashboard");
  document.getElementById("page-transactions").classList.toggle("hidden", page !== "transactions");
  renderAll();
}

// ═══ Render global ═══

function renderAll() {
  const list = currentMonthTransactions();
  const totals = monthTotals(list);

  document.getElementById("period-count").textContent =
    `${list.length} movimento${list.length === 1 ? "" : "s"}`;

  const balanceEl = document.getElementById("header-balance");
  balanceEl.textContent = `Saldo: ${fmt(totals.balance)}`;
  balanceEl.className = "header-balance " + (totals.balance >= 0 ? "green" : "red");

  const pending = list.filter(t => !t.is_validated).length;
  const badge = document.getElementById("badge-pending");
  badge.textContent = pending;
  badge.classList.toggle("hidden", pending === 0);

  if (state.page === "dashboard") renderDashboard();
  else renderTransactions();
}

// ═══ Importação ═══

async function handleFile(e) {
  const file = e.target.files[0];
  if (!file) return;

  const msg = document.getElementById("upload-msg");
  msg.textContent = "A processar o ficheiro…";
  msg.className = "upload-msg";

  try {
    const buffer = await readFile(file);
    const result = parseStatement(buffer, state.rules, existingHashes());

    if (!result.rows.length) {
      msg.textContent = result.duplicates
        ? `Nada a importar — os ${result.duplicates} movimentos do ficheiro já existem.`
        : "Nenhum movimento encontrado no ficheiro.";
      msg.className = "upload-msg err";
      return;
    }

    const inserted = await db.insertTransactions(result.rows);
    addLocal(inserted);
    buildPeriodSelectors();

    // Salta para o mês do primeiro movimento importado
    const firstDate = inserted.map(t => t.value_date).sort()[0];
    if (firstDate) {
      state.year = Number(firstDate.slice(0, 4));
      state.month = Number(firstDate.slice(5, 7)) - 1;
      document.getElementById("select-month").value = state.month;
      document.getElementById("select-year").value = state.year;
    }

    const pending = inserted.length - result.autoCategorized;
    msg.innerHTML = `✅ ${inserted.length} movimentos importados — ` +
      `${result.autoCategorized} categorizados automaticamente` +
      (pending ? `, ${pending} por rever` : "") +
      (result.duplicates ? `. ${result.duplicates} duplicados ignorados` : "") + ".";
    msg.className = "upload-msg ok";

    switchPage("transactions");
  } catch (err) {
    console.error(err);
    msg.textContent = "❌ " + (err.message || "Erro ao ler o ficheiro. Confirma que é o extrato do Activo Bank.");
    msg.className = "upload-msg err";
  } finally {
    e.target.value = "";
  }
}

// ═══ Ligações de eventos ═══

function bindEvents() {
  document.querySelectorAll(".nav-btn").forEach(btn => {
    btn.onclick = () => switchPage(btn.dataset.page);
  });

  document.getElementById("select-month").onchange = e => {
    state.month = Number(e.target.value);
    renderAll();
  };
  document.getElementById("select-year").onchange = e => {
    state.year = Number(e.target.value);
    renderAll();
  };
  document.getElementById("prev-month").onclick = () => shiftMonth(-1);
  document.getElementById("next-month").onclick = () => shiftMonth(1);

  document.getElementById("file-input").onchange = handleFile;
  document.getElementById("btn-export").onclick = exportToExcel;
  document.getElementById("btn-validate-all").onclick = validateAll;
  document.getElementById("btn-logout").onclick = signOut;

  // Eventos internos disparados pelos módulos
  document.addEventListener("data-changed", renderAll);
  document.addEventListener("period-changed", renderAll);

  // Atalhos de teclado
  document.addEventListener("keydown", e => {
    if (e.target.matches("input, select, textarea")) return;
    if (e.key === "ArrowLeft") shiftMonth(-1);
    if (e.key === "ArrowRight") shiftMonth(1);
  });
}

boot();
