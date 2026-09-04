// ═══════════════════════════════════════════════════════════
// Arranque, autenticação e navegação
// ═══════════════════════════════════════════════════════════

import {
  getSession, sendMagicLink, signInWithPassword, definirPassword,
  signOut, onAuthChange,
} from "./auth.js";
import * as db from "./db.js";
import {
  state, currentMonthTransactions, monthTotals, addLocal, existingHashes,
  ANUAL, PRENDAS,
} from "./state.js";
import { renderDashboard } from "./dashboard.js";
import {
  renderTransactions, initManualForm, validateAll, initTableSorting,
  initArquivadosToggle,
} from "./transactions.js";
import { exportToExcel } from "./export.js";
import { parseStatement, readFile } from "./import.js";
import { MONTHS, fmt } from "./utils.js";
import { toast, confirmModal } from "./ui.js";
import { initTheme } from "./theme.js";
import { initOpenBanking } from "./openbanking.js";
import { initContas, renderContas, construirFiltroContas } from "./contas.js";
import { initCategoriesPage, renderCategoriesPage } from "./categorias-page.js";
import { initPrendasPage, renderPrendasPage } from "./prendas.js";

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

  // As categorias têm de estar carregadas antes do primeiro render:
  // a tabela e os gráficos resolvem nomes a partir de category_id.
  const [transactions, rules, categories, categoryGroups, accounts] = await Promise.all([
    db.fetchTransactions(),
    db.fetchRules(),
    db.fetchCategories(),
    db.fetchCategoryGroups(),
    db.fetchBankAccounts(),
  ]);
  state.transactions = transactions;
  state.rules = rules;
  state.categories = categories;
  state.categoryGroups = categoryGroups;
  state.accounts = accounts;

  document.getElementById("boot").classList.add("hidden");
  document.getElementById("login-screen").classList.add("hidden");
  document.getElementById("app").classList.remove("hidden");

  // Com o filtro de conta sempre ativo, um movimento sem conta
  // atribuída não aparece em lado nenhum. Não deve acontecer depois
  // da migração 008, mas se acontecer tem de ser visível.
  const semConta = state.transactions.filter(t => !t.bank_account_id).length;
  if (semConta) {
    console.error(
      `${semConta} movimentos sem conta atribuída — não aparecem em nenhum ` +
      `filtro. Ver a migração 008_contas_manuais.sql.`,
    );
    toast(`${semConta} movimentos sem conta atribuída — ver consola.`, "err");
  }

  buildPeriodSelectors();
  initManualForm();
  initTableSorting();
  initArquivadosToggle();
  initContas();
  initCategoriesPage();
  initPrendasPage();
  renderContas();
  construirFiltroContas();
  initTheme();
  bindEvents();

  // Espera que o DOM esteja pintado antes de desenhar os gráficos —
  // evita erros de referência nula nos canvas.
  requestAnimationFrame(() => renderAll());

  // Open banking à parte: se falhar, o resto da app continua a funcionar.
  initOpenBanking().catch(err => {
    console.error("Open banking indisponível:", err);
  });
}

// ═══ Login ═══

function emailDoFormulario() {
  const msg = document.getElementById("login-msg");
  const email = document.getElementById("login-email").value.trim();

  if (!email || !email.includes("@")) {
    msg.textContent = "Indica um email válido.";
    msg.className = "login-msg err";
    return null;
  }
  return email;
}

// ─── Entrada por palavra-passe (caminho normal) ───

document.getElementById("login-btn").onclick = async () => {
  const msg = document.getElementById("login-msg");
  const email = emailDoFormulario();
  if (!email) return;

  const password = document.getElementById("login-password").value;
  if (!password) {
    msg.textContent = "Indica a palavra-passe, ou usa o link mágico.";
    msg.className = "login-msg err";
    return;
  }

  const btn = document.getElementById("login-btn");
  btn.disabled = true;
  btn.textContent = "A entrar…";

  try {
    await signInWithPassword(email, password);
    window.location.reload();
  } catch (err) {
    console.error("Erro ao entrar:", err);
    msg.textContent = /invalid/i.test(err?.message || "")
      ? "Email ou palavra-passe errados."
      : err?.message || "Não foi possível entrar.";
    msg.className = "login-msg err";
    btn.disabled = false;
    btn.textContent = "Entrar";
  }
};

// ─── Link mágico (recurso) ───

document.getElementById("login-magic").onclick = async () => {
  const msg = document.getElementById("login-msg");
  const email = emailDoFormulario();
  if (!email) return;

  const btn = document.getElementById("login-magic");
  btn.disabled = true;
  btn.textContent = "A enviar…";

  try {
    await sendMagicLink(email);
    msg.textContent = "✅ Link enviado. Verifica o teu email.";
    msg.className = "login-msg ok";
  } catch (err) {
    console.error("Erro ao enviar o magic link:", err);

    // A mensagem genérica escondia a causa. As mais comuns têm
    // resposta própria; o resto mostra o que o servidor disse.
    let texto;
    if (err?.status === 429) {
      texto = "Demasiados pedidos seguidos. O Supabase limita os envios de " +
              "email por hora — espera uns minutos e tenta outra vez.";
    } else if (/redirect/i.test(err?.message || "")) {
      texto = "Endereço de regresso não autorizado. Verifica a lista de " +
              "Redirect URLs em Authentication → URL Configuration.";
    } else {
      texto = err?.message || "Erro ao enviar o link. Tenta novamente.";
    }

    msg.textContent = texto;
    msg.className = "login-msg err";
  } finally {
    btn.disabled = false;
    btn.textContent = "Enviar link mágico";
  }
};

["login-email", "login-password"].forEach(id => {
  const el = document.getElementById(id);
  if (el) el.onkeydown = e => {
    if (e.key === "Enter") document.getElementById("login-btn").click();
  };
});

// ═══ Período ═══

function buildPeriodSelectors() {
  const monthSel = document.getElementById("select-month");
  const yearSel = document.getElementById("select-year");

  monthSel.innerHTML = MONTHS.map((m, i) =>
    `<option value="${i}"${i === state.month ? " selected" : ""}>${m}</option>`).join("") +
    `<option value="${ANUAL}"${state.month === ANUAL ? " selected" : ""}>Anual</option>` +
    `<option value="${PRENDAS}"${state.month === PRENDAS ? " selected" : ""}>Prendas</option>`;

  const years = new Set(state.transactions.map(t => Number(t.value_date.slice(0, 4))));
  years.add(new Date().getFullYear());
  years.add(state.year);
  const sorted = [...years].sort((a, b) => b - a);

  yearSel.innerHTML = sorted.map(y =>
    `<option value="${y}"${y === state.year ? " selected" : ""}>${y}</option>`).join("");
}

function shiftMonth(delta) {
  // As setas percorrem só os meses. As vistas Anual e Prendas
  // alcançam-se pelo seletor — entrar nelas por engano ao navegar
  // seria confuso.
  if (state.month === ANUAL || state.month === PRENDAS) return;

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

// Último mês escolhido antes de entrar nas Prendas, para lá voltar
// ao carregar num separador. Sem isto, sair das Prendas atirava para
// o mês actual e perdia-se o período em que se estava.
let mesAntesDasPrendas = null;

function switchPage(page) {
  // As Prendas ocupam a área toda: carregar num separador é sair
  // delas, e o seletor tem de deixar de as mostrar.
  if (state.month === PRENDAS) {
    state.month = mesAntesDasPrendas ?? new Date().getMonth();
    buildPeriodSelectors();
  }

  state.page = page;
  document.querySelectorAll(".nav-btn").forEach(b =>
    b.classList.toggle("active", b.dataset.page === page));
  document.getElementById("page-dashboard").classList.toggle("hidden", page !== "dashboard");
  document.getElementById("page-transactions").classList.toggle("hidden", page !== "transactions");
  document.getElementById("page-categorias").classList.toggle("hidden", page !== "categorias");

  // O seletor de período não se aplica à gestão de categorias.
  const periodo = document.querySelector(".period-bar");
  if (periodo) periodo.classList.toggle("hidden", page === "categorias");
  renderAll();
}

// ═══ Render global ═══

function renderAll() {
  const list = currentMonthTransactions();
  const totals = monthTotals(list);

  const prendas = state.month === PRENDAS;
  const anoInteiro = state.month === ANUAL || prendas;

  document.getElementById("period-count").textContent =
    `${list.length} movimento${list.length === 1 ? "" : "s"}` +
    (anoInteiro ? " no ano" : "");

  // Sem meses para percorrer, as setas não têm função.
  ["prev-month", "next-month"].forEach(id => {
    const b = document.getElementById(id);
    if (b) b.classList.toggle("hidden", anoInteiro);
  });

  // As Prendas substituem a página que estiver escolhida, em vez de
  // serem um separador — chega-se lá pelo seletor de período.
  document.getElementById("page-prendas").classList.toggle("hidden", !prendas);
  if (prendas) {
    ["page-dashboard", "page-transactions", "page-categorias"].forEach(id =>
      document.getElementById(id).classList.add("hidden"));
    document.querySelectorAll(".nav-btn").forEach(b => b.classList.remove("active"));
    renderPrendasPage();
  }

  const balanceEl = document.getElementById("header-balance");
  balanceEl.textContent = `Saldo: ${fmt(totals.balance)}`;
  balanceEl.className = "header-balance " + (totals.balance >= 0 ? "green" : "red");

  const pending = list.filter(t => !t.is_validated).length;
  const badge = document.getElementById("badge-pending");
  badge.textContent = pending;
  badge.classList.toggle("hidden", pending === 0);

  if (prendas) return;
  if (state.page === "dashboard") renderDashboard();
  else if (state.page === "categorias") renderCategoriesPage();
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

    // A importação entra na conta que está filtrada, tal como o
    // movimento manual. Sem isto os movimentos ficavam sem conta —
    // gravavam-se, mas o filtro de conta, que está sempre activo,
    // escondia-os. Parecia que a importação não tinha funcionado.
    if (!state.accountFilter) {
      msg.textContent = "Não há nenhuma conta selecionada para receber os movimentos.";
      msg.className = "upload-msg err";
      return;
    }

    const comConta = result.rows.map(r => ({
      ...r,
      bank_account_id: state.accountFilter,
    }));

    const inserted = await db.insertTransactions(comConta);
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

/**
 * Define ou muda a palavra-passe da conta.
 *
 * Só está disponível com sessão iniciada — é o próprio Supabase a
 * garantir isso. Depois de definida, deixa de ser preciso o link
 * mágico, e com ele o limite de envios de email.
 */
async function pedirPassword() {
  const res = await confirmModal({
    title: "Definir palavra-passe",
    text: "Com uma palavra-passe definida, entras sem depender do email. " +
          "Mínimo de 6 caracteres.",
    okLabel: "Guardar",
    extraHTML:
      `<label>Nova palavra-passe</label>
       <input type="password" data-field="pw" autocomplete="new-password">`,
  });
  if (!res || !res.pw) return;

  if (res.pw.length < 6) {
    toast("A palavra-passe tem de ter pelo menos 6 caracteres.", "err");
    return;
  }

  try {
    await definirPassword(res.pw);
    toast("Palavra-passe definida. Já podes entrar sem o link mágico.", "ok");
  } catch (err) {
    console.error("Erro ao definir a palavra-passe:", err);
    toast(err?.message || "Não foi possível definir a palavra-passe.", "err");
  }
}

// ═══ Ligações de eventos ═══

function bindEvents() {
  document.querySelectorAll(".nav-btn").forEach(btn => {
    btn.onclick = () => switchPage(btn.dataset.page);
  });

  document.getElementById("select-month").onchange = e => {
    const novo = Number(e.target.value);
    if (novo === PRENDAS && state.month !== PRENDAS) mesAntesDasPrendas = state.month;
    state.month = novo;
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

  const btnPassword = document.getElementById("btn-password");
  if (btnPassword) btnPassword.onclick = pedirPassword;

  // Eventos internos disparados pelos módulos
  document.addEventListener("data-changed", renderAll);
  document.addEventListener("period-changed", renderAll);
  document.addEventListener("theme-changed", renderAll);

  // Atalhos de teclado
  document.addEventListener("keydown", e => {
    if (e.target.matches("input, select, textarea")) return;
    if (e.key === "ArrowLeft") shiftMonth(-1);
    if (e.key === "ArrowRight") shiftMonth(1);
  });
}

boot();
