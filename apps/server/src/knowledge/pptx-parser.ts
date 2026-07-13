// pptx-parser.ts — parser-types.ts DocumentParser 계약, PPTX 포맷.
//   dev-stub: jszip 로 압축 해제 후 ppt/slides/slideN.xml 의 <a:t> 텍스트 런만 추출(레이아웃 미보존).
import JSZip from "jszip";
import type { DocumentParser } from "./parser-types.js";

const SLIDE_PATH = /^ppt\/slides\/slide(\d+)\.xml$/;
const TEXT_RUN = /<a:t>([^<]*)<\/a:t>/g;

function extractSlideText(xml: string): string {
  const runs: string[] = [];
  for (const match of xml.matchAll(TEXT_RUN)) {
    if (match[1]) runs.push(match[1]);
  }
  return runs.join(" ");
}

export const parsePptx: DocumentParser = async ({ bytes }) => {
  const zip = await JSZip.loadAsync(bytes);
  const slideFiles = Object.keys(zip.files)
    .map((path) => ({ path, match: SLIDE_PATH.exec(path) }))
    .filter(
      (entry): entry is { path: string; match: RegExpExecArray } =>
        entry.match !== null,
    )
    .sort((a, b) => Number(a.match[1]) - Number(b.match[1]));

  const slides: string[] = [];
  for (const { path } of slideFiles) {
    const xml = await zip.files[path]?.async("string");
    slides.push(
      `## Slide ${slides.length + 1}\n\n${extractSlideText(xml ?? "")}`,
    );
  }

  return {
    format: "pptx",
    markdown: slides.join("\n\n"),
    pageCount: slides.length,
  };
};
