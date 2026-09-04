// ═══════════════════════════════════════════════════════════
// Página Prendas
//
// Uma leitura sobre os movimentos do grupo 29, do ano inteiro e de
// todas as contas. Cada movimento pode dar origem a várias prendas:
// uma compra de 90 € pode ser três prendas de 30 € para três
// pessoas. Daí o preço viver na prenda e não no movimento.
//
// Módulo isolado, com as suas próprias tabelas (migrações 010/011).
// Se falhar, o resto da aplicação continua a andar.
// ═══════════════════════════════════════════════════════════

import * as db from "./db.js";
import { state, noPeriodo } from "./state.js";
import { fmt, esc, shortDate } from "./utils.js";
import { toast, confirmModal } from "./ui.js";

/** Código do grupo cujas categorias contam como prendas. */
const GRUPO_CODE = 29;

// ─── Miniaturas ───

/**
 * Lado maior da miniatura, em pixéis.
 *
 * A imagem só é mostrada pequena na tabela, mas 320 dá margem para
 * ecrãs de alta densidade sem a fazer pesar.
 */
const LADO_MAX = 320;
const QUALIDADE = 0.72;

/** Acima disto volta a comprimir com menos qualidade. ~150 KB. */
const LIMITE_CHARS = 150_000;

/** O ficheiro de origem não chega a ser gravado, mas é lido para memória. */
const LIMITE_FICHEIRO = 25 * 1024 * 1024;

// Vivem aqui e não no state.js: nada fora desta página os usa, e o
// state partilhado não deve crescer com dados de uma vista só.
let recetores = [];
let prendas = [];
let imagens = new Map();   // gift_id → data URI
let carregado = false;
let erroCarregamento = null;
// Promessa em curso, para dois renders seguidos não dispararem duas
// leituras. O renderAll é chamado por vários eventos.
let aCarregar = null;

// ═══ Carregamento ═══

async function carregar() {
  try {
    const [rec, gifts, imgs] = await Promise.all([
      db.fetchGiftRecipients(),
      db.fetchGifts(),
      db.fetchGiftImages(),
    ]);
    recetores = rec;
    prendas = gifts;
    imagens = new Map(imgs.map(i => [i.gift_id, i.data]));
    carregado = true;
    erroCarregamento = null;
  } catch (err) {
    console.error("Erro ao carregar as prendas:", err);
    // A causa mais provável na primeira utilização é uma migração
    // por correr. Dizê-lo poupa uma investigação.
    erroCarregamento = /relation|does not exist|schema cache|column/i.test(err?.message || "")
      ? "Faltam tabelas ou colunas das prendas. Corre as migrações 010_prendas.sql e 011_prendas_validacao_imagem.sql no SQL Editor do Supabase."
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
  ligarEventos();
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
    is_validated: false,
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

/**
 * Célula da imagem.
 *
 * O rótulo inteiro é o alvo do clique, com a miniatura lá dentro:
 * carregar na imagem substitui-a, e no espaço vazio escolhe a
 * primeira. Uma prenda ainda virtual não pode ter imagem — não tem
 * id na base de dados — por isso é gravada antes do upload.
 */
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

function tabelaHTML(movimentos, porMovimento, eventos) {
  const linhas = movimentos.map(t => {
    const items = linhasDe(t, porMovimento);
    const valor = Math.abs(Number(t.amount));
    const atribuido = items.reduce((s, p) => s + Number(p.price || 0), 0);
    const resta = Number((valor - atribuido).toFixed(2));

    return items.map((p, i) => `
      <tr data-gift="${p.id}" data-tx="${t.id}"
          class="${i === 0 ? "grupo-inicio " : ""}${p.virtual ? "virtual " : ""}${p.is_validated ? "validated" : ""}">
        <td class="cell-date">
          ${i === 0 ? `
            <div>${shortDate(t.value_date)}</div>
            ${resta ? `<div class="prenda-resta">falta ${fmt(resta)}</div>` : ""}` : ""}
        </td>
        ${celulaImagem(p)}
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
            <button class="btn-check${p.is_validated ? " on" : ""}" data-accao="validar"
              title="${p.is_validated ? "Marcar como não tratada" : "Marcar como tratada"}">✓</button>
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
              <th>Data</th><th>Imagem</th><th>Título</th>
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

// ═══ Compressão da imagem ═══

/**
 * Reduz e comprime no browser, antes de subir.
 *
 * O que se guarda é só a miniatura: o ficheiro original nunca chega
 * ao servidor. Se ainda assim ficar grande — fotografias com muito
 * detalhe — repete-se com menos qualidade em vez de deixar passar.
 *
 * O imageOrientation "from-image" respeita o EXIF; sem ele, fotos
 * tiradas ao telemóvel aparecem deitadas.
 */
async function miniatura(file) {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const escala = Math.min(1, LADO_MAX / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * escala));
  const h = Math.max(1, Math.round(bitmap.height * escala));

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();

  let data = canvas.toDataURL("image/jpeg", QUALIDADE);
  if (data.length > LIMITE_CHARS) data = canvas.toDataURL("image/jpeg", 0.5);
  if (data.length > LIMITE_CHARS) data = canvas.toDataURL("image/jpeg", 0.35);
  return data;
}

async function subirImagem(giftId, file) {
  if (!file.type.startsWith("image/")) {
    toast("Escolhe um ficheiro de imagem.", "err");
    return;
  }
  if (file.size > LIMITE_FICHEIRO) {
    toast("Imagem demasiado grande para processar.", "err");
    return;
  }

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

function ligarEventos() {
  const wrap = document.getElementById("prendas-conteudo");

  wrap.querySelectorAll("tr[data-gift]").forEach(row => {
    const txId = row.dataset.tx;
    const giftId = row.dataset.gift;
    const virtual = row.classList.contains("virtual");

    const titulo = row.querySelector(".prenda-titulo");
    const preco = row.querySelector(".prenda-preco");
    const recetor = row.querySelector(".prenda-recetor");
    const ficheiro = row.querySelector(".prenda-ficheiro");

    const valores = () => ({
      title: titulo.value.trim(),
      price: Number(preco.value) || 0,
      recipient_id: recetor.value && recetor.value !== "__novo__" ? recetor.value : null,
    });

    /**
     * Devolve o id real da prenda, criando-a se ainda for virtual.
     *
     * Validar ou anexar uma imagem precisa de uma linha que exista na
     * base de dados — não há onde pendurar o registo antes disso.
     */
    const garantir = async (extra = {}) => {
      if (!virtual) return giftId;
      const nova = await db.insertGift({ transaction_id: txId, ...valores(), ...extra });
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

    if (ficheiro) {
      ficheiro.onchange = async () => {
        const file = ficheiro.files?.[0];
        ficheiro.value = "";
        if (!file) return;
        try {
          const id = await garantir();
          await subirImagem(id, file);
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
    if (virtual) {
      await garantir({ is_validated: !actual });
    } else {
      const act = await db.updateGift(giftId, { is_validated: !actual });
      prendas = prendas.map(p => (p.id === giftId ? act : p));
    }
    await renderPrendasPage();
  } catch (err) {
    console.error("Erro ao validar a prenda:", err);
    toast("Não foi possível gravar.", "err");
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
    // Uma linha virtual tem de passar a existir antes de se lhe
    // juntar uma segunda — senão a divisão perdia-a.
    if (virtual) await garantir();

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
    // A imagem vai atrás por cascade na base de dados; aqui é só
    // manter o mapa local a par.
    imagens.delete(giftId);
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
