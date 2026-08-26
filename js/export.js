// ═══════════════════════════════════════════════════════════
// Exportação para Excel
//
// Usa xlsx-js-style (fork do SheetJS com suporte a estilos),
// por isso as linhas validadas saem mesmo com fundo #6AA84F.
// ═══════════════════════════════════════════════════════════

import { state, catName } from "./state.js";
import { MONTHS_SHORT, monthOf, yearOf } from "./utils.js";
import { toast } from "./ui.js";

const GREEN = "6AA84F";
const HEADERS = ["Nota", "Data Mov.", "Data Valor", "Descrição", "Categoria", "Valor (€)"];

export function exportToExcel() {
  const yearTx = state.transactions.filter(t => yearOf(t.value_date) === state.year);
  if (!yearTx.length) return toast("Sem movimentos para exportar neste ano.", "err");

  const wb = XLSX.utils.book_new();

  // ─── Uma folha por mês ───
  MONTHS_SHORT.forEach((monthName, index) => {
    const rows = yearTx
      .filter(t => monthOf(t.value_date) === index)
      .sort((a, b) => a.value_date.localeCompare(b.value_date));
    if (!rows.length) return;

    const income = rows.filter(t => t.amount > 0).reduce((s, t) => s + Number(t.amount), 0);
    const expense = rows.filter(t => t.amount < 0).reduce((s, t) => s + Math.abs(Number(t.amount)), 0);

    const aoa = [
      ["Mês", monthName, state.year],
      [],
      ["Total Receitas", income],
      ["Total Despesas", expense],
      ["Saldo", income - expense],
      [],
      HEADERS,
      ...rows.map(t => [
        t.note || "",
        t.movement_date,
        t.value_date,
        t.description,
        catName(t.category_id),
        Number(t.amount),
      ]),
    ];

    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws["!cols"] = [{ wch: 28 }, { wch: 12 }, { wch: 12 }, { wch: 42 }, { wch: 22 }, { wch: 13 }];

    const headerRowIdx = 6; // 0-indexed

    // Cabeçalho a negrito
    HEADERS.forEach((_, c) => {
      const addr = XLSX.utils.encode_cell({ r: headerRowIdx, c });
      if (ws[addr]) ws[addr].s = { font: { bold: true }, fill: { patternType: "solid", fgColor: { rgb: "EFEFEF" } } };
    });

    // Formato monetário + destaque das linhas validadas
    rows.forEach((t, offset) => {
      const r = headerRowIdx + 1 + offset;

      const amountAddr = XLSX.utils.encode_cell({ r, c: 5 });
      if (ws[amountAddr]) ws[amountAddr].z = '#,##0.00 €';

      if (!t.is_validated) return;
      for (let c = 0; c < HEADERS.length; c++) {
        const addr = XLSX.utils.encode_cell({ r, c });
        if (!ws[addr]) ws[addr] = { v: "", t: "s" };
        ws[addr].s = {
          ...(ws[addr].s || {}),
          fill: { patternType: "solid", fgColor: { rgb: GREEN } },
          font: { color: { rgb: "FFFFFF" }, bold: true },
        };
      }
    });

    XLSX.utils.book_append_sheet(wb, ws, monthName);
  });

  // ─── Folha de resumo anual ───
  const expenseByMonth = MONTHS_SHORT.map((_, i) =>
    yearTx.filter(t => monthOf(t.value_date) === i && t.amount < 0)
      .reduce((s, t) => s + Math.abs(Number(t.amount)), 0));
  const incomeByMonth = MONTHS_SHORT.map((_, i) =>
    yearTx.filter(t => monthOf(t.value_date) === i && t.amount > 0)
      .reduce((s, t) => s + Number(t.amount), 0));
  const balanceByMonth = incomeByMonth.map((v, i) => v - expenseByMonth[i]);

  const sum = arr => arr.reduce((a, b) => a + b, 0);

  const annual = [
    ["", ...MONTHS_SHORT, "Total"],
    ["Total Receita", ...incomeByMonth, sum(incomeByMonth)],
    ["Total Despesa", ...expenseByMonth, sum(expenseByMonth)],
    ["Saldo", ...balanceByMonth, sum(balanceByMonth)],
  ];

  const wsAnnual = XLSX.utils.aoa_to_sheet(annual);
  wsAnnual["!cols"] = [{ wch: 16 }, ...MONTHS_SHORT.map(() => ({ wch: 11 })), { wch: 13 }];

  // Cabeçalho e primeira coluna a negrito
  for (let c = 0; c <= 13; c++) {
    const addr = XLSX.utils.encode_cell({ r: 0, c });
    if (wsAnnual[addr]) wsAnnual[addr].s = { font: { bold: true } };
  }
  for (let r = 1; r <= 3; r++) {
    const addr = XLSX.utils.encode_cell({ r, c: 0 });
    if (wsAnnual[addr]) wsAnnual[addr].s = { font: { bold: true } };
    for (let c = 1; c <= 13; c++) {
      const cell = XLSX.utils.encode_cell({ r, c });
      if (wsAnnual[cell]) wsAnnual[cell].z = '#,##0.00 €';
    }
  }

  XLSX.utils.book_append_sheet(wb, wsAnnual, "Anual");
  XLSX.writeFile(wb, `Despesas_${state.year}_GestorFin.xlsx`);
  toast("Excel exportado.", "ok");
}
