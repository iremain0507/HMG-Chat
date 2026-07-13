import { readFileSync } from "node:fs";
import { utils, write } from "xlsx";
import JSZip from "jszip";
import { describe, it, expect } from "vitest";
import {
  createParserPipeline,
  ParserPipelineError,
} from "../parser-pipeline.js";

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

function buildXlsxBytes(): Buffer {
  const sheet = utils.aoa_to_sheet([["a", "b"]]);
  const workbook = utils.book_new();
  utils.book_append_sheet(workbook, sheet, "Sheet1");
  return write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

async function buildPptxBytes(): Promise<Buffer> {
  const zip = new JSZip();
  zip.file(
    "ppt/slides/slide1.xml",
    '<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>slide</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>',
  );
  return zip.generateAsync({ type: "nodebuffer" });
}

const docxFixturePath = new URL(
  "./fixtures/single-paragraph.docx",
  import.meta.url,
);

describe("createParserPipeline", () => {
  it("supports() 는 4 포맷 모두 true, 그 외 false", () => {
    const pipeline = createParserPipeline();
    expect(pipeline.supports("application/pdf", "a.pdf")).toBe(true);
    expect(
      pipeline.supports(
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "a.docx",
      ),
    ).toBe(true);
    expect(
      pipeline.supports(
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "a.pptx",
      ),
    ).toBe(true);
    expect(
      pipeline.supports(
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "a.xlsx",
      ),
    ).toBe(true);
    expect(pipeline.supports("image/png", "a.png")).toBe(false);
  });

  it("4 포맷 모두 markdown 으로 변환한다", async () => {
    const pipeline = createParserPipeline();

    const pdf = await pipeline.parse({
      bytes: buildMinimalPdf("hello"),
      mimeType: "application/pdf",
      filename: "a.pdf",
    });
    expect(pdf.format).toBe("pdf");
    expect(pdf.markdown).toContain("hello");

    const docx = await pipeline.parse({
      bytes: readFileSync(docxFixturePath),
      mimeType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      filename: "a.docx",
    });
    expect(docx.format).toBe("docx");
    expect(docx.markdown).toContain("Walking on imported air");

    const xlsx = await pipeline.parse({
      bytes: buildXlsxBytes(),
      mimeType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      filename: "a.xlsx",
    });
    expect(xlsx.format).toBe("xlsx");
    expect(xlsx.markdown).toContain("| a | b |");

    const pptx = await pipeline.parse({
      bytes: await buildPptxBytes(),
      mimeType:
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      filename: "a.pptx",
    });
    expect(pptx.format).toBe("pptx");
    expect(pptx.markdown).toContain("slide");
  });

  it("미지원 mime 은 ParserPipelineError(UNSUPPORTED_MEDIA_TYPE) 를 throw 한다", async () => {
    const pipeline = createParserPipeline();
    await expect(
      pipeline.parse({
        bytes: Buffer.from("not a document"),
        mimeType: "image/png",
        filename: "a.png",
      }),
    ).rejects.toThrow(ParserPipelineError);
  });
});
