// @vitest-environment jsdom
// components/projects/DocumentsPanel.tsx — 18-FRONTEND-WIREFRAMES § 18.5.3 "## 문서" 섹션.
// 업로드 UI(파일 선택 → multipart POST) + indexStatus 표시. P4-T3-08 이 동기 처리라 폴링은 범위 밖.
import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  waitFor,
  fireEvent,
} from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { DocumentsPanel } from "../DocumentsPanel";

describe("DocumentsPanel", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("문서 목록과 indexStatus 를 표시한다", async () => {
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

    render(<DocumentsPanel projectId="proj-1" />);

    await waitFor(() => {
      expect(screen.getByText("ABC社_RFP_v2.pdf")).toBeInTheDocument();
    });
    expect(screen.getByText("인덱스 완료")).toBeInTheDocument();
  });

  it("failed 문서는 실패 사유와 [다시 시도] 버튼을 표시하고, 클릭 시 재시도 API를 호출한다", async () => {
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (init?.method === "POST" && url.endsWith("/retry")) {
          return {
            ok: true,
            status: 202,
            json: async () => ({
              data: { documentId: "doc-9", indexStatus: "pending" },
            }),
          };
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: [
              {
                id: "doc-9",
                projectId: "proj-1",
                filename: "구형매뉴얼.pdf",
                contentHash: "hash9",
                mimeType: "application/pdf",
                sizeBytes: 12_000_000,
                indexStatus: "failed",
                chunkCount: 0,
                indexedAt: null,
                failureReason: "암호화된 PDF",
                createdBy: "user-1",
                createdAt: "2026-04-01T00:00:00Z",
                updatedAt: "2026-04-01T00:00:00Z",
              },
            ],
          }),
        };
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<DocumentsPanel projectId="proj-1" />);

    await waitFor(() => {
      expect(screen.getByText("암호화된 PDF")).toBeInTheDocument();
    });
    expect(screen.getByText("실패")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/v1/documents/doc-9/retry",
        expect.objectContaining({ method: "POST" }),
      );
    });
  });

  it("문서 행의 [삭제] 버튼 클릭 후 confirm 하면 DELETE API를 호출하고 목록에서 사라진다", async () => {
    const confirmSpy = vi.fn(() => true);
    vi.stubGlobal("confirm", confirmSpy);
    let deleted = false;
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === "DELETE") {
          deleted = true;
          return { ok: true, status: 204, json: async () => ({}) };
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: deleted
              ? []
              : [
                  {
                    id: "doc-1",
                    projectId: "proj-1",
                    filename: "삭제대상.pdf",
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
        };
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<DocumentsPanel projectId="proj-1" />);

    await waitFor(() => {
      expect(screen.getByText("삭제대상.pdf")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "문서 삭제" }));

    expect(confirmSpy).toHaveBeenCalled();
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/v1/documents/doc-1",
        expect.objectContaining({ method: "DELETE" }),
      );
    });
    await waitFor(() => {
      expect(screen.queryByText("삭제대상.pdf")).not.toBeInTheDocument();
    });
  });

  it("삭제 confirm 을 취소하면 DELETE 요청을 보내지 않고 행이 유지된다", async () => {
    const confirmSpy = vi.fn(() => false);
    vi.stubGlobal("confirm", confirmSpy);
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        data: [
          {
            id: "doc-1",
            projectId: "proj-1",
            filename: "유지문서.pdf",
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
    }));
    vi.stubGlobal("fetch", fetchMock);

    render(<DocumentsPanel projectId="proj-1" />);
    await waitFor(() => {
      expect(screen.getByText("유지문서.pdf")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "문서 삭제" }));

    expect(confirmSpy).toHaveBeenCalled();
    expect(
      fetchMock.mock.calls.some(
        ([, i]) => (i as RequestInit | undefined)?.method === "DELETE",
      ),
    ).toBe(false);
    expect(screen.getByText("유지문서.pdf")).toBeInTheDocument();
  });

  it("삭제 실패 시 role=alert 메시지를 표시하고 행을 유지한다", async () => {
    vi.stubGlobal(
      "confirm",
      vi.fn(() => true),
    );
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === "DELETE") {
          return {
            ok: false,
            status: 500,
            json: async () => ({
              error: {
                code: "INTERNAL",
                message: "삭제 중 오류가 발생했습니다.",
              },
            }),
          };
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: [
              {
                id: "doc-1",
                projectId: "proj-1",
                filename: "잔존문서.pdf",
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
        };
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<DocumentsPanel projectId="proj-1" />);
    await waitFor(() => {
      expect(screen.getByText("잔존문서.pdf")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "문서 삭제" }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        "삭제 중 오류가 발생했습니다.",
      );
    });
    expect(screen.getByText("잔존문서.pdf")).toBeInTheDocument();
  });

  it("인덱싱 진행 중(embedding) 문서는 실행 중 상태 어휘로 렌더된다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          data: [
            {
              id: "doc-5",
              projectId: "proj-1",
              filename: "e-COMP_사양서.docx",
              contentHash: "hash5",
              mimeType:
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
              sizeBytes: 3_400_000,
              indexStatus: "embedding",
              chunkCount: 0,
              indexedAt: null,
              failureReason: null,
              createdBy: "user-1",
              createdAt: "2026-04-01T00:00:00Z",
              updatedAt: "2026-04-01T00:00:00Z",
            },
          ],
        }),
      })),
    );

    render(<DocumentsPanel projectId="proj-1" />);

    await waitFor(() => {
      expect(screen.getByText("e-COMP_사양서.docx")).toBeInTheDocument();
    });
    const chip = screen.getByTestId("status-chip");
    expect(chip).toHaveAttribute("data-status", "running");
    expect(chip).toHaveTextContent("임베딩중");
  });

  it("파일을 선택하면 업로드 후 목록에 반영한다", async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === "POST") {
          return {
            ok: true,
            status: 201,
            json: async () => ({
              data: {
                id: "doc-2",
                projectId: "proj-1",
                filename: "proposal_draft.docx",
                contentHash: "hash2",
                mimeType: "application/octet-stream",
                sizeBytes: 100,
                indexStatus: "indexed",
                chunkCount: 1,
                indexedAt: "2026-04-02T00:00:00Z",
                failureReason: null,
                createdBy: "user-1",
                createdAt: "2026-04-02T00:00:00Z",
                updatedAt: "2026-04-02T00:00:00Z",
              },
            }),
          };
        }
        const alreadyUploaded = fetchMock.mock.calls.some(
          ([, i]) => (i as RequestInit | undefined)?.method === "POST",
        );
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: alreadyUploaded
              ? [
                  {
                    id: "doc-2",
                    projectId: "proj-1",
                    filename: "proposal_draft.docx",
                    contentHash: "hash2",
                    mimeType: "application/octet-stream",
                    sizeBytes: 100,
                    indexStatus: "indexed",
                    chunkCount: 1,
                    indexedAt: "2026-04-02T00:00:00Z",
                    failureReason: null,
                    createdBy: "user-1",
                    createdAt: "2026-04-02T00:00:00Z",
                    updatedAt: "2026-04-02T00:00:00Z",
                  },
                ]
              : [],
          }),
        };
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<DocumentsPanel projectId="proj-1" />);
    await waitFor(() => {
      expect(screen.getByText("업로드된 문서가 없습니다.")).toBeInTheDocument();
    });

    const file = new File(["binary"], "proposal_draft.docx", {
      type: "application/octet-stream",
    });
    const input = screen.getByTestId("document-file-input");
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => {
      expect(screen.getByText("proposal_draft.docx")).toBeInTheDocument();
    });
    expect(screen.getByText("인덱스 완료")).toBeInTheDocument();
  });
});
