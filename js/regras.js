// ═══════════════════════════════════════════════════════════
// Regras de categorização — gravar e avaliar
//
// Um só sítio para mexer em regras: o seletor de categoria e a área
// de regras da página de categorias usam ambos estas funções, e por
// isso uma regra nova arruma os pendentes e escreve a nota da mesma
// maneira venha de onde vier.
// ═══════════════════════════════════════════════════════════

import * as db from "./db.js";
import { state, updateLocal, findTransaction } from "./state.js";
import { pendentesCom } from "./categories.js";
import { categorize, ordemDasRegras } from "./import.js";
import { toast } from "./ui.js";
import { esc } from "./utils.js";

const up = s => String(s || "").toUpperCase();

/** Repinta o que estiver à vista — tabela, painel ou esta página. */
function avisar() {
  document.dispatchEvent(new CustomEvent("data-changed"));
}

/** Traduz o erro do Postgres em algo legível. */
function mensagemErro(err, keyword) {
  if (err?.code === "23505") return `Já existe uma regra para «${keyword}».`;
  if (/column|schema cache/i.test(err?.message || "")) {
    return "Falta correr a migração 015_nota_nas_regras.sql no Supabase.";
  }
  return err?.message || "Não foi possível gravar a regra.";
}

// ═══ Aplicar uma regra ao que está por categorizar ═══

/**
 * Arruma os movimentos por categorizar que a regra apanha e escreve a
 * nota dela onde a nota está vazia — nesses e no movimento de origem.
 *
 * Só mexe nos que estão por categorizar: um movimento já arrumado, à
 * mão ou por outra regra, fica como está. E a nota da regra nunca
 * substitui o que se escreveu à mão.
 */
async function aplicarAosPendentes(rule, excluirId = null) {
  const apanhados = pendentesCom(rule.keyword, excluirId);
  if (apanhados.length) {
    await db.categorizeMany(apanhados.map(x => x.id), rule.category_id);
    apanhados.forEach(x => updateLocal(x.id, { category_id: rule.category_id, is_confirmed: true }));
  }

  let comNota = 0;
  if (rule.note) {
    const origem = excluirId ? findTransaction(excluirId) : null;
    const semNota = [...apanhados, ...(origem ? [origem] : [])]
      .filter(x => !String(x.note || "").trim());
    if (semNota.length) {
      await db.setNotes(semNota.map(x => x.id), rule.note);
      semNota.forEach(x => updateLocal(x.id, { note: rule.note }));
      comNota = semNota.length;
    }
  }
  return { arrumados: apanhados.length, comNota };
}

function avisoGravada(rule, verbo, { arrumados = 0, comNota = 0 } = {}) {
  toast(`Regra «${esc(rule.keyword)}» ${verbo}` +
    (comNota ? ` · nota «${esc(rule.note)}» em ${comNota}` : "") +
    (arrumados
      ? ` · mais ${arrumados} movimento${arrumados === 1 ? "" : "s"} arrumado${arrumados === 1 ? "" : "s"}.`
      : "."), "ok");
}

// ═══ Criar, alterar, apagar ═══

/**
 * Cria a regra, ou atualiza a que já existe com a mesma palavra.
 *
 * «nota» undefined é «não mexer»: uma regra que já existia fica com a
 * nota que tinha. Devolve a regra gravada, ou null se falhou.
 */
export async function guardarRegra(keyword, categoryId, {
  nota = undefined, excluirId = null, aplicar = true,
} = {}) {
  let rule;
  try {
    rule = await db.upsertRule(keyword, categoryId, { note: nota });
    state.rules = state.rules.filter(r => r.id !== rule.id).concat(rule);
  } catch (err) {
    console.error("Erro ao guardar a regra:", err);
    toast(mensagemErro(err, up(keyword).trim()), "err");
    return null;
  }

  let efeito = {};
  if (aplicar) {
    try {
      efeito = await aplicarAosPendentes(rule, excluirId);
    } catch (err) {
      console.error("Erro ao aplicar a regra:", err);
      toast("Regra guardada, mas não foi possível arrumar os movimentos.", "err");
    }
  }
  avisar();
  avisoGravada(rule, "guardada", efeito);
  return rule;
}

/**
 * Muda a palavra, a categoria ou a nota de uma regra existente.
 *
 * Pelo id, e não por upsert da palavra: com o upsert, mudar a palavra
 * criava uma regra nova e deixava a antiga para trás.
 */
export async function alterarRegra(regra, { keyword, categoryId, nota, aplicar = false }) {
  const patch = {};
  const k = up(keyword).trim();
  if (k && k !== up(regra.keyword)) patch.keyword = k;
  if (categoryId && categoryId !== regra.category_id) patch.category_id = categoryId;
  const n = String(nota ?? "").trim() || null;
  if (n !== (regra.note || null)) patch.note = n;

  if (!Object.keys(patch).length && !aplicar) return regra;

  let rule = regra;
  if (Object.keys(patch).length) {
    try {
      rule = await db.updateRule(regra.id, patch);
      state.rules = state.rules.map(r => (r.id === rule.id ? rule : r));
    } catch (err) {
      console.error("Erro ao alterar a regra:", err);
      toast(mensagemErro(err, patch.keyword || regra.keyword), "err");
      return null;
    }
  }

  let efeito = {};
  if (aplicar) {
    try {
      efeito = await aplicarAosPendentes(rule);
    } catch (err) {
      console.error("Erro ao aplicar a regra:", err);
      toast("Regra alterada, mas não foi possível arrumar os movimentos.", "err");
    }
  }
  avisar();
  avisoGravada(rule, "alterada", efeito);
  return rule;
}

/** Apaga a regra. Os movimentos que ela já arrumou ficam como estão. */
export async function apagarRegra(regra) {
  try {
    await db.deleteRule(regra.id);
    state.rules = state.rules.filter(r => r.id !== regra.id);
  } catch (err) {
    console.error("Erro ao apagar a regra:", err);
    toast(err?.message || "Não foi possível apagar a regra.", "err");
    return false;
  }
  avisar();
  toast(`Regra «${esc(regra.keyword)}» apagada.`, "ok");
  return true;
}

// ═══ Avaliar ═══

/** Uma regra criada há menos do que isto, sem uso, ainda não é «sem efeito». */
const DIAS_NOVA = 60;

/**
 * O que cada regra está a fazer, medido nos movimentos.
 *
 * Só conta os movimentos que vêm do banco ou do Excel: é só nesses que
 * as regras atuam. Os lançados à mão são categorizados à mão, e
 * contá-los fazia parecer em conflito uma regra que está certa — foi o
 * que aconteceu com o Pingo Doce, entre o cartão do banco e o cartão
 * refeição.
 *
 * Estados, do mais ao menos urgente:
 *   CONFLITO    — em mais de 20% do que decide, a categoria final é outra;
 *   TAPADA      — apanha movimentos, mas outra regra decide sempre antes;
 *   MORTA       — nunca apanhou nada;
 *   REDUNDANTE  — sem ela ficava tudo igual (e não tem nota a acrescentar);
 *   NOVA        — criada há pouco, ainda sem uso;
 *   UTIL        — decide, e de acordo contigo.
 */
export function analisarRegras() {
  const regras = ordemDasRegras(state.rules);
  const movs = state.transactions.filter(t => !t.is_manual);
  const decisor = new Map(movs.map(t => [
    t.id, regras.find(r => up(t.description).includes(up(r.keyword))) || null,
  ]));
  const agora = Date.now();

  const out = new Map();
  regras.forEach(r => {
    const k = up(r.keyword);
    const apanha = movs.filter(t => up(t.description).includes(k));
    const decide = apanha.filter(t => decisor.get(t.id)?.id === r.id);
    const confirmados = decide.filter(t => t.is_confirmed);
    const deAcordo = confirmados.filter(t => t.category_id === r.category_id).length;

    const outras = new Map();
    confirmados.filter(t => t.category_id !== r.category_id).forEach(t =>
      outras.set(t.category_id, (outras.get(t.category_id) || 0) + 1));

    const semEla = state.rules.filter(x => x.id !== r.id);
    const igualSemEla = decide.every(t =>
      categorize(t.description, semEla).categoryId === r.category_id);

    const criada = r.created_at ? new Date(r.created_at).getTime() : null;
    const recente = criada && agora - criada < DIAS_NOVA * 86_400_000;

    let estado;
    if (!apanha.length) estado = recente ? "NOVA" : "MORTA";
    else if (!decide.length) estado = "TAPADA";
    else if (confirmados.length && deAcordo / confirmados.length < 0.8) estado = "CONFLITO";
    else if (igualSemEla && !r.note) estado = "REDUNDANTE";
    else estado = "UTIL";

    out.set(r.id, {
      estado,
      apanha: apanha.length,
      decide: decide.length,
      confirmados: confirmados.length,
      deAcordo,
      outras: [...outras.entries()].sort((a, b) => b[1] - a[1]),
      tapadaPor: [...new Set(apanha.map(t => decisor.get(t.id)?.keyword).filter(Boolean))],
      ultimo: apanha.map(t => String(t.value_date)).sort().pop() || null,
    });
  });
  return out;
}
