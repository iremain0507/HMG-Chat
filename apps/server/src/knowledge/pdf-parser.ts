// pdf-parser.ts — parser-types.ts DocumentParser 계약, PDF 포맷.
//   dev-stub: pdf-parse(pdfjs-dist 래퍼) 로 텍스트만 추출(레이아웃/이미지 미보존).
import { PDFParse } from "pdf-parse";
import type { DocumentParser } from "./parser-types.js";

export const parsePdf: DocumentParser = async ({ bytes }) => {
  const parser = new PDFParse({ data: bytes });
  try {
    const result = await parser.getText();
    return {
      format: "pdf",
      markdown: result.text,
      pageCount: result.total,
    };
  } finally {
    await parser.destroy();
  }
};
