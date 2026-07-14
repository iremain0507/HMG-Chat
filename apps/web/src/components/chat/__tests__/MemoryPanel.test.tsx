// @vitest-environment jsdom
// components/chat/MemoryPanel.tsx — P10-T6-14 채팅 내 메모리 노출/토글("/memories" 슬래시).
import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { MemoryPanel } from "../MemoryPanel";

describe("MemoryPanel", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("메모리 목록을 불러와 표시하고, 핀 토글 시 PATCH 요청을 보낸다", async () => {
    const fetchMock = vi.fn(async (url: string, opts?: RequestInit) => {
      if (opts?.method === "PATCH") {
        return { ok: true, json: async () => ({ data: {} }) };
      }
      return {
        ok: true,
        json: async () => ({
          data: [
            {
              id: "mem-1",
              userId: "user-1",
              category: "user",
              content: "사용자는 데이터 과학자다",
              source: "auto-extract",
              sessionId: null,
              pinned: false,
              metadata: null,
              createdAt: "2026-04-01T00:00:00Z",
              updatedAt: "2026-04-01T00:00:00Z",
            },
          ],
        }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<MemoryPanel onClose={() => {}} />);

    await waitFor(() => {
      expect(screen.getByText("사용자는 데이터 과학자다")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "고정" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/v1/memories/mem-1",
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({ pinned: true }),
        }),
      );
    });
  });

  it("닫기 버튼 클릭 시 onClose 가 호출된다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({ data: [] }) })),
    );
    const onClose = vi.fn();
    render(<MemoryPanel onClose={onClose} />);

    fireEvent.click(screen.getByRole("button", { name: "닫기" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("메모리가 없으면 빈 상태 문구를 보여준다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({ data: [] }) })),
    );
    render(<MemoryPanel onClose={() => {}} />);

    await waitFor(() => {
      expect(screen.getByText("저장된 메모리가 없습니다.")).toBeInTheDocument();
    });
  });
});
