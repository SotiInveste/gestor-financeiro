// ═══════════════════════════════════════════════════════════
// Página Prendas
//
// Uma leitura sobre os movimentos do grupo 29, do ano inteiro e de
// todas as contas. Cada movimento pode dar origem a várias prendas:
// uma compra de 90 € pode ser três prendas de 30 € para três
// pessoas. Daí o preço viver na prenda e não no movimento.
//
// Módulo isolado, com as suas próprias tabelas (migração 010). Se
// falhar, o resto da aplicação continua a andar.
// ═══════════════════════════════════════════════════════════

import * as db from "./db.js";
import { state, noPeriodo } from "./state.js";
import { fmt, esc, shortDate } from "./utils.js";
import { toast, confirmModal } from "./ui.js";

/** Código do grupo cujas categorias contam como prendas. */
const GRUPO_CODE = 29;

// Vivem aqui e não no state.js: nada fora desta página os usa, e o
// state partilhado não deve crescer com dados de uma vista só.
let recetores = [];
let prendas = [];
let carregado = false;
let erroCarregamento = null;
// Promessa em curso, para dois renders seguidos não dispararem duas
// leituras. O renderAll é chamado por vários eventos.
let aCarregar = null;

// ═══ Carregamento ═══

/**
 * Traz recetores e prendas do servidor.
 *
 * Só à primeira visita — depois disso o estado local é mantido a par
 * a cada gravação, como no resto da aplicação.
 */
async function carregar() {
  try {
    [recetores, prendas] = await Promise.all([
      db.fetchGiftRecipients(),
      db.fetchGifts(),
    ]);
    carregado = true;
    erroCarregamento = null;
  } catch (err) {
    console.error("Erro ao carregar as prendas:", err);
    // A causa mais provável na primeira utilização é a migração não
    // ter sido corrida. Dizê-lo poupa uma investigação.
    erroCarregamento = /relation|does not exist|schema cache/i.test(err?.message || "")
      ? "As tabelas das prendas ainda não existem. Corre a migração 010_prendas.sql no SQL Editor do Supabase."
      : (err?.message || "Não foi possível carregar as prendas.");
  }
}

export function initPrendasPage() {
  const btn = document.getElementById("btn-novo-recetor");
  if (btn) btn.onclick = () => criarRecetor();

  const btnGerir = document.getElementById("btn-gerir-recetores");
  if (btnGerir) btnGerir.onclick = gerirRecetores;
}

// ═══ Render ═══

export async function renderPrendasPage() {
  const wrap = document.getElementById("prendas-conteudo");
  if (!wrap) return;

  if (!carregado && !erroCarregamento) {
    wrap.innerHTML = `<div class="card empty"><p>A carregar…</p></div>`;
    aCarregar = aCarregar || carregar();
    await aCarregar;
    aCarregar = null;
  }

  if (erroCarregamento) {
    wrap.innerHTML = `<div class="card empty"><p>${esc(erroCarregamento)}</p></div>`;
    return;
  }

  const grupo = state.categoryGroups.find(g => Number(g.code) === GRUPO_CODE);
  if (!grupo) {
    wrap.innerHTML =
      `<div class="card empty"><p>Não existe nenhum grupo com o código ${GRUPO_CODE}.</p></div>`;
    console.error(
      `Prendas: não existe grupo com o código ${GRUPO_CODE}. Grupos disponíveis:`,
      state.categoryGroups.map(g => `${g.code} — ${g.name}`),
    );
    return;
  }

  // O "evento" de uma prenda é o nome da categoria do movimento.
  const eventos = new Map(
    state.categories
      .filter(c => c.group_id === grupo.id)
      .map(c => [c.id, c.name]),
  );

  // Ano inteiro, todas as contas. O noPeriodo trata do ano; o filtro
  // de conta não é aplicado de propósito — uma prenda é uma prenda,
  // tenha saído de que conta tiver.
  const movimentos = state.transactions
    .filter(t => noPeriodo(t) && eventos.has(t.category_id))
    .sort((a, b) => String(a.value_date).localeCompare(String(b.value_date)));

  const porMovimento = new Map();
  prendas.forEach(p => {
    if (!porMovimento.has(p.transaction_id)) porMovimento.set(p.transaction_id, []);
    porMovimento.get(p.transaction_id).push(p);
  });

  if (!movimentos.length) {
    wrap.innerHTML =
      `<div class="card empty"><div class="empty-icon">🎁</div>` +
      `<p>Sem movimentos de «${esc(grupo.name)}» em ${state.year}.</p></div>`;
    return;
  }

  wrap.innerHTML = tabelaHTML(movimentos, porMovimento, eventos) +
    resumoHTML(movimentos, porMovimento);
  ligarEventos(movimentos, porMovimento);
}

/**
 * Linhas de um movimento.
 *
 * Sem prendas gravadas, mostra-se uma linha virtual já preenchida
 * com a NOTA do movimento e o valor. Só passa a existir na base de
 * dados quando for editada — abrir a página não deve escrever nada.
 *
 * O título vem da nota e não da descrição: a descrição do banco diz
 * onde se comprou («COMPRA 1211 FNAC»), a nota é onde fica escrito o
 * que é a prenda. Um movimento sem nota fica com o título vazio, de
 * propósito — assim vê-se logo o que falta preencher.
 */
function linhasDe(t, porMovimento) {
  const existentes = porMovimento.get(t.id) || [];
  if (existentes.length) return existentes;
  return [{
    virtual: true,
    id: `virtual-${t.id}`,
    transaction_id: t.id,
    title: t.note || "",
    price: Math.abs(Number(t.amount)),
    recipient_id: null,
  }];
}

function nomeRecetor(id) {
  if (!id) return null;
  return recetores.find(r => r.id === id)?.name || null;
}

function opcoesRecetor(selecionado) {
  const activos = recetores.filter(r => !r.archived_at || r.id === selecionado);
  return `<option value="">— sem recetor —</option>` +
    activos.map(r =>
      `<option value="${r.id}"${r.id === selecionado ? " selected" : ""}>` +
      `${esc(r.name)}${r.archived_at ? " (arquivado)" : ""}</option>`).join("") +
    `<option value="__novo__">+ Novo recetor…</option>`;
}

function tabelaHTML(movimentos, porMovimento, eventos) {
  const linhas = movimentos.map(t => {
    const items = linhasDe(t, porMovimento);
    const totalPrendas = items.reduce((s, p) => s + Number(p.price || 0), 0);
    const valor = Math.abs(Number(t.amount));
    const resta = Number((valor - totalPrendas).toFixed(2));

    return items.map((p, i) => `
      <tr data-gift="${p.id}" data-tx="${t.id}"${p.virtual ? ' class="virtual"' : ""}>
        <td class="cell-date">${i === 0 ? shortDate(t.value_date) : ""}</td>
        <td class="cell-desc prenda-mov">
          ${i === 0 ? `
            <div class="prenda-mov-desc">${esc(t.description)}</div>
            <div class="prenda-mov-meta muted">
              ${fmt(valor)}${resta ? ` · <span class="prenda-resta">falta ${fmt(resta)}</span>` : ""}
            </div>` : ""}
        </td>
        <td><input type="text" class="inline prenda-titulo" value="${esc(p.title)}"
              placeholder="Título da prenda"></td>
        <td class="prenda-evento">${esc(eventos.get(t.category_id) || "—")}</td>
        <td><select class="inline prenda-recetor">${opcoesRecetor(p.recipient_id)}</select></td>
        <td class="cell-amount">
          <input type="number" step="0.01" min="0" class="inline prenda-preco"
            value="${Number(p.price || 0).toFixed(2)}">
        </td>
        <td class="cell-actions">
          <div class="row-actions">
            <button class="btn-split" data-accao="dividir" title="Dividir em mais uma prenda">+</button>
            ${p.virtual ? "" :
              `<button class="btn-del" data-accao="apagar" title="Apagar prenda">✕</button>`}
          </div>
        </td>
      </tr>`).join("");
  }).join("");

  return `
    <div class="card table-card">
      <div class="table-scroll">
        <table class="table prendas-table">
          <thead>
            <tr>
              <th>Data</th><th>Movimento</th><th>Título</th>
              <th>Evento</th><th>Recetor</th><th class="right">Preço</th><th></th>
            </tr>
          </thead>
          <tbody>${linhas}</tbody>
        </table>
      </div>
    </div>`;
}

/**
 * Total por recetor no ano — a pergunta "quanto gastei em cada um".
 *
 * Duas linhas cinzentas separam o que ainda não está arrumado, e são
 * coisas diferentes:
 *
 *   · «Sem recetor»  — prendas com preço mas sem destinatário
 *   · «Por atribuir» — dinheiro do movimento que ainda não virou prenda
 *
 * Com as duas, o total do resumo bate certo com o dos movimentos do
 * grupo no ano. Sem a segunda, dava menos e parecia um erro.
 */
function resumoHTML(movimentos, porMovimento) {
  const totais = new Map();
  let atribuido = 0;
  let porAtribuir = 0;

  movimentos.forEach(t => {
    let soma = 0;
    linhasDe(t, porMovimento).forEach(p => {
      const v = Number(p.price || 0);
      soma += v;
      atribuido += v;
      const chave = p.recipient_id || "";
      totais.set(chave, (totais.get(chave) || 0) + v);
    });
    porAtribuir += Math.max(0, Number((Math.abs(Number(t.amount)) - soma).toFixed(2)));
  });

  const geral = atribuido + porAtribuir;

  const linhas = [...totais.entries()]
    .map(([id, v]) => ({ nome: nomeRecetor(id) || "Sem recetor", valor: v, cinzento: !id }))
    .sort((a, b) => b.valor - a.valor);

  if (porAtribuir > 0) linhas.push({ nome: "Por atribuir", valor: porAtribuir, cinzento: true });

  return `
    <div class="card resumo-grupo">
      <div class="resumo-head">
        <h3 class="card-title">Por recetor</h3>
        <span class="muted">todas as contas · ${state.year}</span>
      </div>
      <div class="table-scroll">
        <table class="table resumo-table">
          <tbody>
            ${linhas.map(l => `
              <tr>
                <td${l.cinzento ? ' class="muted"' : ""}>${esc(l.nome)}</td>
                <td class="cell-amount">${fmt(l.valor)}</td>
              </tr>`).join("")}
          </tbody>
          <tfoot>
            <tr>
              <td class="foot-label">Total<span class="muted"> · ${state.year}</span></td>
              <td class="foot-value">${fmt(geral)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>`;
}

// ═══ Edição ═══

function ligarEventos(movimentos, porMovimento) {
  const wrap = document.getElementById("prendas-conteudo");

  wrap.querySelectorAll("tr[data-gift]").forEach(row => {
    const txId = row.dataset.tx;
    const giftId = row.dataset.gift;
    const virtual = row.classList.contains("virtual");

    const titulo = row.querySelector(".prenda-titulo");
    const preco = row.querySelector(".prenda-preco");
    const recetor = row.querySelector(".prenda-recetor");

    const valores = () => ({
      title: titulo.value.trim(),
      price: Number(preco.value) || 0,
      recipient_id: recetor.value && recetor.value !== "__novo__" ? recetor.value : null,
    });

    const gravar = async () => {
      try {
        if (virtual) {
          const nova = await db.insertGift({ transaction_id: txId, ...valores() });
          prendas.push(nova);
        } else {
          const act = await db.updateGift(giftId, valores());
          prendas = prendas.map(p => (p.id === giftId ? act : p));
        }
        await renderPrendasPage();
      } catch (err) {
        console.error("Erro ao gravar a prenda:", err);
        toast("Não foi possível gravar a prenda.", "err");
      }
    };

    titulo.onchange = gravar;
    preco.onchange = gravar;
    recetor.onchange = async () => {
      if (recetor.value === "__novo__") {
        const novo = await criarRecetor();
        // Sem recetor novo, volta ao que estava — não fica em
        // "+ Novo recetor…", que não é um valor gravável.
        recetor.value = novo ? novo.id : "";
        if (!novo) return;
      }
      await gravar();
    };

    row.querySelectorAll("[data-accao]").forEach(btn => {
      btn.onclick = async () => {
        btn.disabled = true;
        try {
          if (btn.dataset.accao === "dividir") await dividir(txId, giftId, virtual, valores());
          else await apagar(giftId);
        } finally {
          btn.disabled = false;
        }
      };
    });
  });
}

/**
 * Acrescenta mais uma prenda ao mesmo movimento.
 *
 * A nova fica com o que sobra por atribuir, que é quase sempre o que
 * se quer: dividir 90 € em duas dá 90 e 0, e escreve-se por cima o
 * primeiro valor.
 */
async function dividir(txId, giftId, virtual, valoresActuais) {
  try {
    // Uma linha virtual tem de passar a existir antes de se lhe
    // juntar uma segunda — senão a divisão perdia-a.
    if (virtual) {
      const nova = await db.insertGift({ transaction_id: txId, ...valoresActuais });
      prendas.push(nova);
    }

    const t = state.transactions.find(x => x.id === txId);
    const jaAtribuido = prendas
      .filter(p => p.transaction_id === txId)
      .reduce((s, p) => s + Number(p.price || 0), 0);
    const resta = Math.max(0, Number((Math.abs(Number(t?.amount || 0)) - jaAtribuido).toFixed(2)));

    const nova = await db.insertGift({
      transaction_id: txId,
      title: "",
      price: resta,
      recipient_id: null,
    });
    prendas.push(nova);
    await renderPrendasPage();
  } catch (err) {
    console.error("Erro ao dividir a prenda:", err);
    toast("Não foi possível dividir.", "err");
  }
}

async function apagar(giftId) {
  try {
    await db.deleteGift(giftId);
    prendas = prendas.filter(p => p.id !== giftId);
    await renderPrendasPage();
  } catch (err) {
    console.error("Erro ao apagar a prenda:", err);
    toast("Não foi possível apagar.", "err");
  }
}

// ═══ Recetores ═══

/** Devolve o recetor criado, ou null se a criação for cancelada. */
async function criarRecetor() {
  const res = await confirmModal({
    title: "Novo recetor",
    text: "A pessoa a quem a prenda se destina.",
    okLabel: "Criar",
    extraHTML: `<label>Nome</label><input type="text" data-field="nome">`,
  });
  if (!res || !res.nome?.trim()) return null;

  try {
    const novo = await db.insertGiftRecipient(res.nome.trim());
    recetores.push(novo);
    toast("Recetor criado.", "ok");
    return novo;
  } catch (err) {
    console.error("Erro ao criar o recetor:", err);
    toast(/duplicate|unique/i.test(err?.message || "")
      ? "Já existe um recetor com esse nome."
      : "Não foi possível criar o recetor.", "err");
    return null;
  }
}

/** Renomear ou arquivar, um de cada vez — a lista costuma ser curta. */
async function gerirRecetores() {
  if (!recetores.length) {
    toast("Ainda não há recetores. Cria o primeiro.", "");
    return;
  }

  const res = await confirmModal({
    title: "Gerir recetores",
    text: "Escolhe quem queres alterar.",
    okLabel: "Continuar",
    extraHTML:
      `<label>Recetor</label>
       <select data-field="id">${
         recetores.map(r =>
           `<option value="${r.id}">${esc(r.name)}${r.archived_at ? " (arquivado)" : ""}</option>`
         ).join("")
       }</select>`,
  });
  if (!res || !res.id) return;

  const r = recetores.find(x => x.id === res.id);
  if (!r) return;

  const edicao = await confirmModal({
    title: `«${r.name}»`,
    text: r.archived_at
      ? "Está arquivado. Podes mudar o nome ou reativá-lo."
      : "Muda o nome, ou arquiva para o tirar dos seletores sem perder o histórico.",
    okLabel: "Guardar",
    extraHTML:
      `<label>Nome</label>
       <input type="text" data-field="nome" value="${esc(r.name)}">
       <label>Estado</label>
       <select data-field="estado">
         <option value="activo"${r.archived_at ? "" : " selected"}>Activo</option>
         <option value="arquivado"${r.archived_at ? " selected" : ""}>Arquivado</option>
       </select>`,
  });
  if (!edicao || !edicao.nome?.trim()) return;

  try {
    const act = await db.updateGiftRecipient(r.id, {
      name: edicao.nome.trim(),
      archived_at: edicao.estado === "arquivado"
        ? (r.archived_at || new Date().toISOString())
        : null,
    });
    recetores = recetores.map(x => (x.id === act.id ? act : x));
    toast("Recetor actualizado.", "ok");
    await renderPrendasPage();
  } catch (err) {
    console.error("Erro ao actualizar o recetor:", err);
    toast(/duplicate|unique/i.test(err?.message || "")
      ? "Já existe um recetor com esse nome."
      : "Não foi possível actualizar.", "err");
  }
}
