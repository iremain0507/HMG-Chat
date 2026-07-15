// docx-parser.ts — parser-types.ts DocumentParser 계약, DOCX 포맷.
//   dev-stub: mammoth.convertToMarkdown 로 본문을 markdown 으로 직접 추출.
import { convertToMarkdown } from "mammoth";
import type { DocumentParser } from "./parser-types.js";

export const parseDocx: DocumentParser = async ({ bytes }) => {
  const result = await convertToMarkdown({ buffer: bytes });
  return {
    format: "docx",
    markdown: result.value,
    meta: { messages: result.messages.length },
  };
};
