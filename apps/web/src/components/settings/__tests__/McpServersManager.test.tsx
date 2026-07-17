// @vitest-environment jsdom
// components/settings/McpServersManager.tsx — design-reference F10(커넥터 설정) 핸드오프
// 정렬(P13-T6-11): 상태 도트·스코프 배지·도구 N개 hover 팝오버·보안 배지 2종 + 등록 3단계 모달.
import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  waitFor,
  fireEvent,
  within,
} from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { McpServersManager } from "../McpServersManager";

const SERVER_1 = {
  id: "srv-1",
  orgId: "org-1",
  projectId: null,
  userId: "user-1",
  name: "내부 도구 서버",
  url: "https://mcp.internal.example.com",
  transport: "streamable_http" as const,
  authHeaderName: null,
  authSecretArn: null,
  supportedTools: [
    { name: "doc.search", description: "검색", inputSchema: {} },
    { name: "part.update", description: "갱신", inputSchema: {} },
  ],
  lastDiscoveredAt: "2026-07-13T00:00:00Z",
  status: "active" as const,
};

describe("McpServersManager", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("등록된 커넥터 카드를 상태 도트·스코프·도구 개수와 함께 표시한다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ data: [SERVER_1] }),
      })),
    );

    render(<McpServersManager />);

    await waitFor(() => {
      expect(screen.getByText("내부 도구 서버")).toBeInTheDocument();
    });
    expect(screen.getByText("개인")).toBeInTheDocument();
    expect(screen.getByText("도구 2개")).toBeInTheDocument();
    expect(screen.getByText("SSRF 가드 활성")).toBeInTheDocument();
    expect(screen.getByText("도구 설명 변경 시 재승인")).toBeInTheDocument();
  });

  it("도구 N개에 hover 하면 정책 배지가 포함된 도구 목록 팝오버가 뜬다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ data: [SERVER_1] }),
      })),
    );

    render(<McpServersManager />);
    await waitFor(() => screen.getByText("내부 도구 서버"));

    expect(
      screen.queryByTestId("mcp-tools-popover-srv-1"),
    ).not.toBeInTheDocument();

    fireEvent.mouseEnter(screen.getByTestId("mcp-tools-trigger-srv-1"));

    const popover = await screen.findByTestId("mcp-tools-popover-srv-1");
    expect(within(popover).getByText("doc.search")).toBeInTheDocument();
    expect(within(popover).getByText("읽기 전용")).toBeInTheDocument();
    expect(within(popover).getByText("승인 필요")).toBeInTheDocument();

    fireEvent.mouseLeave(screen.getByTestId("mcp-tools-trigger-srv-1"));
    await waitFor(() => {
      expect(
        screen.queryByTestId("mcp-tools-popover-srv-1"),
      ).not.toBeInTheDocument();
    });
  });

  it("degraded 상태는 재승인 배너와 변경 검토 버튼을 보여준다", async () => {
    const degraded = {
      ...SERVER_1,
      id: "srv-2",
      name: "QMS",
      status: "degraded" as const,
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ data: [degraded] }),
      })),
    );

    render(<McpServersManager />);
    await waitFor(() => screen.getByText("QMS"));

    expect(
      screen.getByText(
        "도구 설명이 변경되었습니다 — 프롬프트 주입 방지를 위해 재승인이 필요합니다",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "변경 검토" }),
    ).toBeInTheDocument();
  });

  it("＋ 커넥터 등록 클릭 시 3단계(정보 입력 → 발견 중 → 발견된 도구) 모달을 진행한다", async () => {
    const discovered = {
      ...SERVER_1,
      supportedTools: [
        { name: "stock.query", description: "조회", inputSchema: {} },
      ],
    };
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === "POST") {
          return { ok: true, json: async () => ({ data: discovered }) };
        }
        const created = fetchMock.mock.calls.some(
          ([, i]) => (i as RequestInit | undefined)?.method === "POST",
        );
        return {
          ok: true,
          json: async () => ({ data: created ? [discovered] : [] }),
        };
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<McpServersManager />);
    await waitFor(() => screen.getByText("등록된 커넥터가 없습니다."));

    fireEvent.click(screen.getByRole("button", { name: "＋ 커넥터 등록" }));
    expect(screen.getByText("등록 모달 ① 정보 입력")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("서버 이름"), {
      target: { value: discovered.name },
    });
    fireEvent.change(screen.getByLabelText("서버 URL"), {
      target: { value: discovered.url },
    });
    fireEvent.click(screen.getByRole("button", { name: "다음 — 검증" }));

    expect(screen.getByText("② 검증·도구 발견")).toBeInTheDocument();

    await waitFor(() => {
      expect(
        screen.getByText("③ 발견된 도구 — 기본 정책 확인"),
      ).toBeInTheDocument();
    });
    expect(screen.getByText("stock.query")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "등록" }));
    await waitFor(() => {
      expect(
        screen.queryByRole("dialog", { name: "커넥터 등록" }),
      ).not.toBeInTheDocument();
    });
  });

  describe("포커스 트랩(useFocusTrap)", () => {
    function stubEmptyFetch() {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => ({
          ok: true,
          json: async () => ({ data: [] }),
        })),
      );
    }

    it("모달 오픈 시 1단계 첫 포커스 가능 요소(서버 이름 입력)로 포커스가 이동한다", async () => {
      stubEmptyFetch();
      render(<McpServersManager />);
      await waitFor(() => screen.getByText("등록된 커넥터가 없습니다."));

      fireEvent.click(screen.getByRole("button", { name: "＋ 커넥터 등록" }));

      await waitFor(() => {
        expect(document.activeElement).toBe(screen.getByLabelText("서버 이름"));
      });
    });

    it("Escape 를 누르면 모달이 닫힌다", async () => {
      stubEmptyFetch();
      render(<McpServersManager />);
      await waitFor(() => screen.getByText("등록된 커넥터가 없습니다."));

      fireEvent.click(screen.getByRole("button", { name: "＋ 커넥터 등록" }));
      await waitFor(() => {
        expect(document.activeElement).toBe(screen.getByLabelText("서버 이름"));
      });

      fireEvent.keyDown(document, { key: "Escape" });

      await waitFor(() => {
        expect(
          screen.queryByRole("dialog", { name: "커넥터 등록" }),
        ).not.toBeInTheDocument();
      });
    });

    it("1단계에서 첫 요소에서 Shift+Tab 하면 마지막 요소(취소 버튼)로 순환한다", async () => {
      stubEmptyFetch();
      render(<McpServersManager />);
      await waitFor(() => screen.getByText("등록된 커넥터가 없습니다."));

      fireEvent.click(screen.getByRole("button", { name: "＋ 커넥터 등록" }));
      await waitFor(() => {
        expect(document.activeElement).toBe(screen.getByLabelText("서버 이름"));
      });

      fireEvent.keyDown(document.activeElement as Element, {
        key: "Tab",
        shiftKey: true,
      });

      await waitFor(() => {
        expect(document.activeElement).toBe(
          screen.getByRole("button", { name: "취소" }),
        );
      });
    });

    it("Escape 로 닫으면 트리거 버튼(＋ 커넥터 등록)으로 포커스가 복귀한다", async () => {
      stubEmptyFetch();
      render(<McpServersManager />);
      await waitFor(() => screen.getByText("등록된 커넥터가 없습니다."));

      const trigger = screen.getByRole("button", { name: "＋ 커넥터 등록" });
      // jsdom 의 fireEvent.click 은 실제 브라우저와 달리 클릭 시 자동 포커스를 주지
      // 않으므로, useFocusTrap 이 활성화 직전 activeElement(트리거)를 정확히 캡처하도록
      // 실제 브라우저의 "버튼 클릭 시 포커스" 동작을 명시적으로 재현한다.
      trigger.focus();
      fireEvent.click(trigger);
      await waitFor(() => {
        expect(document.activeElement).toBe(screen.getByLabelText("서버 이름"));
      });

      fireEvent.keyDown(document, { key: "Escape" });

      await waitFor(() => {
        expect(
          screen.queryByRole("dialog", { name: "커넥터 등록" }),
        ).not.toBeInTheDocument();
      });
      expect(document.activeElement).toBe(trigger);
    });

    it("취소 버튼으로 닫으면 트리거 버튼(＋ 커넥터 등록)으로 포커스가 복귀한다", async () => {
      stubEmptyFetch();
      render(<McpServersManager />);
      await waitFor(() => screen.getByText("등록된 커넥터가 없습니다."));

      const trigger = screen.getByRole("button", { name: "＋ 커넥터 등록" });
      trigger.focus();
      fireEvent.click(trigger);
      await waitFor(() => {
        expect(document.activeElement).toBe(screen.getByLabelText("서버 이름"));
      });

      fireEvent.click(screen.getByRole("button", { name: "취소" }));

      await waitFor(() => {
        expect(
          screen.queryByRole("dialog", { name: "커넥터 등록" }),
        ).not.toBeInTheDocument();
      });
      expect(document.activeElement).toBe(trigger);
    });
  });

  it("비활성화 버튼으로 커넥터를 제거한다", async () => {
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
          json: async () => ({ data: deleted ? [] : [SERVER_1] }),
        };
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<McpServersManager />);
    await waitFor(() => screen.getByText("내부 도구 서버"));

    fireEvent.click(screen.getByRole("button", { name: "비활성화" }));

    await waitFor(() => {
      expect(screen.getByText("등록된 커넥터가 없습니다.")).toBeInTheDocument();
    });
  });

  it("비활성화 클릭 중 재클릭해도 DELETE 요청이 한 번만 나가고, 진행 중 버튼은 비활성화된다(UX-17)", async () => {
    let resolveRemove: (() => void) | undefined;
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === "DELETE") {
          await new Promise<void>((res) => {
            resolveRemove = res;
          });
          return { ok: true, status: 204, json: async () => ({}) };
        }
        const deleted = fetchMock.mock.calls.some(
          ([, i]) => (i as RequestInit | undefined)?.method === "DELETE",
        );
        return {
          ok: true,
          json: async () => ({ data: deleted ? [] : [SERVER_1] }),
        };
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<McpServersManager />);
    await waitFor(() => screen.getByText("내부 도구 서버"));

    const removeButton = screen.getByRole("button", { name: "비활성화" });
    fireEvent.click(removeButton);

    await waitFor(() => {
      expect(removeButton).toBeDisabled();
    });

    fireEvent.click(removeButton);

    const deleteCallCount = () =>
      fetchMock.mock.calls.filter(
        ([, init]) => (init as RequestInit | undefined)?.method === "DELETE",
      ).length;
    expect(deleteCallCount()).toBe(1);

    resolveRemove?.();

    await waitFor(() => {
      expect(screen.getByText("등록된 커넥터가 없습니다.")).toBeInTheDocument();
    });
    expect(deleteCallCount()).toBe(1);
  });
});
