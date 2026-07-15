import { describe, it, expect } from "vitest";
import { parsePdf } from "../pdf-parser.js";

// 최소 유효 PDF(1페이지, 텍스트 1줄)를 바이트 오프셋까지 직접 계산해 인라인 구성.
// (외부 fixture 없이 pdf-parse/pdfjs-dist 가 실제로 파싱 가능한 최소 샘플)
function buildMinimalPdf(text: string): Buffer {
  const objects: Record<number, string> = {
    1: "<< /Type /Catalog /Pages 2 0 R >>",
    2: "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    3: "<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 5 0 R >> >> /MediaBox [0 0 300 300] /Contents 4 0 R >>",
    5: "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  };
  const streamContent = `BT /F1 24 Tf 10 250 Td (${text}) Tj ET`;
  objects[4] = `<< /Length ${streamContent.length} >>\nstream\n${streamContent}\nendstream`;

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [0];
  for (let i = 1; i <= 5; i++) {
    offsets.push(pdf.length);
    pdf += `${i} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xrefStart = pdf.length;
  pdf += `xref\n0 6\n0000000000 65535 f \n`;
  for (let i = 1; i <= 5; i++) {
    pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
  return Buffer.from(pdf, "latin1");
}

describe("parsePdf", () => {
  it("1페이지 PDF 의 텍스트를 추출한다", async () => {
    const bytes = buildMinimalPdf("Hello PDF");
    const result = await parsePdf({ bytes, filename: "test.pdf" });
    expect(result.format).toBe("pdf");
    expect(result.markdown).toContain("Hello PDF");
    expect(result.pageCount).toBe(1);
  });
});
