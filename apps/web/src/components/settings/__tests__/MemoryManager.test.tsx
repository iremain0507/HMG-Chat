// @vitest-environment jsdom
// components/settings/MemoryManager.tsx — 18-FRONTEND-WIREFRAMES § 18.5.4 /settings/memories.
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
import { MemoryManager } from "../MemoryManager";

const MEMORY_1 = {
  id: "mem-1",
  userId: "user-1",
  category: "user" as const,
  content: "나는 영업본부 소속, 직무는 RFP 분석.",
  source: "auto-extract" as const,
  sessionId: null,
  pinned: true,
  metadata: null,
  createdAt: "2026-04-05T00:00:00Z",
  updatedAt: "2026-04-05T00:00:00Z",
};

describe("MemoryManager", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("메모리 목록을 표시한다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ data: [MEMORY_1] }),
      })),
    );

    render(<MemoryManager />);

    await waitFor(() => {
      expect(
        screen.getByText("나는 영업본부 소속, 직무는 RFP 분석."),
      ).toBeInTheDocument();
    });
  });

  it("새 메모리를 추가한다", async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === "POST") {
          return {
            ok: true,
            json: async () => ({
              data: {
                ...MEMORY_1,
                id: "mem-2",
                content: "5문장 이내로 요약해주세요.",
              },
            }),
          };
        }
        const alreadyCreated = fetchMock.mock.calls.some(
          ([, i]) => (i as RequestInit | undefined)?.method === "POST",
        );
        return {
          ok: true,
          json: async () => ({
            data: alreadyCreated
              ? [
                  {
                    ...MEMORY_1,
                    id: "mem-2",
                    content: "5문장 이내로 요약해주세요.",
                  },
                ]
              : [],
          }),
        };
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<MemoryManager />);
    await waitFor(() => {
      expect(screen.getByText("저장된 메모리가 없습니다.")).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText("새 메모리 내용"), {
      target: { value: "5문장 이내로 요약해주세요." },
    });
    fireEvent.click(screen.getByRole("button", { name: "+ 추가" }));

    await waitFor(() => {
      expect(
        screen.getByText("5문장 이내로 요약해주세요."),
      ).toBeInTheDocument();
    });
  });

  it("편집 버튼으로 내용을 수정한다", async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === "PATCH") {
          return {
            ok: true,
            json: async () => ({
              data: { ...MEMORY_1, content: "수정된 내용" },
            }),
          };
        }
        const patched = fetchMock.mock.calls.some(
          ([, i]) => (i as RequestInit | undefined)?.method === "PATCH",
        );
        return {
          ok: true,
          json: async () => ({
            data: [
              {
                ...MEMORY_1,
                content: patched ? "수정된 내용" : MEMORY_1.content,
              },
            ],
          }),
        };
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<MemoryManager />);
    await waitFor(() => {
      expect(
        screen.getByText("나는 영업본부 소속, 직무는 RFP 분석."),
      ).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "편집" }));
    const editBox = screen.getByLabelText(`${MEMORY_1.id} 편집 내용`);
    fireEvent.change(editBox, { target: { value: "수정된 내용" } });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));

    await waitFor(() => {
      expect(screen.getByText("수정된 내용")).toBeInTheDocument();
    });
  });

  it("핀 버튼으로 pinned 를 토글한다", async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === "PATCH") {
          return {
            ok: true,
            json: async () => ({ data: { ...MEMORY_1, pinned: false } }),
          };
        }
        return { ok: true, json: async () => ({ data: [MEMORY_1] }) };
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<MemoryManager />);
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "핀 해제" }),
      ).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "핀 해제" }));

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/memories/mem-1",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ pinned: false }),
      }),
    );
  });

  it("삭제 버튼으로 메모리를 제거한다", async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === "DELETE") {
          return { ok: true, status: 204, json: async () => ({}) };
        }
        const deleted = fetchMock.mock.calls.some(
          ([, i]) => (i as RequestInit | undefined)?.method === "DELETE",
        );
        return {
          ok: true,
          json: async () => ({ data: deleted ? [] : [MEMORY_1] }),
        };
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<MemoryManager />);
    await waitFor(() => {
      expect(
        screen.getByText("나는 영업본부 소속, 직무는 RFP 분석."),
      ).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "삭제" }));

    await waitFor(() => {
      expect(screen.getByText("저장된 메모리가 없습니다.")).toBeInTheDocument();
    });
  });

  it("카테고리 탭 클릭 시 category 쿼리로 재조회한다", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ data: [] }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    render(<MemoryManager />);
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/v1/memories",
        expect.anything(),
      );
    });

    fireEvent.click(screen.getByRole("button", { name: "피드백" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/v1/memories?category=feedback",
        expect.anything(),
      );
    });
  });

  it("추가 버튼 연속 클릭 시 POST 요청이 한 번만 발생한다(더블서밋 가드)", async () => {
    let resolveCreate: (() => void) | undefined;
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === "POST") {
          await new Promise<void>((res) => {
            resolveCreate = res;
          });
          return {
            ok: true,
            json: async () => ({
              data: { ...MEMORY_1, id: "mem-2", content: "새 메모리" },
            }),
          };
        }
        return { ok: true, json: async () => ({ data: [] }) };
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<MemoryManager />);
    await waitFor(() => {
      expect(screen.getByText("저장된 메모리가 없습니다.")).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText("새 메모리 내용"), {
      target: { value: "새 메모리" },
    });

    const addButton = screen.getByRole("button", { name: "+ 추가" });
    fireEvent.click(addButton);

    await waitFor(() => {
      expect(addButton).toBeDisabled();
    });

    // 첫 요청이 아직 pending 인 상태에서 재클릭 → no-op 이어야 한다.
    fireEvent.click(addButton);

    const postCalls = () =>
      fetchMock.mock.calls.filter(
        ([, i]) => (i as RequestInit | undefined)?.method === "POST",
      );
    expect(postCalls()).toHaveLength(1);

    resolveCreate!();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "+ 추가" })).not.toBeDisabled();
    });
    expect(postCalls()).toHaveLength(1);
  });

  it("삭제 버튼 연속 클릭 시 DELETE 요청이 한 번만 발생한다(더블서밋 가드)", async () => {
    let resolveDelete: (() => void) | undefined;
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === "DELETE") {
          await new Promise<void>((res) => {
            resolveDelete = res;
          });
          return { ok: true, status: 204, json: async () => ({}) };
        }
        const deleted = fetchMock.mock.calls.some(
          ([, i]) => (i as RequestInit | undefined)?.method === "DELETE",
        );
        return {
          ok: true,
          json: async () => ({ data: deleted ? [] : [MEMORY_1] }),
        };
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<MemoryManager />);
    await waitFor(() => {
      expect(
        screen.getByText("나는 영업본부 소속, 직무는 RFP 분석."),
      ).toBeInTheDocument();
    });

    const deleteButton = screen.getByRole("button", { name: "삭제" });
    fireEvent.click(deleteButton);

    await waitFor(() => {
      expect(deleteButton).toBeDisabled();
    });

    // 첫 삭제 요청이 아직 pending 인 상태에서 재클릭 → no-op 이어야 한다.
    fireEvent.click(deleteButton);

    const deleteCalls = () =>
      fetchMock.mock.calls.filter(
        ([, i]) => (i as RequestInit | undefined)?.method === "DELETE",
      );
    expect(deleteCalls()).toHaveLength(1);

    resolveDelete!();

    await waitFor(() => {
      expect(screen.getByText("저장된 메모리가 없습니다.")).toBeInTheDocument();
    });
    expect(deleteCalls()).toHaveLength(1);
  });
});
