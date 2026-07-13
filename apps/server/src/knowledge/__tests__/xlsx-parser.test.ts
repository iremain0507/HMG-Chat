import { utils, write } from "xlsx";
import { describe, it, expect } from "vitest";
import { parseXlsx } from "../xlsx-parser.js";

function buildWorkbookBytes(): Buffer {
  const sheet = utils.aoa_to_sheet([
    ["name", "score"],
    ["alice", 90],
    ["bob", 80],
  ]);
  const workbook = utils.book_new();
  utils.book_append_sheet(workbook, sheet, "Sheet1");
  return write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

describe("parseXlsx", () => {
  it("시트를 markdown 표로 변환한다", async () => {
    const bytes = buildWorkbookBytes();
    const result = await parseXlsx({ bytes, filename: "test.xlsx" });
    expect(result.format).toBe("xlsx");
    expect(result.markdown).toContain("## Sheet1");
    expect(result.markdown).toContain("| name | score |");
    expect(result.markdown).toContain("| alice | 90 |");
    expect(result.pageCount).toBe(1);
  });
});
