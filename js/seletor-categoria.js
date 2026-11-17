// ═══════════════════════════════════════════════════════════
// Seletor de categoria — folha com pesquisa e sugestões
//
// Substitui o <select> nativo na edição em linha dos movimentos.
// Com 59 categorias em 15 grupos, a lista nativa obriga a percorrer
// tudo com o polegar e não deixa procurar.
//
// O valor não está na caixa de pesquisa — está nas SUGESTÕES. Nos
// casos comuns a categoria certa é a primeira da fila e basta um
// toque, sem escrever nada. A pesquisa é para o resto.
//
// As sugestões saem do mesmo categorize() que o importador e a
// sincronização usam. É de propósito: se a app sugerisse aqui uma
// coisa e arrumasse outra sozinha, deixava de haver uma resposta
// única para "em que categoria é que isto cai".
// ═══════════════════════════════════════════════════════════

import { state } from "./state.js";
import {
  categoryById, groupedCategories, suggestKeyword, palavraChave, pendentesCom,
} from "./categories.js";
import { categorize } from "./import.js";
import { esc } from "./utils.js";

/** Quantas sugestões, no máximo. Mais do que isto já é uma lista. */
const MAX_SUGESTOES = 4;

let aResolver = null;   // resolve da promessa aberta, ou null

/** Sem acentos e em minúsculas, para "combustivel" encontrar "Combustível". */
const simplificar = s => String(s || "")
  .normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

// ═══ Sugestões ═══

/**
 * Até quatro categorias prováveis, com o motivo à vista.
 *
 * A ordem é a da confiança: o que a regra diz, o que foi feito da
 * última vez com uma descrição parecida, e só depois as mais usadas
 * para encher. O motivo aparece no ecrã — uma sugestão sem
 * explicação é um palpite, com explicação é um argumento.
 */
function sugestoes(descricao, actualId) {
  const vistos = new Set(actualId ? [actualId] : []);
  const out = [];

  const juntar = (id, porque) => {
    if (!id || vistos.has(id) || out.length >= MAX_SUGESTOES) return;
    const c = categoryById(id);
    if (!c || c.archived_at) return;
    vistos.add(id);
    out.push({ c, porque });
  };

  // 1. O que a app faria sozinha.
  juntar(categorize(descricao, state.rules).categoryId, "regra");

  // 2. O que foi feito da última vez com uma descrição parecida.
  const chave = simplificar(suggestKeyword(descricao));
  if (chave.length >= 3) {
    const parecido = state.transactions
      .filter(t => t.is_confirmed && t.category_id &&
        simplificar(t.description).includes(chave))
      .sort((a, b) => String(b.value_date).localeCompare(String(a.value_date)))[0];
    if (parecido) juntar(parecido.category_id, "da última vez");
  }

  // 3. As mais usadas, para encher o que falta.
  const contagem = new Map();
  state.transactions.forEach(t => {
    if (t.category_id) contagem.set(t.category_id, (contagem.get(t.category_id) || 0) + 1);
  });
  [...contagem.entries()]
    .sort((a, b) => b[1] - a[1])
    .forEach(([id]) => juntar(id, "frequente"));

  return out;
}

// ═══ Desenho ═══

function sugestoesHTML(lista) {
  if (!lista.length) return "";
  return `
    <div class="sheet-sugestoes">
      <p class="sheet-rotulo">Sugestões</p>
      <div class="sheet-chips">
        ${lista.map(({ c, porque }) => `
          <button type="button" class="sheet-chip" data-id="${c.id}">
            <span>${esc(c.name)}</span>
            <span class="sheet-porque">${esc(porque)}</span>
          </button>`).join("")}
      </div>
    </div>`;
}

function listaHTML(filtro, actualId) {
  const q = simplificar(filtro);

  const grupos = groupedCategories({ keepId: actualId })
    .map(({ group, items }) => {
      // Procurar pelo nome do grupo encontra todas as categorias
      // dele — é como se procura "Carro" sem saber o nome exacto.
      const grupoBate = q && simplificar(`${group.emoji} ${group.name}`).includes(q);
      return {
        group,
        items: items.filter(c => !q || grupoBate || simplificar(c.name).includes(q)),
      };
    })
    .filter(g => g.items.length);

  if (!grupos.length) {
    return `<p class="sheet-vazio muted">Nenhuma categoria encontrada.</p>`;
  }

  return grupos.map(({ group, items }) => `
    <div class="sheet-grupo">
      <p class="sheet-rotulo">${esc(`${group.emoji} ${group.name}`.trim())}</p>
      ${items.map(c => `
        <button type="button" class="sheet-item${c.id === actualId ? " actual" : ""}"
          data-id="${c.id}">
          ${esc(c.name)}${c.archived_at ? ' <span class="muted">(arquivada)</span>' : ""}
          ${c.id === actualId ? '<span class="sheet-marca">atual</span>' : ""}
        </button>`).join("")}
    </div>`).join("");
}

// ═══ Abrir e fechar ═══

/**
 * Fecha a folha. Com uma categoria escolhida, devolve-a junto com a
 * regra pedida (a palavra-chave, se a caixa estava marcada, ou null).
 */
function fechar(categoryId) {
  const overlay = document.getElementById("cat-sheet");
  if (overlay) overlay.classList.add("hidden");
  document.removeEventListener("keydown", aoTeclado);

  let resultado = null;
  if (categoryId) {
    const on = document.getElementById("cat-sheet-regra-on");
    const chave = document.getElementById("cat-sheet-regra-chave");
    const nota = document.getElementById("cat-sheet-regra-nota");
    const k = chave ? chave.value.trim().toUpperCase() : "";
    const regra = on && on.checked && k.length >= 3 ? k : null;
    resultado = {
      categoryId,
      regra,
      // undefined quando a nota não foi mexida: a regra fica com a que
      // tinha. Uma nota apagada de propósito chega como "".
      nota: regra && nota && nota.dataset.mexida === "1" ? nota.value.trim() : undefined,
    };
  }

  const r = aResolver;
  aResolver = null;
  if (r) r(resultado);
}

/**
 * A linha «Criar regra» do topo da folha.
 *
 * Substitui o aviso que aparecia depois de categorizar: durava oito
 * segundos e pedia mais dois cliques num modal. Aqui marca-se antes de
 * escolher a categoria, no mesmo sítio, e a escolha leva a regra.
 *
 * Vem marcada só quando o movimento está por categorizar e a palavra
 * já se repete — noutros por categorizar ou no histórico. Um
 * comerciante que aparece pela primeira vez não ganha regra sozinho:
 * encher as regras de casos únicos só arranjava falsos positivos.
 */
function prepararRegra(descricao, pendente, idActual) {
  const linha = document.getElementById("cat-sheet-regra");
  const on = document.getElementById("cat-sheet-regra-on");
  const chave = document.getElementById("cat-sheet-regra-chave");
  const info = document.getElementById("cat-sheet-regra-info");
  const nota = document.getElementById("cat-sheet-regra-nota");
  const rotulo = document.getElementById("cat-sheet-regra-rotulo");
  if (!linha || !on || !chave || !info) return;

  // Se já há uma regra tua que apanha este movimento, é essa que se
  // propõe — para lhe mudar a categoria ou a nota. Propor uma palavra
  // nova criava uma segunda regra para o mesmo comerciante.
  const desc = String(descricao || "").toUpperCase();
  const existenteJa = state.rules.find(r =>
    r.keyword && desc.includes(String(r.keyword).toUpperCase()));
  const proposta = existenteJa ? String(existenteJa.keyword).toUpperCase()
                               : palavraChave(descricao);
  if (!proposta || proposta.length < 3) {
    linha.classList.add("hidden");
    on.checked = false;
    return;
  }

  const regraDe = k => state.rules.find(r =>
    String(r.keyword).toUpperCase() === String(k).trim().toUpperCase());

  // Com regra para esta palavra, a linha diz que a vai atualizar e
  // mostra a nota que ela já tem — é assim que se acrescenta uma nota a
  // uma regra antiga, que não tem outro sítio onde se editar.
  const descrever = () => {
    const n = pendentesCom(chave.value, idActual).length;
    info.textContent = n
      ? `arruma também ${n} por categorizar`
      : "para os próximos movimentos";
    const existente = regraDe(chave.value);
    if (rotulo) rotulo.textContent = existente ? "Atualizar regra" : "Criar regra para";
    if (nota && nota.dataset.mexida !== "1") nota.value = existente?.note || "";
    return n;
  };

  if (nota) nota.dataset.mexida = "";
  chave.value = proposta;
  const outros = descrever();
  const k = proposta.toUpperCase();
  const historico = state.transactions.some(t =>
    t.is_confirmed && t.id !== idActual &&
    String(t.description || "").toUpperCase().includes(k));
  const jaHaRegra = !!regraDe(k);

  on.checked = pendente && !jaHaRegra && (outros > 0 || historico);
  linha.classList.remove("hidden");

  // Escrever na palavra-chave ou na nota é querer a regra.
  chave.oninput = () => { on.checked = true; descrever(); };
  chave.onfocus = () => { on.checked = true; };
  if (nota) {
    nota.onfocus = () => { on.checked = true; };
    nota.oninput = () => { nota.dataset.mexida = "1"; on.checked = true; };
  }
}

function aoTeclado(e) {
  if (e.key === "Escape") return fechar(null);
  if (e.key === "Enter") {
    // Enter escolhe o primeiro resultado à vista — depois de
    // escrever, é quase sempre o que se quer.
    const primeiro = document.querySelector("#cat-sheet .sheet-chip, #cat-sheet .sheet-item");
    if (primeiro) {
      e.preventDefault();
      fechar(primeiro.dataset.id);
    }
  }
}

/**
 * Abre a folha e devolve { categoryId, regra }, ou null se for
 * cancelada. Sem a folha na página devolve undefined.
 */
export function escolherCategoria({
  actualId = null, descricao = "", pendente = false, movimentoId = null,
} = {}) {
  const overlay = document.getElementById("cat-sheet");
  const busca = document.getElementById("cat-sheet-busca");
  const corpo = document.getElementById("cat-sheet-corpo");

  // Sem a marcação não há seletor — melhor cair no <select> nativo
  // do que deixar de dar para categorizar.
  if (!overlay || !busca || !corpo) return Promise.resolve(undefined);

  // Uma folha de cada vez: se já havia uma aberta, fica cancelada.
  if (aResolver) fechar(null);

  const sugeridas = sugestoes(descricao, actualId);

  const pintar = () => {
    // As sugestões só fazem sentido enquanto não se procura nada:
    // a partir daí o que manda é o que foi escrito.
    corpo.innerHTML = (busca.value.trim() ? "" : sugestoesHTML(sugeridas)) +
      listaHTML(busca.value, actualId);
  };

  busca.value = "";
  pintar();
  prepararRegra(descricao, pendente, movimentoId);
  overlay.classList.remove("hidden");

  busca.oninput = pintar;

  corpo.onclick = e => {
    const alvo = e.target.closest("[data-id]");
    if (alvo) fechar(alvo.dataset.id);
  };

  overlay.onclick = e => { if (e.target === overlay) fechar(null); };
  document.getElementById("cat-sheet-fechar").onclick = () => fechar(null);
  document.addEventListener("keydown", aoTeclado);

  // No telemóvel não se põe o cursor na pesquisa: o teclado subia
  // logo e tapava as sugestões, que são o caminho mais curto. Com
  // rato, o foco poupa um clique.
  if (window.matchMedia("(pointer: fine)").matches) busca.focus();

  return new Promise(resolve => { aResolver = resolve; });
}
