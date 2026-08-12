// ═══════════════════════════════════════════════════════════
// Importação do extrato Excel do Activo Bank
//
// Formato: 7 linhas de metadados, cabeçalho na linha 8:
//   Data Lanc. | Data Valor | Descrição | Valor | Saldo
// ═══════════════════════════════════════════════════════════

import { parseExcelDate, makeHash } from "./utils.js";
import { DEFAULT_RULES } from "./categories.js";

/** Aplica as regras do utilizador e, em último recurso, as regras base. */
export function categorize(description, userRules) {
  const upper = String(description || "").toUpperCase();

  // 1) Regras do utilizador (prioridade)
  for (const rule of userRules) {
    if (upper.includes(String(rule.keyword).toUpperCase())) {
      return { category: rule.category, matched: true };
    }
  }

  // 2) Regras base
  for (const [keyword, category] of DEFAULT_RULES) {
    if (upper.includes(keyword.toUpperCase())) {
      return { category, matched: true };
    }
  }

  return { category: null, matched: false };
}

/** Lê o ficheiro e devolve as linhas prontas a inserir. */
export function parseStatement(arrayBuffer, userRules, knownHashes) {
  const wb = XLSX.read(arrayBuffer, { type: "array", cellDates: true });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });

  // ─── Detetar cabeçalho ───
  let headerRow = 7;
  let colMovement = 0, colValue = 1, colDesc = 2, colAmount = 3;
  let detected = false;

  for (let i = 0; i < Math.min(20, rows.length); i++) {
    const row = rows[i];
    if (!Array.isArray(row)) continue;
    const texts = row.map(v => String(v ?? "").toLowerCase().trim());

    const iDesc = texts.findIndex(v => v.includes("descri"));
    const iAmount = texts.findIndex(v => v === "valor" || v === "valor (€)" || v === "montante");
    if (iDesc === -1 || iAmount === -1) continue;

    const iMovement = texts.findIndex(v => v.includes("lanc"));
    const iValue = texts.findIndex((v, idx) => idx !== iMovement && v.includes("data") && v.includes("valor"));

    headerRow = i;
    colDesc = iDesc;
    colAmount = iAmount;
    colMovement = iMovement !== -1 ? iMovement : 0;
    colValue = iValue !== -1 ? iValue : (colMovement === 0 ? 1 : 0);
    detected = true;
    break;
  }

  if (!detected) {
    throw new Error("Não foi possível reconhecer o formato do extrato.");
  }

  // ─── Ler movimentos ───
  const parsed = [];
  const duplicates = [];
  const seenInFile = new Set();

  for (let i = headerRow + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!Array.isArray(row)) continue;

    const rawAmount = row[colAmount];
    if (rawAmount === null || rawAmount === undefined || rawAmount === "") continue;

    const amount = typeof rawAmount === "number"
      ? rawAmount
      : parseFloat(String(rawAmount).replace(/\s/g, "").replace(".", "").replace(",", "."));
    if (!Number.isFinite(amount) || amount === 0) continue;

    const description = String(row[colDesc] ?? "").trim();
    if (!description) continue;

    const movementDate = parseExcelDate(row[colMovement]);
    const valueDate = parseExcelDate(row[colValue]) || movementDate;
    if (!movementDate && !valueDate) continue;

    const finalMovement = movementDate || valueDate;
    const finalValue = valueDate || movementDate;

    const hash = makeHash(finalValue, description, amount);
    if (knownHashes.has(hash) || seenInFile.has(hash)) {
      duplicates.push(description);
      continue;
    }
    seenInFile.add(hash);

    const { category, matched } = categorize(description, userRules);

    parsed.push({
      movement_date: finalMovement,
      value_date: finalValue,
      description,
      note: "",
      category: category || (amount > 0 ? "Valores Creditados" : "Outros"),
      amount: Number(amount.toFixed(2)),
      is_manual: false,
      is_validated: false,
      is_confirmed: matched,
      source_hash: hash,
    });
  }

  return {
    rows: parsed,
    duplicates: duplicates.length,
    autoCategorized: parsed.filter(r => r.is_confirmed).length,
  };
}

/** Lê um File como ArrayBuffer. */
export function readFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => resolve(e.target.result);
    reader.onerror = () => reject(new Error("Não foi possível ler o ficheiro."));
    reader.readAsArrayBuffer(file);
  });
}
