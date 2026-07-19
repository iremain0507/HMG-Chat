// ephemeral-indexer.ts — 세션 첨부(uploads) 인덱싱 생산측: parse→chunk→embed→row[].
//   순수 함수(DB 접근 없음) — 0014_uploads.sql ephemeral_chunks 컬럼과 1:1 매핑되는
//   행 배열을 반환한다. 실 INSERT 는 소비측(P20-T1-01, db/upload-service.ts)이 담당.
//   parser-pipeline.ts 는 pdf/docx/pptx/xlsx 만 지원(detectFormat) — text/plain,
//   text/markdown(.txt/.md) 은 파이프라인 미지원 포맷이라 bytes 를 UTF-8 markdown 으로
//   직접 취급한다. 그 외 미지원 포맷(이미지 등)은 throw 하지 않고 빈 배열(fail-soft,
//   21-LOOP-LESSONS L5 — 인덱싱 실패가 업로드 자체를 막아선 안 됨. 실 실패 로깅은
//   소비측 book-keeping 책임).
import type { EmbeddingProvider } from "@wchat/interfaces";
import { chunkText, type ChunkOptions } from "./chunker.js";
import type { ParserPipeline } from "./parser-types.js";

export interface EphemeralChunkRow {
  sessionId: string;
  uploadId: string;
  chunkIndex: number;
  pageNumber: number | null;
  content: string;
  embedding: number[];
  metadata: Record<string, unknown>;
}

export interface EphemeralIndexInput {
  bytes: Buffer;
  mimeType: string;
  filename: string;
  uploadId: string;
  sessionId: string;
}

export interface EphemeralIndexerDeps {
  parserPipeline: ParserPipeline;
  embeddingProvider: EmbeddingProvider;
  chunkOptions?: ChunkOptions;
}

const TEXT_EXTENSIONS = new Set(["txt", "md", "markdown"]);

function isPlainText(mimeType: string, filename: string): boolean {
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  return mimeType.startsWith("text/") || TEXT_EXTENSIONS.has(ext);
}

export async function indexEphemeralUpload(
  input: EphemeralIndexInput,
  deps: EphemeralIndexerDeps,
): Promise<EphemeralChunkRow[]> {
  const { bytes, mimeType, filename, uploadId, sessionId } = input;

  let markdown: string;
  if (deps.parserPipeline.supports(mimeType, filename)) {
    const parsed = await deps.parserPipeline.parse({
      bytes,
      mimeType,
      filename,
    });
    markdown = parsed.markdown;
  } else if (isPlainText(mimeType, filename)) {
    markdown = bytes.toString("utf-8");
  } else {
    return [];
  }

  const chunks = chunkText(markdown, deps.chunkOptions);
  if (chunks.length === 0) return [];

  const embeddings = await deps.embeddingProvider.embed(
    chunks.map((c) => c.content),
  );

  return chunks.map((c, i) => ({
    sessionId,
    uploadId,
    chunkIndex: c.chunkIndex,
    pageNumber: null,
    content: c.content,
    embedding: embeddings[i] ?? [],
    metadata: {},
  }));
}
