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

describe("명령(/command) 검증 (P21-T6-17, UX-24)", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("'/' 로 시작하지 않는 명령은 제출을 거부하고 인라인 에러를 보여준다", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ data: [] }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    render(<PromptsManager />);

    await waitFor(() => {
      expect(
        screen.getByText("저장된 프롬프트가 없습니다."),
      ).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "＋ 프롬프트 추가" }));
    fireEvent.change(screen.getByLabelText("명령"), {
      target: { value: "greet" },
    });
    fireEvent.change(screen.getByLabelText("제목"), {
      target: { value: "인사" },
    });
    fireEvent.change(screen.getByLabelText("내용"), {
      target: { value: "안녕하세요" },
    });
    fireEvent.click(screen.getByRole("button", { name: "추가" }));

    expect(
      screen.getByText("명령은 '/'로 시작해야 합니다."),
    ).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalledWith(
      "/api/v1/prompts",
      expect.objectContaining({ method: "POST" }),
    );
  });
});

describe("포커스 트랩(useFocusTrap)", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  function stubEmptyList() {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ data: [] }),
      })),
    );
  }

  it("모달을 열면 첫 포커스 가능 요소(명령 입력)로 포커스가 이동한다", async () => {
    stubEmptyList();
    render(<PromptsManager />);

    await waitFor(() => {
      expect(
        screen.getByText("저장된 프롬프트가 없습니다."),
      ).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "＋ 프롬프트 추가" }));

    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByLabelText("명령"));
    });
  });

  it("Escape 를 누르면 모달이 닫힌다", async () => {
    stubEmptyList();
    render(<PromptsManager />);

    await waitFor(() => {
      expect(
        screen.getByText("저장된 프롬프트가 없습니다."),
      ).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "＋ 프롬프트 추가" }));
    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });

    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });

  it("Shift+Tab 은 다이얼로그 밖으로 벗어나지 않고 마지막 요소로 순환한다", async () => {
    stubEmptyList();
    render(<PromptsManager />);

    await waitFor(() => {
      expect(
        screen.getByText("저장된 프롬프트가 없습니다."),
      ).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "＋ 프롬프트 추가" }));

    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByLabelText("명령"));
    });

    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });

    await waitFor(() => {
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: "취소" }),
      );
    });
  });

  it("모달을 닫으면(Escape) 트리거 버튼(＋ 프롬프트 추가)으로 포커스가 복귀한다", async () => {
    stubEmptyList();
    render(<PromptsManager />);

    await waitFor(() => {
      expect(
        screen.getByText("저장된 프롬프트가 없습니다."),
      ).toBeInTheDocument();
    });

    const triggerButton = screen.getByRole("button", {
      name: "＋ 프롬프트 추가",
    });
    // fireEvent.click alone does not simulate the browser's implicit
    // focus-on-click for buttons in jsdom, so focus explicitly first
    // (mirrors real mouse-click behavior) for the hook to capture the
    // trigger as document.activeElement.
    triggerButton.focus();
    fireEvent.click(triggerButton);

    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });

    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(document.activeElement).toBe(triggerButton);
  });

  it("모달을 닫으면(취소 버튼) 트리거 버튼(＋ 프롬프트 추가)으로 포커스가 복귀한다", async () => {
    stubEmptyList();
    render(<PromptsManager />);

    await waitFor(() => {
      expect(
        screen.getByText("저장된 프롬프트가 없습니다."),
      ).toBeInTheDocument();
    });

    const triggerButton = screen.getByRole("button", {
      name: "＋ 프롬프트 추가",
    });
    triggerButton.focus();
    fireEvent.click(triggerButton);

    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "취소" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(document.activeElement).toBe(triggerButton);
  });
});
