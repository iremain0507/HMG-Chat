// parser-types.ts — 문서 파서 계약 (knowledge 도메인 single source of truth).
//   03-ARCHITECTURE 원안은 파서를 Python(converter-worker)+PDF Gemini VLM 로 두지만,
//   LOCAL_ONLY dev 는 TS 네이티브 라이브러리(mammoth/xlsx/pdf-parse/jszip)로 dev-stub 구현한다
//   (integration owner 결정, 2026-07-13, 사용자 승인). 프로덕션은 converter-worker/VLM 으로 교체.
//   ⚠️ 이 타입은 server 내부 전용 → packages/interfaces(P0.5 frozen)에 두지 않는다.

export type ParsedFormat = "pdf" | "docx" | "pptx" | "xlsx";

/** 파서 출력 — chunker.chunkText(markdown) 로 바로 전달 가능한 markdown 텍스트. */
export interface ParsedDocument {
  format: ParsedFormat;
  /** 추출된 본문 (markdown). chunker 입력. */
  markdown: string;
  /** 페이지/슬라이드/시트 수 (있으면). */
  pageCount?: number;
  /** 파서별 부가 메타 (표 수, 이미지 수 등). */
  meta?: Record<string, unknown>;
}

/** 단일 포맷 파서. bytes → ParsedDocument. 외부 API 미사용(dev). */
export type DocumentParser = (input: {
  bytes: Buffer;
  filename: string;
}) => Promise<ParsedDocument>;

/** mimeType/확장자로 포맷을 판별해 알맞은 파서로 위임하는 파이프라인. */
export interface ParserPipeline {
  /** 지원 포맷이면 파싱, 아니면 throw(UNSUPPORTED_MEDIA_TYPE). */
  parse(input: {
    bytes: Buffer;
    mimeType: string;
    filename: string;
  }): Promise<ParsedDocument>;
  /** 지원 여부 판별 (라우트에서 415 응답에 사용). */
  supports(mimeType: string, filename: string): boolean;
}

/** mimeType/확장자 → ParsedFormat. 미지원이면 null. */
export function detectFormat(
  mimeType: string,
  filename: string,
): ParsedFormat | null {
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  if (mimeType.includes("pdf") || ext === "pdf") return "pdf";
  if (mimeType.includes("wordprocessingml") || ext === "docx") return "docx";
  if (mimeType.includes("presentationml") || ext === "pptx") return "pptx";
  if (mimeType.includes("spreadsheetml") || ext === "xlsx") return "xlsx";
  return null;
}
