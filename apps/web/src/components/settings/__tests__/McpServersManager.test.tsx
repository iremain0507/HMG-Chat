// @vitest-environment jsdom
// components/settings/McpServersManager.tsx — 18-FRONTEND-WIREFRAMES § 18.5.6 /settings/mcp.
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
  supportedTools: [],
  lastDiscoveredAt: null,
  status: "active" as const,
};

describe("McpServersManager", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("등록된 서버 목록을 표시한다", async () => {
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
    expect(
      screen.getByText("https://mcp.internal.example.com"),
    ).toBeInTheDocument();
  });

  it("추가 버튼으로 modal 을 열고 등록하면 discovery 성공을 표시한다", async () => {
    const discovered = {
      ...SERVER_1,
      supportedTools: [
        { name: "search", description: "검색", inputSchema: {} },
      ],
      lastDiscoveredAt: "2026-07-13T00:00:00Z",
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
    await waitFor(() => {
      expect(
        screen.getByText("등록된 MCP 서버가 없습니다."),
      ).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "+ 추가" }));

    fireEvent.change(screen.getByLabelText("서버 이름"), {
      target: { value: "내부 도구 서버" },
    });
    fireEvent.change(screen.getByLabelText("서버 URL"), {
      target: { value: "https://mcp.internal.example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "등록" }));

    await waitFor(() => {
      expect(screen.getByText("discovery 성공 (1개 도구)")).toBeInTheDocument();
    });
  });

  it("삭제 버튼으로 서버를 제거한다", async () => {
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
    await waitFor(() => {
      expect(screen.getByText("내부 도구 서버")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "삭제" }));

    await waitFor(() => {
      expect(
        screen.getByText("등록된 MCP 서버가 없습니다."),
      ).toBeInTheDocument();
    });
  });
});
