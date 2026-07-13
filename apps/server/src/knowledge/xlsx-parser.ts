// xlsx-parser.ts — parser-types.ts DocumentParser 계약, XLSX 포맷.
//   dev-stub: sheetjs(xlsx) 로 각 시트를 markdown 표로 변환, 시트명을 헤딩으로 구분.
import { read, utils } from "xlsx";
import type { DocumentParser } from "./parser-types.js";

function rowsToMarkdownTable(rows: unknown[][]): string {
  if (rows.length === 0) return "";
  const header = rows[0] ?? [];
  const body = rows.slice(1);
  const cell = (v: unknown) => String(v ?? "").replace(/\|/g, "\\|");
  const headerLine = `| ${header.map(cell).join(" | ")} |`;
  const dividerLine = `| ${header.map(() => "---").join(" | ")} |`;
  const bodyLines = body.map((row) => `| ${row.map(cell).join(" | ")} |`);
  return [headerLine, dividerLine, ...bodyLines].join("\n");
}

export const parseXlsx: DocumentParser = async ({ bytes }) => {
  const workbook = read(bytes, { type: "buffer" });
  const tables = workbook.SheetNames.map((name) => {
    const sheet = workbook.Sheets[name];
    const rows = sheet
      ? (utils.sheet_to_json(sheet, { header: 1 }) as unknown[][])
      : [];
    return `## ${name}\n\n${rowsToMarkdownTable(rows)}`;
  });
  return {
    format: "xlsx",
    markdown: tables.join("\n\n"),
    pageCount: workbook.SheetNames.length,
    meta: { sheetNames: workbook.SheetNames },
  };
};
