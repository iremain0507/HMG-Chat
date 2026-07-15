import JSZip from "jszip";
import { describe, it, expect } from "vitest";
import { parsePptx } from "../pptx-parser.js";

function slideXml(text: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
       xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>${text}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld>
</p:sld>`;
}

async function buildPptxBytes(): Promise<Buffer> {
  const zip = new JSZip();
  zip.file("ppt/slides/slide1.xml", slideXml("First slide text"));
  zip.file("ppt/slides/slide2.xml", slideXml("Second slide text"));
  return zip.generateAsync({ type: "nodebuffer" });
}

describe("parsePptx", () => {
  it("각 슬라이드의 텍스트를 순서대로 추출한다", async () => {
    const bytes = await buildPptxBytes();
    const result = await parsePptx({ bytes, filename: "test.pptx" });
    expect(result.format).toBe("pptx");
    expect(result.pageCount).toBe(2);
    const firstIdx = result.markdown.indexOf("First slide text");
    const secondIdx = result.markdown.indexOf("Second slide text");
    expect(firstIdx).toBeGreaterThan(-1);
    expect(secondIdx).toBeGreaterThan(firstIdx);
  });
});
