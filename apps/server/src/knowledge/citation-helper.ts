// citation-helper.ts — text_delta 안 [N] 마커 추출/매칭 + HybridSearchResult → citation 변환.
//   08-SPRINT-PLAN.md Phase 4 citation-helper.test.ts 단일 출처. ChatEvent "citation" variant 형태 재사용.
import type { ChatEvent, HybridSearchResult } from "@wchat/interfaces";

export type Citation = Omit<Extract<ChatEvent, { type: "citation" }>, "type">;

export interface CitationSourceMeta {
  source: "project" | "ephemeral";
  documentId?: string;
  uploadId?: string;
  filename: string;
  title?: string;
  sourceUri?: string;
}

export const NO_RESULTS_MESSAGE = "관련 문서 없음";

const CITATION_MARKER_RE = /\[(\d+)\]/g;

export function extractCitationIndexes(text: string): number[] {
  const found = new Set<number>();
  for (const m of text.matchAll(CITATION_MARKER_RE)) {
    found.add(Number(m[1]));
  }
  return [...found].sort((a, b) => a - b);
}

export function buildCitations(
  hits: HybridSearchResult[],
  sourceMetaByDocumentId: Map<string, CitationSourceMeta>,
): Citation[] {
  return hits.map((hit, i) => {
    const meta = sourceMetaByDocumentId.get(hit.chunk.documentId);
    if (!meta) {
      throw new Error(
        `citation source meta missing for documentId=${hit.chunk.documentId}`,
      );
    }
    const pageNumber = hit.chunk.metadata.pageNumber;
    return {
      index: i + 1,
      source: meta.source,
      filename: meta.filename,
      snippet: hit.chunk.content.slice(0, 200),
      ...(meta.documentId !== undefined ? { documentId: meta.documentId } : {}),
      ...(meta.uploadId !== undefined ? { uploadId: meta.uploadId } : {}),
      ...(meta.title !== undefined ? { title: meta.title } : {}),
      ...(meta.sourceUri !== undefined ? { sourceUri: meta.sourceUri } : {}),
      ...(typeof pageNumber === "number" ? { page: pageNumber } : {}),
    };
  });
}

export function matchCitations(
  text: string,
  citations: Citation[],
): { allMatched: boolean; unmatchedIndexes: number[] } {
  const citationIndexes = new Set(citations.map((c) => c.index));
  const unmatchedIndexes = extractCitationIndexes(text).filter(
    (i) => !citationIndexes.has(i),
  );
  return { allMatched: unmatchedIndexes.length === 0, unmatchedIndexes };
}
