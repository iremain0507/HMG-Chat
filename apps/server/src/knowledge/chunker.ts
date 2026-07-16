// chunker.ts — markdown 텍스트를 오버랩 청크로 분할.
//   외부 tokenizer 의존성 없음(17-PROMPT-ASSETS §17.4 는 context-compactor 용으로 tiktoken 을
//   언급하나 T3/knowledge 경로엔 미지정 — 문자 기반 근사(4 chars/token)로 결정론적 tokenCount 산출,
//   실 tokenizer 는 배포 시 교체 가능). 14-INTERFACES § DocumentChunk.tokenCount 계약 채움.
//   기본값은 DEFAULT_ORG_SETTINGS(ragChunkSizeTokens/ragChunkOverlapTokens)를 단일 출처로 참조한다
//   (구 로컬 하드코딩 overlap=200 은 설정 기본값 100 과 불일치했던 버그).
import { DEFAULT_ORG_SETTINGS } from "../lib/org-settings-schema.js";

const CHARS_PER_TOKEN = 4;
// exactOptionalPropertyTypes: Required<OrgSettingsPatch> 도 zod `.optional()` 유래
// `| undefined` 를 보존하므로(messages.ts SAFE_DEFAULT_MAX_TOKENS 와 동일 사유) 최종 보강.
const DEFAULT_CHUNK_SIZE_TOKENS =
  DEFAULT_ORG_SETTINGS.ragChunkSizeTokens ?? 800;
const DEFAULT_OVERLAP_TOKENS =
  DEFAULT_ORG_SETTINGS.ragChunkOverlapTokens ?? 100;

export interface ChunkOptions {
  chunkSizeTokens?: number;
  overlapTokens?: number;
}

export interface TextChunk {
  chunkIndex: number;
  content: string;
  tokenCount: number;
}

export function estimateTokenCount(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

export function chunkText(text: string, opts: ChunkOptions = {}): TextChunk[] {
  const trimmed = text.trim();
  if (!trimmed) return [];

  const chunkSizeTokens = opts.chunkSizeTokens ?? DEFAULT_CHUNK_SIZE_TOKENS;
  const overlapTokens = opts.overlapTokens ?? DEFAULT_OVERLAP_TOKENS;
  const chunkSizeWords = Math.max(
    1,
    Math.floor((chunkSizeTokens * CHARS_PER_TOKEN) / "word ".length),
  );
  const overlapWords = Math.max(
    0,
    Math.floor((overlapTokens * CHARS_PER_TOKEN) / "word ".length),
  );

  const words = trimmed.split(/\s+/);
  const chunks: TextChunk[] = [];
  let start = 0;
  while (start < words.length) {
    const end = Math.min(start + chunkSizeWords, words.length);
    const content = words.slice(start, end).join(" ");
    chunks.push({
      chunkIndex: chunks.length,
      content,
      tokenCount: estimateTokenCount(content),
    });
    if (end >= words.length) break;
    start = end - overlapWords > start ? end - overlapWords : end;
  }
  return chunks;
}
