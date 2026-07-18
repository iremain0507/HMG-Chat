// knowledge-retrieval-pg-merge.test.ts — P22-T3-01: loadCandidates 가 project_documents 뿐 아니라
//   세션 ephemeral_chunks(0014) 까지 통합 조회해 하나의 candidate 풀로 병합하고, ephemeral 청크를
//   source="ephemeral" + uploadId/filename 로 태깅하는지 검증한다.
//   실 SQL 은 __tests__/integration/knowledge-retrieval-pg.test.ts(실 Postgres) 가 커버 —
//   여기서는 주입 executor 로 병합/태깅 로직만 결정론적으로 단언(gate 실행 가능, DB 불요).
import { describe, expect, it } from "vitest";
import { createKnowledgeRetrievalPgPort } from "../knowledge-retrieval-pg.js";

type Rows = { rows: Record<string, unknown>[] };

function fakeExecutor(handlers: {
  project?: (params: unknown[]) => Rows;
  ephemeral?: (params: unknown[]) => Rows;
}) {
  const calls: string[] = [];
  return {
    calls,
    query(text: string, params: unknown[]): Promise<Rows> {
      if (text.includes("ephemeral_chunks")) {
        calls.push("ephemeral");
        return Promise.resolve(handlers.ephemeral?.(params) ?? { rows: [] });
      }
      calls.push("project");
      return Promise.resolve(handlers.project?.(params) ?? { rows: [] });
    },
  };
}

const PROJECT_ROW = {
  id: "chunk-p-1",
  document_id: "doc-1",
  chunk_index: 0,
  content: "project widget guide",
  token_count: 12,
  embedding: null,
  metadata: {},
  created_at: new Date("2026-01-01T00:00:00Z"),
  filename: "widget-guide.pdf",
};

const EPHEMERAL_ROW = {
  id: "eph-db-1",
  upload_id: "upload-1",
  chunk_index: 0,
  page_number: 3,
  content: "session attachment chunk",
  embedding: [0.1, 0.2, 0.3],
  metadata: {},
  created_at: new Date("2026-01-02T00:00:00Z"),
  filename: "attachment.pdf",
};

describe("knowledge-retrieval-pg — project + ephemeral 통합 조회(P22-T3-01)", () => {
  it("project 와 ephemeral 청크를 하나의 candidate 풀로 병합하고 ephemeral 을 source=ephemeral 로 태깅한다", async () => {
    const exec = fakeExecutor({
      project: () => ({ rows: [PROJECT_ROW] }),
      ephemeral: () => ({ rows: [EPHEMERAL_ROW] }),
    });
    const port = createKnowledgeRetrievalPgPort({ pool: exec });

    const { candidates, sourceMetaByDocumentId } = await port.loadCandidates({
      projectId: "project-1",
      sessionId: "session-1",
    });

    expect(exec.calls).toContain("ephemeral");
    expect(candidates).toHaveLength(2);

    // ephemeral candidate 는 documentId 를 uploadId 별칭으로 재사용
    const ephemeral = candidates.find((c) => c.chunk.documentId === "upload-1");
    expect(ephemeral).toBeDefined();
    expect(ephemeral?.chunk.content).toBe("session attachment chunk");
    expect(ephemeral?.chunk.embedding).toEqual([0.1, 0.2, 0.3]);
    expect(ephemeral?.chunk.metadata).toMatchObject({ pageNumber: 3 });

    expect(sourceMetaByDocumentId.get("upload-1")).toEqual({
      source: "ephemeral",
      uploadId: "upload-1",
      filename: "attachment.pdf",
    });
    // project meta 는 그대로 유지
    expect(sourceMetaByDocumentId.get("doc-1")).toMatchObject({
      source: "project",
      documentId: "doc-1",
      filename: "widget-guide.pdf",
    });
  });

  it("projectId 가 없어도 세션 ephemeral 청크는 조회해 반환한다", async () => {
    const exec = fakeExecutor({
      ephemeral: () => ({ rows: [EPHEMERAL_ROW] }),
    });
    const port = createKnowledgeRetrievalPgPort({ pool: exec });

    const { candidates, sourceMetaByDocumentId } = await port.loadCandidates({
      projectId: undefined,
      sessionId: "session-1",
    });

    expect(exec.calls).toEqual(["ephemeral"]); // project 쿼리는 skip
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.chunk.documentId).toBe("upload-1");
    expect(sourceMetaByDocumentId.get("upload-1")?.source).toBe("ephemeral");
  });

  it("세션에 ephemeral 청크가 없으면 project-only 로 동작하고 에러가 없다", async () => {
    const exec = fakeExecutor({
      project: () => ({ rows: [PROJECT_ROW] }),
      ephemeral: () => ({ rows: [] }),
    });
    const port = createKnowledgeRetrievalPgPort({ pool: exec });

    const { candidates, sourceMetaByDocumentId } = await port.loadCandidates({
      projectId: "project-1",
      sessionId: "session-1",
    });

    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.chunk.documentId).toBe("doc-1");
    expect(sourceMetaByDocumentId.size).toBe(1);
    expect(sourceMetaByDocumentId.has("doc-1")).toBe(true);
  });
});
