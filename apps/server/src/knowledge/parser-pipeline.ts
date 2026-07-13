// parser-pipeline.ts — parser-types.ts ParserPipeline 계약 구현.
//   detectFormat 으로 포맷 판별 후 알맞은 DocumentParser 로 위임, 미지원이면 415 매핑용 에러.
import { parseDocx } from "./docx-parser.js";
import { parsePdf } from "./pdf-parser.js";
import { parsePptx } from "./pptx-parser.js";
import { parseXlsx } from "./xlsx-parser.js";
import { detectFormat, type ParsedFormat } from "./parser-types.js";
import type { ParserPipeline } from "./parser-types.js";

export class ParserPipelineError extends Error {
  code: "UNSUPPORTED_MEDIA_TYPE";

  constructor(message: string) {
    super(message);
    this.code = "UNSUPPORTED_MEDIA_TYPE";
  }
}

const PARSERS: Record<ParsedFormat, typeof parsePdf> = {
  pdf: parsePdf,
  docx: parseDocx,
  pptx: parsePptx,
  xlsx: parseXlsx,
};

export function createParserPipeline(): ParserPipeline {
  return {
    supports(mimeType, filename) {
      return detectFormat(mimeType, filename) !== null;
    },
    async parse({ bytes, mimeType, filename }) {
      const format = detectFormat(mimeType, filename);
      if (!format) {
        throw new ParserPipelineError(
          `지원하지 않는 문서 형식입니다: ${mimeType || filename}`,
        );
      }
      return PARSERS[format]({ bytes, filename });
    },
  };
}
