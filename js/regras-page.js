// ═══════════════════════════════════════════════════════════
// Área de regras, na página de categorias
//
// Até aqui uma regra só se via e alterava a partir de um movimento,
// no seletor; apagar uma, ou corrigir uma palavra que nunca batia
// certo, obrigava a ir ao SQL Editor. Aqui estão todas, com o que
// cada uma está a fazer de facto.
//
// Módulo isolado: se falhar, a gestão de categorias continua.
// ═══════════════════════════════════════════════════════════

import { state } from "./state.js";
import { groupedCategories, categoryById, pendentesCom } from "./categories.js";
import { confirmModal, toast } from "./ui.js";
import { esc, shortDate } from "./utils.js";
import { analisarRegras, guardarRegra, alterarRegra, apagarRegra } from "./regras.js";
import { botaoIcone, ocupado } from "./icones.js";

let filtro = "";

const simplificar = s => String(s || "")
  .normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

/** Rótulo, cor e explicação de cada estado. */
const ESTADOS = {
  CONFLITO:   { rotulo: "Em conflito", classe: "conflito" },
  TAPADA:     { rotulo: "Tapada", classe: "aviso" },
  MORTA:      { rotulo: "Sem efeito", classe: "neutro" },
  REDUNDANTE: { rotulo: "Redundante", classe: "neutro" },
  NOVA:       { rotulo: "Nova", classe: "nova" },
  UTIL:       { rotulo: "Útil", classe: "util" },
};
const ORDEM = ["CONFLITO", "TAPADA", "MORTA", "REDUNDANTE", "NOVA", "UTIL"];

/**
 * O porquê do estado, em texto à vista e não num title: no telemóvel
 * não há rato para o mostrar.
 */
function explicacao(a) {
  const nomeCat = id => categoryById(id)?.name || "sem categoria";
  switch (a.estado) {
    case "CONFLITO":
      return `Em ${a.confirmados - a.deAcordo} dos ${a.confirmados} movimentos que decide, ` +
        `a categoria final é outra: ` +
        a.outras.map(([id, n]) => `${nomeCat(id)} ×${n}`).join(", ") + ".";
    case "TAPADA":
      return `Apanha ${a.apanha} movimento${a.apanha === 1 ? "" : "s"}, mas ` +
        `«${a.tapadaPor.join("», «")}» decide antes dela.`;
    case "MORTA":
      return "Nunca apanhou nenhum movimento do banco ou do Excel. " +
        "Se a palavra não aparece assim na descrição, nunca vai atuar.";
    case "REDUNDANTE":
      return "Sem ela ficava tudo igual: a regra base ou outra regra fazem o mesmo.";
    case "NOVA":
      return "Criada há pouco — ainda não apanhou nenhum movimento.";
    default:
      return "";
  }
}

// ═══ Arranque e pintura ═══

export function initRegrasPage() {
  const btn = document.getElementById("btn-nova-regra");
  if (btn) btn.onclick = () => abrirModal(null);

  const busca = document.getElementById("regras-busca");
  if (busca) busca.oninput = () => { filtro = busca.value; renderRegrasPage(); };
}

export function renderRegrasPage() {
  const wrap = document.getElementById("regras-lista");
  if (!wrap) return;

  if (!state.rules.length) {
    wrap.innerHTML = `<div class="card empty"><p>Ainda não há regras. ` +
      `Cria uma aqui, ou ao categorizar um movimento.</p></div>`;
    return;
  }

  const analise = analisarRegras();
  const q = simplificar(filtro.trim());
  const nomeCat = r => categoryById(r.category_id)?.name || "";

  const regras = [...state.rules]
    .filter(r => !q || [r.keyword, nomeCat(r), r.note].some(v => simplificar(v).includes(q)))
    .sort((a, b) =>
      ORDEM.indexOf(analise.get(a.id)?.estado) - ORDEM.indexOf(analise.get(b.id)?.estado) ||
      String(a.keyword).localeCompare(String(b.keyword)));

  const aRever = [...analise.values()]
    .filter(a => ["CONFLITO", "TAPADA", "MORTA", "REDUNDANTE"].includes(a.estado)).length;

  const card = document.createElement("div");
  card.className = "card regras-card";
  card.innerHTML = `
    <div class="regras-resumo">
      <span><b>${state.rules.length}</b> regra${state.rules.length === 1 ? "" : "s"}</span>
      ${aRever ? `<span class="regras-arever">${aRever} a rever</span>` : `<span class="muted">todas a funcionar</span>`}
      <span class="muted regras-dica">Contam só os movimentos do banco e do Excel — os lançados à mão não passam pelas regras.</span>
    </div>`;

  const lista = document.createElement("div");
  lista.className = "regras-lista";
  if (!regras.length) {
    lista.innerHTML = `<p class="muted resumo-vazio">Nenhuma regra corresponde à pesquisa.</p>`;
  }
  regras.forEach(r => lista.appendChild(linhaRegra(r, analise.get(r.id))));
  card.appendChild(lista);

  wrap.innerHTML = "";
  wrap.appendChild(card);
}

function linhaRegra(r, a) {
  const est = ESTADOS[a?.estado] || ESTADOS.UTIL;
  const cat = categoryById(r.category_id);
  const grupo = cat ? state.categoryGroups.find(g => g.id === cat.group_id) : null;

  const row = document.createElement("div");
  row.className = `regra-row ${est.classe}`;

  const partes = [];
  if (r.note) partes.push(`nota <span class="regra-nota">${esc(r.note)}</span>`);
  if (a?.decide) partes.push(`decide ${a.decide} movimento${a.decide === 1 ? "" : "s"}`);
  if (a?.ultimo) partes.push(`último ${shortDate(a.ultimo)}`);
  const porque = explicacao(a || {});

  row.innerHTML = `
    <div class="regra-corpo">
      <div class="regra-linha">
        <span class="regra-palavra">${esc(r.keyword)}</span>
        <span class="regra-seta" aria-hidden="true">→</span>
        <span class="regra-cat">${esc(`${grupo?.emoji || ""} ${cat?.name || "(categoria apagada)"}`.trim())}</span>
        <span class="regra-estado ${est.classe}">${est.rotulo}</span>
      </div>
      ${partes.length ? `<div class="regra-sub">${partes.join(" · ")}</div>` : ""}
      ${porque ? `<div class="regra-porque">${esc(porque)}</div>` : ""}
    </div>`;

  const accoes = document.createElement("span");
  accoes.className = "cat-accoes";
  accoes.appendChild(botaoIcone("editar", "Editar regra", () => abrirModal(r)));
  accoes.appendChild(botaoIcone("apagar", "Apagar regra", b => confirmarApagar(r, b), "perigo"));
  row.appendChild(accoes);
  return row;
}

// ═══ Criar e editar ═══

function opcoesCategoria(selecionada) {
  return groupedCategories({ keepId: selecionada }).map(({ group, items }) =>
    `<optgroup label="${esc(`${group.emoji} ${group.name}`.trim())}">` +
    items.map(c =>
      `<option value="${c.id}"${c.id === selecionada ? " selected" : ""}>${esc(c.name)}</option>`
    ).join("") + `</optgroup>`
  ).join("");
}

/**
 * O mesmo modal para criar e para editar.
 *
 * A caixa de arrumar os pendentes só aparece quando há pendentes que
 * a palavra apanha, e diz quantos: arrumar movimentos sem o dizer
 * antes seria uma surpresa.
 */
async function abrirModal(regra) {
  const pend = regra ? pendentesCom(regra.keyword).length : 0;
  const res = await confirmModal({
    title: regra ? "Editar regra" : "Nova regra",
    text: "A palavra é procurada na descrição do banco, tal e qual — " +
      "com a mesma pontuação. A nota é escrita nos movimentos que a regra " +
      "arrumar, quando ainda não têm nenhuma." +
      (regra ? "" : " Os movimentos por categorizar que ela apanhar ficam logo arrumados."),
    okLabel: regra ? "Guardar" : "Criar",
    extraHTML: `
      <label>Palavra na descrição</label>
      <input type="text" data-field="keyword" class="regra-input-palavra"
        value="${esc(regra?.keyword || "")}" placeholder="Ex.: CONTINENTE" autocomplete="off">
      <label>Categoria</label>
      <select data-field="categoryId">${opcoesCategoria(regra?.category_id || null)}</select>
      <label>Nota (opcional)</label>
      <input type="text" data-field="nota" value="${esc(regra?.note || "")}"
        placeholder="Ex.: Loja Primor" autocomplete="off">
      ${regra && pend ? `
      <label class="regra-aplicar">
        <input type="checkbox" data-field="aplicar" checked>
        Arrumar já ${pend === 1 ? "o movimento" : `os ${pend} movimentos`} por categorizar que ela apanha
      </label>` : ""}`,
  });
  if (!res) return;

  const keyword = String(res.keyword || "").trim();
  if (keyword.length < 3) {
    toast("A palavra precisa de pelo menos 3 letras.", "err");
    return;
  }

  // Duas regras com a mesma palavra não podem existir: a base de dados
  // recusa. Dizê-lo aqui poupa a ida ao servidor.
  const outra = state.rules.find(r =>
    r.id !== regra?.id && String(r.keyword).toUpperCase() === keyword.toUpperCase());
  if (outra) {
    toast(`Já existe uma regra para «${esc(outra.keyword)}».`, "err");
    return;
  }

  if (regra) {
    await alterarRegra(regra, {
      keyword, categoryId: res.categoryId, nota: res.nota, aplicar: res.aplicar === true,
    });
  } else {
    // Numa regra nova, arrumar os pendentes que ela apanha é o que se
    // espera dela — como no seletor.
    await guardarRegra(keyword, res.categoryId, { nota: String(res.nota || "").trim() || undefined });
  }
}

async function confirmarApagar(regra, btn) {
  const ok = await confirmModal({
    title: "Apagar regra",
    text: `Apagar a regra «${regra.keyword}»? Os movimentos que ela já arrumou ` +
      `ficam como estão; os próximos deixam de ser arrumados por ela.`,
    okLabel: "Apagar",
  });
  if (!ok) return;
  ocupado(btn, true);
  const apagou = await apagarRegra(regra);
  if (!apagou) ocupado(btn, false);
}
