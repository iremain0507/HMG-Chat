import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { parseDocx } from "../docx-parser.js";

const fixturePath = fileURLToPath(
  new URL("./fixtures/single-paragraph.docx", import.meta.url),
);

describe("parseDocx", () => {
  it("단락 하나짜리 docx 를 markdown 텍스트로 변환한다", async () => {
    const bytes = readFileSync(fixturePath);
    const result = await parseDocx({
      bytes,
      filename: "single-paragraph.docx",
    });
    expect(result.format).toBe("docx");
    expect(result.markdown).toContain("Walking on imported air");
  });
});
