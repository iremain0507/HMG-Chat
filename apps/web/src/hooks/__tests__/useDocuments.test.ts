// @vitest-environment jsdom
// hooks/useDocuments.ts — 16-API-CONTRACT § 5 Project Documents 소비.
// GET /api/v1/documents?projectId= 로 목록 조회, POST /api/v1/documents(multipart) 로 업로드.
// P4-T3-08 구현이 동기(dev-stub)로 즉시 indexStatus="indexed" 를 반환하므로 폴링은 범위 밖.
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useDocuments } from "../useDocuments";

describe("useDocuments", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("문서 목록을 조회한다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          data: [
            {
              id: "doc-1",
              projectId: "proj-1",
              filename: "ABC社_RFP_v2.pdf",
              contentHash: "hash1",
              mimeType: "application/pdf",
              sizeBytes: 1024,
              indexStatus: "indexed",
              chunkCount: 12,
              indexedAt: "2026-04-01T00:00:00Z",
              failureReason: null,
              createdBy: "user-1",
              createdAt: "2026-04-01T00:00:00Z",
              updatedAt: "2026-04-01T00:00:00Z",
            },
          ],
        }),
      })),
    );

    const { result } = renderHook(() => useDocuments("proj-1"));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.documents).toHaveLength(1);
    expect(result.current.documents[0]?.filename).toBe("ABC社_RFP_v2.pdf");
    expect(fetch).toHaveBeenCalledWith(
      "/api/v1/documents?projectId=proj-1",
      expect.objectContaining({ credentials: "include" }),
    );
  });

  it("업로드하면 multipart POST 후 목록을 재조회하고 indexed 상태를 반영한다", async () => {
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (init?.method === "POST") {
          expect(init.body).toBeInstanceOf(FormData);
          return {
            ok: true,
            status: 201,
            json: async () => ({
              data: {
                id: "doc-2",
                projectId: "proj-1",
                filename: "proposal_draft.docx",
                contentHash: "hash2",
                mimeType:
                  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                sizeBytes: 2048,
                indexStatus: "indexed",
                chunkCount: 3,
                indexedAt: "2026-04-02T00:00:00Z",
                failureReason: null,
                createdBy: "user-1",
                createdAt: "2026-04-02T00:00:00Z",
                updatedAt: "2026-04-02T00:00:00Z",
              },
            }),
          };
        }
        if (url.includes("/api/v1/documents?projectId=")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              data: [
                {
                  id: "doc-2",
                  projectId: "proj-1",
                  filename: "proposal_draft.docx",
                  contentHash: "hash2",
                  mimeType:
                    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                  sizeBytes: 2048,
                  indexStatus: "indexed",
                  chunkCount: 3,
                  indexedAt: "2026-04-02T00:00:00Z",
                  failureReason: null,
                  createdBy: "user-1",
                  createdAt: "2026-04-02T00:00:00Z",
                  updatedAt: "2026-04-02T00:00:00Z",
                },
              ],
            }),
          };
        }
        throw new Error(`unexpected fetch: ${url}`);
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useDocuments("proj-1"));
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    const file = new File(["binary"], "proposal_draft.docx", {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
    await act(async () => {
      await result.current.upload(file);
    });

    expect(result.current.uploading).toBe(false);
    expect(result.current.documents).toHaveLength(1);
    expect(result.current.documents[0]?.indexStatus).toBe("indexed");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/documents",
      expect.objectContaining({ method: "POST", credentials: "include" }),
    );
  });

  it("업로드 실패 시 error 를 설정한다", async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === "POST") {
          return {
            ok: false,
            status: 415,
            json: async () => ({
              error: {
                code: "UNSUPPORTED_MEDIA_TYPE",
                message: "지원하지 않는 형식입니다.",
              },
            }),
          };
        }
        return { ok: true, status: 200, json: async () => ({ data: [] }) };
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useDocuments("proj-1"));
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    const file = new File(["binary"], "broken.exe", {
      type: "application/octet-stream",
    });
    await act(async () => {
      await result.current.upload(file);
    });

    expect(result.current.error).toBe("지원하지 않는 형식입니다.");
    expect(result.current.uploading).toBe(false);
  });
});
