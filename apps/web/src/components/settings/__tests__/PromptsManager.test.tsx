// @vitest-environment jsdom
// components/settings/PromptsManager.tsx — P19-T6-13: 프롬프트 라이브러리 CRUD 매니저.
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
import { PromptsManager } from "../PromptsManager";

const PROMPT_1 = {
  id: "prompt-1",
  command: "/greet",
  title: "인사",
  content: "안녕하세요 {{user}}",
  access: "private" as const,
  ownerId: "user-1",
  createdAt: "2026-04-01T00:00:00Z",
  updatedAt: "2026-04-01T00:00:00Z",
};

describe("PromptsManager", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("저장된 프롬프트 카드를 command·title 과 함께 표시한다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ data: [PROMPT_1] }),
      })),
    );

    render(<PromptsManager />);

    await waitFor(() => {
      expect(screen.getByText("/greet")).toBeInTheDocument();
    });
    expect(screen.getByText("인사")).toBeInTheDocument();
  });

  it("＋ 프롬프트 추가 모달에서 저장하면 POST 후 목록을 새로고침한다", async () => {
    const fetchMock = vi.fn(async (_url: string, opts?: RequestInit) => {
      if (opts?.method === "POST") {
        return { ok: true, json: async () => ({ data: PROMPT_1 }) };
      }
      return { ok: true, json: async () => ({ data: [] }) };
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<PromptsManager />);

    await waitFor(() => {
      expect(
        screen.getByText("저장된 프롬프트가 없습니다."),
      ).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "＋ 프롬프트 추가" }));
    fireEvent.change(screen.getByLabelText("명령"), {
      target: { value: "/greet" },
    });
    fireEvent.change(screen.getByLabelText("제목"), {
      target: { value: "인사" },
    });
    fireEvent.change(screen.getByLabelText("내용"), {
      target: { value: "안녕하세요 {{user}}" },
    });
    fireEvent.click(screen.getByRole("button", { name: "추가" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/v1/prompts",
        expect.objectContaining({ method: "POST" }),
      );
    });
  });

  it("삭제 버튼 클릭 시 DELETE 요청을 보내고 카드가 사라진다", async () => {
    const fetchMock = vi.fn(async (url: string, opts?: RequestInit) => {
      if (opts?.method === "DELETE") {
        return { ok: true, json: async () => ({}) };
      }
      return { ok: true, json: async () => ({ data: [PROMPT_1] }) };
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<PromptsManager />);

    await waitFor(() => {
      expect(screen.getByText("/greet")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "삭제" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/v1/prompts/prompt-1",
        expect.objectContaining({ method: "DELETE" }),
      );
    });
    expect(screen.queryByText("/greet")).not.toBeInTheDocument();
  });
});
