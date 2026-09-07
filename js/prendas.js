// ═══════════════════════════════════════════════════════════
// Página Prendas
//
// Dois eixos independentes:
//
//   · ORIGEM   — a prenda vem de um movimento do grupo 29, ou é um
//                registo manual
//   · DIRECÇÃO — dada ou recebida
//
// Um movimento é sempre uma prenda DADA: representa dinheiro que
// saiu. Só os registos manuais escolhem — e é para isso que existem,
// já que uma prenda recebida não tem movimento nenhum por trás.
//
// Quem deu e quem recebeu saem da MESMA lista de pessoas: a mesma
// pessoa dá e recebe conforme a ocasião.
//
// Módulo isolado, com as suas tabelas (migrações 010 a 012). Se
// falhar, o resto da aplicação continua a andar.
// ═══════════════════════════════════════════════════════════

import * as db from "./db.js";
import { state, noPeriodo } from "./state.js";
import { fmt, esc, shortDate, today } from "./utils.js";
import { toast, confirmModal } from "./ui.js";

/** Código do grupo cujas categorias contam como prendas. */
const GRUPO_CODE = 29;

// ─── Miniaturas ───

const LADO_MAX = 320;
const QUALIDADE = 0.72;
/** Acima disto volta a comprimir com menos qualidade. ~150 KB. */
const LIMITE_CHARS = 150_000;
/** O ficheiro de origem não é gravado, mas é lido para memória. */
const LIMITE_FICHEIRO = 25 * 1024 * 1024;

// Vivem aqui e não no state.js: nada fora desta página os usa.
let pessoas = [];
let prendas = [];
let imagens = new Map();   // gift_id → data URI
let carregado = false;
let erroCarregamento = null;
let aCarregar = null;

// ═══ Carregamento ═══

async function carregar() {
  try {
    const [pes, gifts, imgs] = await Promise.all([
      db.fetchGiftRecipients(),
      db.fetchGifts(),
      db.fetchGiftImages(),
    ]);
    pessoas = pes;
    prendas = gifts;
    imagens = new Map(imgs.map(i => [i.gift_id, i.data]));
    carregado = true;
    erroCarregamento = null;
  } catch (err) {
    console.error("Erro ao carregar as prendas:", err);
    erroCarregamento = /relation|does not exist|schema cache|column/i.test(err?.message || "")
      ? "Faltam tabelas ou colunas das prendas. Corre as migrações 010, 011 e 012 no SQL Editor do Supabase."
      : (err?.message || "Não foi possível carregar as prendas.");
  }
}

export function initPrendasPage() {
  const btn = document.getElementById("btn-nova-pessoa");
  if (btn) btn.onclick = () => criarPessoa();

  const btnGerir = document.getElementById("btn-gerir-pessoas");
  if (btnGerir) btnGerir.onclick = gerirPessoas;
}

// ═══ Render ═══

const anoDe = d => String(d || "").slice(0, 4) === String(state.year);

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

  // As categorias do grupo são os "eventos" — servem tanto os
  // movimentos (pela categoria do movimento) como os manuais (por
  // escolha), para os dois lados serem comparáveis.
  const categorias = state.categories.filter(c => c.group_id === grupo.id);
  const eventos = new Map(categorias.map(c => [c.id, c.name]));

  // Ano inteiro, todas as contas. O filtro de conta não se aplica de
  // propósito — uma prenda é uma prenda, saia da conta que sair.
  const movimentos = state.transactions
    .filter(t => noPeriodo(t) && eventos.has(t.category_id))
    .sort((a, b) => String(a.value_date).localeCompare(String(b.value_date)));

  const porMovimento = new Map();
  prendas.forEach(p => {
    if (!p.transaction_id) return;
    if (!porMovimento.has(p.transaction_id)) porMovimento.set(p.transaction_id, []);
    porMovimento.get(p.transaction_id).push(p);
  });

  const manuais = dir => prendas
    .filter(p => !p.transaction_id && p.direction === dir && anoDe(p.gift_date))
    .sort((a, b) => String(a.gift_date).localeCompare(String(b.gift_date)));

  const dadas = blocosDadas(movimentos, porMovimento, manuais("given"));
  const recebidas = manuais("received").map(p => ({ data: p.gift_date, mov: null, items: [p] }));

  wrap.innerHTML =
    seccao({
      id: "dadas",
      titulo: "Prendas dadas",
      subtitulo: `movimentos e registos manuais · ${state.year}`,
      vazio: "Sem prendas dadas neste ano.",
      blocos: dadas, eventos, categorias,
    }) +
    resumoHTML("Por quem recebeu", dadas, "recipient_id", true) +
    seccao({
      id: "recebidas",
      titulo: "Prendas recebidas",
      subtitulo: `só registos manuais · ${state.year}`,
      vazio: "Sem prendas recebidas neste ano.",
      blocos: recebidas, eventos, categorias,
    }) +
    (recebidas.length ? resumoHTML("Por quem deu", recebidas, "giver_id", false) : "");

  ligarEventos(categorias);
}

/**
 * Blocos das prendas dadas: um por movimento, mais um por registo
 * manual, ordenados pela data no meio uns dos outros.
 */
function blocosDadas(movimentos, porMovimento, manuaisDadas) {
  return [
    ...movimentos.map(t => ({ data: t.value_date, mov: t, items: linhasDe(t, porMovimento) })),
    ...manuaisDadas.map(p => ({ data: p.gift_date, mov: null, items: [p] })),
  ].sort((a, b) => String(a.data).localeCompare(String(b.data)));
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
 * que é a prenda. Sem nota o título fica vazio, de propósito.
 */
function linhasDe(t, porMovimento) {
  const existentes = porMovimento.get(t.id) || [];
  if (existentes.length) return existentes;
  return [{
    virtual: true,
    id: `virtual-${t.id}`,
    transaction_id: t.id,
    direction: "given",
    title: t.note || "",
    price: Math.abs(Number(t.amount)),
    recipient_id: null,
    giver_id: null,
    is_validated: false,
  }];
}

function nomePessoa(id) {
  if (!id) return null;
  return pessoas.find(r => r.id === id)?.name || null;
}

function opcoesPessoa(selecionado, vazio) {
  const activas = pessoas.filter(r => !r.archived_at || r.id === selecionado);
  return `<option value="">${vazio}</option>` +
    activas.map(r =>
      `<option value="${r.id}"${r.id === selecionado ? " selected" : ""}>` +
      `${esc(r.name)}${r.archived_at ? " (arquivada)" : ""}</option>`).join("") +
    `<option value="__novo__">+ Nova pessoa…</option>`;
}

function opcoesEvento(categorias, selecionado) {
  return `<option value="">— sem evento —</option>` +
    categorias.map(c =>
      `<option value="${c.id}"${c.id === selecionado ? " selected" : ""}>${esc(c.name)}</option>`
    ).join("");
}

function celulaImagem(p) {
  const src = imagens.get(p.id);
  return `
    <td class="prenda-img-cel">
      <label class="prenda-img" title="${src ? "Trocar a imagem" : "Escolher uma imagem"}">
        <input type="file" accept="image/*" class="prenda-ficheiro" hidden>
        ${src
          ? `<img src="${src}" alt="" class="prenda-thumb">`
          : `<span class="prenda-img-vazia">+</span>`}
      </label>
      ${src ? `<button class="prenda-img-tirar" data-accao="tirar-imagem"
                 title="Remover a imagem">✕</button>` : ""}
    </td>`;
}

/**
 * Uma secção completa: cabeçalho, botão de registo manual e tabela.
 *
 * As duas direcções partilham as mesmas colunas. Uma dada e uma
 * recebida distinguem-se pelo sentido do par «De → Para», não por
 * campos diferentes, e uma tabela por direcção evita ter de explicar
 * numa coluna extra o que já se lê na secção.
 */
function seccao({ id, titulo, subtitulo, vazio, blocos, eventos, categorias }) {
  const cabeca = `
    <div class="resumo-head prendas-head">
      <h3 class="card-title">${esc(titulo)}</h3>
      <span class="prendas-head-dir">
        <span class="muted">${esc(subtitulo)}</span>
        <button class="btn btn-outline btn-mini" data-accao="novo-manual"
          data-dir="${id === "recebidas" ? "received" : "given"}">${
            id === "recebidas" ? "+ Prenda recebida" : "+ Prenda dada"
          }</button>
      </span>
    </div>`;

  if (!blocos.length) {
    return `<div class="card">${cabeca}<p class="muted resumo-vazio">${esc(vazio)}</p></div>`;
  }

  const linhas = blocos.map(b => {
    const valor = b.mov ? Math.abs(Number(b.mov.amount)) : 0;
    const atribuido = b.items.reduce((s, p) => s + Number(p.price || 0), 0);
    const resta = b.mov ? Number((valor - atribuido).toFixed(2)) : 0;

    return b.items.map((p, i) => linhaHTML(p, {
      primeira: i === 0, mov: b.mov, resta, eventos, categorias,
    })).join("");
  }).join("");

  return `
    <div class="card table-card prendas-card">
      <div class="prendas-card-head">${cabeca}</div>
      <div class="table-scroll">
        <table class="table prendas-table">
          <thead>
            <tr>
              <th>Data</th><th>Imagem</th><th>Título</th><th>Evento</th>
              <th>De</th><th>Para</th><th class="right">Valor</th><th></th>
            </tr>
          </thead>
          <tbody>${linhas}</tbody>
        </table>
      </div>
    </div>`;
}

function linhaHTML(p, { primeira, mov, resta, eventos, categorias }) {
  const classes = [
    primeira ? "grupo-inicio" : "",
    p.virtual ? "virtual" : "",
    p.is_validated ? "validated" : "",
    mov ? "" : "manual",
  ].filter(Boolean).join(" ");

  // Num movimento a data e o evento são dele e não se editam aqui —
  // mudam-se na página de movimentos. Num manual são da prenda.
  const celulaData = mov
    ? (primeira ? `<div>${shortDate(mov.value_date)}</div>` +
        (resta ? `<div class="prenda-resta">falta ${fmt(resta)}</div>` : "") : "")
    : `<input type="date" class="inline prenda-data" value="${esc(p.gift_date || "")}">`;

  const celulaEvento = mov
    ? esc(eventos.get(mov.category_id) || "—")
    : `<select class="inline prenda-evento-sel">${opcoesEvento(categorias, p.event_category_id)}</select>`;

  return `
    <tr data-gift="${p.id}" data-tx="${mov ? mov.id : ""}" class="${classes}">
      <td class="cell-date">${celulaData}</td>
      ${celulaImagem(p)}
      <td><input type="text" class="inline prenda-titulo" value="${esc(p.title)}"
            placeholder="Título da prenda"></td>
      <td class="prenda-evento">${celulaEvento}</td>
      <td><select class="inline prenda-dador">${opcoesPessoa(p.giver_id, "— quem deu —")}</select></td>
      <td><select class="inline prenda-recetor">${opcoesPessoa(p.recipient_id, "— quem recebeu —")}</select></td>
      <td class="cell-amount">
        <input type="number" step="0.01" min="0" class="inline prenda-preco"
          value="${Number(p.price || 0).toFixed(2)}">
      </td>
      <td class="cell-actions">
        <div class="row-actions">
          <button class="btn-check${p.is_validated ? " on" : ""}" data-accao="validar"
            title="${p.is_validated ? "Marcar como não tratada" : "Marcar como tratada"}">✓</button>
          ${mov ? `<button class="btn-split" data-accao="dividir"
                     title="Dividir em mais uma prenda">+</button>` : ""}
          ${mov ? "" : `<button class="btn-dir" data-accao="trocar-direccao"
                     title="${p.direction === "received"
                       ? "Passar para prendas dadas"
                       : "Passar para prendas recebidas"}">⇄</button>`}
          ${p.virtual ? "" :
            `<button class="btn-del" data-accao="apagar" title="Apagar prenda">✕</button>`}
        </div>
      </td>
    </tr>`;
}

/**
 * Total por pessoa, no papel indicado.
 *
 * Nas dadas, duas linhas cinzentas separam o que ainda não está
 * arrumado, e são coisas diferentes: «Sem destinatário» (prendas sem
 * pessoa) e «Por atribuir» (dinheiro do movimento que ainda não virou
 * prenda). Com as duas o total bate certo com o dos movimentos.
 *
 * Nas recebidas não há «Por atribuir»: não há movimento para
 * reconciliar, o valor é o que se escreveu.
 */
function resumoHTML(titulo, blocos, campo, comPorAtribuir) {
  const totais = new Map();
  let atribuido = 0;
  let porAtribuir = 0;

  blocos.forEach(b => {
    let soma = 0;
    b.items.forEach(p => {
      const v = Number(p.price || 0);
      soma += v;
      atribuido += v;
      const chave = p[campo] || "";
      totais.set(chave, (totais.get(chave) || 0) + v);
    });
    if (comPorAtribuir && b.mov) {
      porAtribuir += Math.max(0, Number((Math.abs(Number(b.mov.amount)) - soma).toFixed(2)));
    }
  });

  const linhas = [...totais.entries()]
    .map(([id, v]) => ({ nome: nomePessoa(id) || "Sem pessoa indicada", valor: v, cinzento: !id }))
    .sort((a, b) => b.valor - a.valor);

  if (porAtribuir > 0) linhas.push({ nome: "Por atribuir", valor: porAtribuir, cinzento: true });

  return `
    <div class="card resumo-grupo">
      <div class="resumo-head">
        <h3 class="card-title">${esc(titulo)}</h3>
        <span class="muted">${state.year}</span>
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
              <td class="foot-value">${fmt(atribuido + porAtribuir)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>`;
}

// ═══ Compressão da imagem ═══

/**
 * Reduz e comprime no browser, antes de subir.
 *
 * Só a miniatura é guardada: o ficheiro original nunca chega ao
 * servidor. O imageOrientation "from-image" respeita o EXIF; sem ele,
 * fotos de telemóvel aparecem deitadas.
 */
async function miniatura(file) {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const escala = Math.min(1, LADO_MAX / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * escala));
  const h = Math.max(1, Math.round(bitmap.height * escala));

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  canvas.getContext("2d").drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();

  let data = canvas.toDataURL("image/jpeg", QUALIDADE);
  if (data.length > LIMITE_CHARS) data = canvas.toDataURL("image/jpeg", 0.5);
  if (data.length > LIMITE_CHARS) data = canvas.toDataURL("image/jpeg", 0.35);
  return data;
}

async function subirImagem(giftId, file) {
  if (!file.type.startsWith("image/")) return toast("Escolhe um ficheiro de imagem.", "err");
  if (file.size > LIMITE_FICHEIRO) return toast("Imagem demasiado grande para processar.", "err");

  try {
    const data = await miniatura(file);
    await db.upsertGiftImage(giftId, data);
    imagens.set(giftId, data);
    await renderPrendasPage();
  } catch (err) {
    console.error("Erro ao gravar a imagem:", err);
    toast("Não foi possível gravar a imagem.", "err");
  }
}

// ═══ Edição ═══

function ligarEventos(categorias) {
  const wrap = document.getElementById("prendas-conteudo");

  wrap.querySelectorAll('[data-accao="novo-manual"]').forEach(btn => {
    btn.onclick = () => criarManual(btn.dataset.dir, categorias);
  });

  wrap.querySelectorAll("tr[data-gift]").forEach(row => {
    const txId = row.dataset.tx || null;
    const giftId = row.dataset.gift;
    const virtual = row.classList.contains("virtual");

    const campo = sel => row.querySelector(sel);
    const titulo = campo(".prenda-titulo");
    const preco = campo(".prenda-preco");
    const dador = campo(".prenda-dador");
    const recetor = campo(".prenda-recetor");
    const dataEl = campo(".prenda-data");
    const eventoEl = campo(".prenda-evento-sel");
    const ficheiro = campo(".prenda-ficheiro");

    const pessoaDe = el => (el.value && el.value !== "__novo__" ? el.value : null);

    const valores = () => {
      const v = {
        title: titulo.value.trim(),
        price: Number(preco.value) || 0,
        giver_id: pessoaDe(dador),
        recipient_id: pessoaDe(recetor),
      };
      // Só os manuais têm data e evento próprios; nos movimentos
      // vêm de lá e enviá-los aqui sobrescrevia-os com nulos.
      if (dataEl) v.gift_date = dataEl.value || null;
      if (eventoEl) v.event_category_id = eventoEl.value || null;
      return v;
    };

    /** Devolve o id real da prenda, criando-a se ainda for virtual. */
    const garantir = async (extra = {}) => {
      if (!virtual) return giftId;
      const nova = await db.insertGift({
        transaction_id: txId, direction: "given", ...valores(), ...extra,
      });
      prendas.push(nova);
      return nova.id;
    };

    const gravar = async () => {
      try {
        if (virtual) await garantir();
        else {
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
    if (dataEl) dataEl.onchange = gravar;
    if (eventoEl) eventoEl.onchange = gravar;

    [dador, recetor].forEach(sel => {
      sel.onchange = async () => {
        if (sel.value === "__novo__") {
          const nova = await criarPessoa();
          // Sem pessoa nova, volta ao que estava — "+ Nova pessoa…"
          // não é um valor gravável.
          sel.value = nova ? nova.id : "";
          if (!nova) return;
        }
        await gravar();
      };
    });

    if (ficheiro) {
      ficheiro.onchange = async () => {
        const file = ficheiro.files?.[0];
        ficheiro.value = "";
        if (!file) return;
        try {
          await subirImagem(await garantir(), file);
        } catch (err) {
          console.error("Erro ao anexar a imagem:", err);
          toast("Não foi possível anexar a imagem.", "err");
        }
      };
    }

    row.querySelectorAll("[data-accao]").forEach(btn => {
      btn.onclick = async () => {
        btn.disabled = true;
        try {
          const accao = btn.dataset.accao;
          if (accao === "dividir") await dividir(txId, garantir, virtual);
          else if (accao === "apagar") await apagar(giftId);
          else if (accao === "validar") await validar(giftId, virtual, garantir, row);
          else if (accao === "tirar-imagem") await tirarImagem(giftId);
          else if (accao === "trocar-direccao") await trocarDireccao(giftId);
        } finally {
          btn.disabled = false;
        }
      };
    });
  });
}

async function validar(giftId, virtual, garantir, row) {
  try {
    const actual = row.classList.contains("validated");
    if (virtual) await garantir({ is_validated: !actual });
    else {
      const act = await db.updateGift(giftId, { is_validated: !actual });
      prendas = prendas.map(p => (p.id === giftId ? act : p));
    }
    await renderPrendasPage();
  } catch (err) {
    console.error("Erro ao validar a prenda:", err);
    toast("Não foi possível gravar.", "err");
  }
}

/**
 * Passa um registo manual de dadas para recebidas, ou o contrário.
 *
 * Só existe nos manuais: um movimento é dinheiro que saiu e a base de
 * dados recusa-o como recebida (fin_gifts_mov_dada_chk). Existe
 * porque enganar-se na secção ao criar é fácil, e obrigar a apagar e
 * refazer perderia a imagem e o resto do que já estivesse preenchido.
 */
async function trocarDireccao(giftId) {
  const p = prendas.find(x => x.id === giftId);
  if (!p) return;
  const nova = p.direction === "received" ? "given" : "received";

  try {
    const act = await db.updateGift(giftId, { direction: nova });
    prendas = prendas.map(x => (x.id === giftId ? act : x));
    toast(nova === "received"
      ? "Passou para prendas recebidas."
      : "Passou para prendas dadas.", "ok");
    await renderPrendasPage();
  } catch (err) {
    console.error("Erro ao trocar a direcção:", err);
    toast("Não foi possível trocar a direcção.", "err");
  }
}

async function tirarImagem(giftId) {
  try {
    await db.deleteGiftImage(giftId);
    imagens.delete(giftId);
    await renderPrendasPage();
  } catch (err) {
    console.error("Erro ao remover a imagem:", err);
    toast("Não foi possível remover a imagem.", "err");
  }
}

/**
 * Acrescenta mais uma prenda ao mesmo movimento.
 *
 * A nova fica com o que sobra por atribuir, que é quase sempre o que
 * se quer: dividir 90 € em duas dá 90 e 0, e escreve-se por cima o
 * primeiro valor.
 */
async function dividir(txId, garantir, virtual) {
  try {
    if (virtual) await garantir();

    const t = state.transactions.find(x => x.id === txId);
    const jaAtribuido = prendas
      .filter(p => p.transaction_id === txId)
      .reduce((s, p) => s + Number(p.price || 0), 0);
    const resta = Math.max(0, Number((Math.abs(Number(t?.amount || 0)) - jaAtribuido).toFixed(2)));

    const nova = await db.insertGift({
      transaction_id: txId, direction: "given",
      title: "", price: resta, recipient_id: null, giver_id: null,
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
    // A imagem vai atrás por cascade na base de dados; aqui é só
    // manter o mapa local a par.
    imagens.delete(giftId);
    await renderPrendasPage();
  } catch (err) {
    console.error("Erro ao apagar a prenda:", err);
    toast("Não foi possível apagar.", "err");
  }
}

// ═══ Registo manual ═══

/**
 * Cria uma prenda sem movimento por trás.
 *
 * A data abre no ano que está seleccionado no topo: registar uma
 * prenda de 2025 estando a ver 2026 far-la-ia desaparecer do ecrã
 * mal fosse gravada.
 */
async function criarManual(direccao, categorias) {
  const hoje = today();
  const dataInicial = String(hoje).slice(0, 4) === String(state.year)
    ? hoje
    : `${state.year}-12-25`;

  const res = await confirmModal({
    title: direccao === "received" ? "Nova prenda recebida" : "Nova prenda dada",
    text: "Registo manual, sem movimento bancário associado.",
    okLabel: "Criar",
    extraHTML: `
      <label>Data</label>
      <input type="date" data-field="data" value="${dataInicial}">
      <label>Título</label>
      <input type="text" data-field="titulo" placeholder="O que é a prenda">
      <label>Evento</label>
      <select data-field="evento">${opcoesEvento(categorias, null)}</select>
      <label>Quem deu</label>
      <select data-field="dador">${opcoesPessoaSimples(null)}</select>
      <label>Quem recebeu</label>
      <select data-field="recetor">${opcoesPessoaSimples(null)}</select>
      <label>Valor (€)</label>
      <input type="number" step="0.01" min="0" data-field="preco" value="0.00">`,
  });
  if (!res) return;

  if (!res.data) return toast("Indica a data da prenda.", "err");

  try {
    const nova = await db.insertGift({
      transaction_id: null,
      direction: direccao,
      gift_date: res.data,
      title: (res.titulo || "").trim(),
      event_category_id: res.evento || null,
      giver_id: res.dador || null,
      recipient_id: res.recetor || null,
      price: Number(res.preco) || 0,
    });
    prendas.push(nova);
    toast("Prenda registada.", "ok");
    await renderPrendasPage();
  } catch (err) {
    console.error("Erro ao criar a prenda manual:", err);
    toast("Não foi possível criar a prenda.", "err");
  }
}

/** Sem a opção "+ Nova pessoa…": dentro do modal não há onde a criar. */
function opcoesPessoaSimples(selecionado) {
  return `<option value="">— ninguém —</option>` +
    pessoas.filter(r => !r.archived_at).map(r =>
      `<option value="${r.id}"${r.id === selecionado ? " selected" : ""}>${esc(r.name)}</option>`
    ).join("");
}

// ═══ Pessoas ═══

/** Devolve a pessoa criada, ou null se a criação for cancelada. */
async function criarPessoa() {
  const res = await confirmModal({
    title: "Nova pessoa",
    text: "Serve tanto para quem dá como para quem recebe.",
    okLabel: "Criar",
    extraHTML: `<label>Nome</label><input type="text" data-field="nome">`,
  });
  if (!res || !res.nome?.trim()) return null;

  try {
    const nova = await db.insertGiftRecipient(res.nome.trim());
    pessoas.push(nova);
    toast("Pessoa criada.", "ok");
    return nova;
  } catch (err) {
    console.error("Erro ao criar a pessoa:", err);
    toast(/duplicate|unique/i.test(err?.message || "")
      ? "Já existe uma pessoa com esse nome."
      : "Não foi possível criar a pessoa.", "err");
    return null;
  }
}

/** Renomear ou arquivar, uma de cada vez — a lista costuma ser curta. */
async function gerirPessoas() {
  if (!pessoas.length) {
    toast("Ainda não há pessoas. Cria a primeira.", "");
    return;
  }

  const res = await confirmModal({
    title: "Gerir pessoas",
    text: "Escolhe quem queres alterar.",
    okLabel: "Continuar",
    extraHTML:
      `<label>Pessoa</label>
       <select data-field="id">${
         pessoas.map(r =>
           `<option value="${r.id}">${esc(r.name)}${r.archived_at ? " (arquivada)" : ""}</option>`
         ).join("")
       }</select>`,
  });
  if (!res || !res.id) return;

  const r = pessoas.find(x => x.id === res.id);
  if (!r) return;

  const edicao = await confirmModal({
    title: `«${r.name}»`,
    text: r.archived_at
      ? "Está arquivada. Podes mudar o nome ou reativá-la."
      : "Muda o nome, ou arquiva para a tirar dos seletores sem perder o histórico.",
    okLabel: "Guardar",
    extraHTML:
      `<label>Nome</label>
       <input type="text" data-field="nome" value="${esc(r.name)}">
       <label>Estado</label>
       <select data-field="estado">
         <option value="activo"${r.archived_at ? "" : " selected"}>Activa</option>
         <option value="arquivado"${r.archived_at ? " selected" : ""}>Arquivada</option>
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
    pessoas = pessoas.map(x => (x.id === act.id ? act : x));
    toast("Pessoa actualizada.", "ok");
    await renderPrendasPage();
  } catch (err) {
    console.error("Erro ao actualizar a pessoa:", err);
    toast(/duplicate|unique/i.test(err?.message || "")
      ? "Já existe uma pessoa com esse nome."
      : "Não foi possível actualizar.", "err");
  }
}
