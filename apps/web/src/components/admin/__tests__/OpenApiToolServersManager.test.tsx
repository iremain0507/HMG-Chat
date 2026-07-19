// @vitest-environment jsdom
// components/admin/OpenApiToolServersManager.tsx — P22-T6-21(마무리 · admin UI · T1-12 완성용).
//   서버 API(GET/POST/DELETE /api/v1/openapi-tool-servers — P22-T1-12 에서 마운트·SSRF 방어 완료)를
//   소비하는 admin 패널. McpServersManager 를 미러하되 OpenAPI 고유 필드(specUrl/baseUrl/발견된
//   operation 목록)를 노출하고, 등록 실패(SSRF_BLOCKED/INVALID_SPEC)를 사용자에게 표면화한다.
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
import { OpenApiToolServersManager } from "../OpenApiToolServersManager";

const SERVER_1 = {
  id: "oas-1",
  orgId: "org-1",
  projectId: null,
  userId: null,
  name: "재고 API",
  specUrl: "https://api.example.com/openapi.json",
  baseUrl: "https://api.example.com",
  authHeaderName: null,
  authSecretArn: null,
  supportedTools: [
    {
      name: "openapi:oas-1:listParts",
      description: "부품 목록",
      inputSchema: { type: "object" },
      permissionTier: "safe",
      defaultPolicy: "auto",
    },
    {
      name: "openapi:oas-1:createOrder",
      description: "주문 생성",
      inputSchema: { type: "object" },
      permissionTier: "sensitive",
      defaultPolicy: "ask",
    },
  ],
  lastDiscoveredAt: "2026-07-18T00:00:00Z",
  status: "active" as const,
};

/** GET 은 항상 list 를 돌려주고, 그 외 메서드는 호출자가 넘긴 응답을 쓰는 fetch 스텁. */
function stubFetch(options: {
  list: unknown[];
  mutation?: { ok: boolean; status?: number; body?: unknown };
}) {
  const calls: Array<{ url: string; method: string; body?: string }> = [];
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    const method = (init?.method ?? "GET").toUpperCase();
    calls.push({
      url,
      method,
      ...(typeof init?.body === "string" ? { body: init.body } : {}),
    });
    if (method === "GET") {
      return {
        ok: true,
        status: 200,
        json: async () => ({ data: options.list }),
      };
    }
    const m = options.mutation ?? { ok: true, status: 204, body: {} };
    return {
      ok: m.ok,
      status: m.status ?? (m.ok ? 200 : 400),
      json: async () => m.body ?? {},
    };
  });
  vi.stubGlobal("fetch", fn);
  return calls;
}

describe("OpenApiToolServersManager", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("GET 목록을 이름·base URL·발견된 도구 개수와 함께 렌더한다", async () => {
    const calls = stubFetch({ list: [SERVER_1] });

    render(<OpenApiToolServersManager />);

    await waitFor(() => {
      expect(screen.getByText("재고 API")).toBeInTheDocument();
    });
    expect(
      calls.some(
        (c) =>
          c.method === "GET" && c.url.includes("/api/v1/openapi-tool-servers"),
      ),
    ).toBe(true);
    expect(screen.getByText("https://api.example.com")).toBeInTheDocument();
    expect(screen.getByText("도구 2개")).toBeInTheDocument();
  });

  it("등록 폼 제출 시 name·specUrl 로 POST 를 호출한다", async () => {
    const calls = stubFetch({
      list: [],
      mutation: { ok: true, status: 201, body: { data: SERVER_1 } },
    });

    render(<OpenApiToolServersManager />);
    await waitFor(() => {
      expect(
        screen.getByText("등록된 OpenAPI 툴서버가 없습니다."),
      ).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /툴서버 등록/ }));
    fireEvent.change(screen.getByLabelText("툴서버 이름"), {
      target: { value: "재고 API" },
    });
    fireEvent.change(screen.getByLabelText("OpenAPI 스펙 URL"), {
      target: { value: "https://api.example.com/openapi.json" },
    });
    fireEvent.click(screen.getByRole("button", { name: "등록" }));

    await waitFor(() => {
      const post = calls.find((c) => c.method === "POST");
      expect(post).toBeDefined();
      expect(JSON.parse(post!.body!)).toMatchObject({
        name: "재고 API",
        specUrl: "https://api.example.com/openapi.json",
      });
    });
  });

  it("등록 실패(SSRF_BLOCKED) 메시지를 화면에 표면화한다", async () => {
    stubFetch({
      list: [],
      mutation: {
        ok: false,
        status: 400,
        body: {
          error: {
            code: "SSRF_BLOCKED",
            message: "내부망 주소는 등록할 수 없습니다.",
          },
        },
      },
    });

    render(<OpenApiToolServersManager />);
    await waitFor(() => {
      expect(
        screen.getByText("등록된 OpenAPI 툴서버가 없습니다."),
      ).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /툴서버 등록/ }));
    fireEvent.change(screen.getByLabelText("툴서버 이름"), {
      target: { value: "내부" },
    });
    fireEvent.change(screen.getByLabelText("OpenAPI 스펙 URL"), {
      target: { value: "http://169.254.169.254/openapi.json" },
    });
    fireEvent.click(screen.getByRole("button", { name: "등록" }));

    await waitFor(() => {
      expect(
        screen.getByText("내부망 주소는 등록할 수 없습니다."),
      ).toBeInTheDocument();
    });
  });

  it("삭제 클릭 시 해당 id 로 DELETE 를 호출한다", async () => {
    const calls = stubFetch({ list: [SERVER_1] });

    render(<OpenApiToolServersManager />);
    await waitFor(() => {
      expect(screen.getByText("재고 API")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "재고 API 삭제" }));

    await waitFor(() => {
      expect(
        calls.some(
          (c) =>
            c.method === "DELETE" &&
            c.url.includes("/api/v1/openapi-tool-servers/oas-1"),
        ),
      ).toBe(true);
    });
  });

  it("도구 목록 토글로 발견된 operation 이름을 펼쳐 보여준다", async () => {
    stubFetch({ list: [SERVER_1] });

    render(<OpenApiToolServersManager />);
    await waitFor(() => {
      expect(screen.getByText("재고 API")).toBeInTheDocument();
    });

    const trigger = screen.getByRole("button", { name: "도구 2개" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(trigger);

    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("openapi:oas-1:listParts")).toBeInTheDocument();
    expect(screen.getByText("openapi:oas-1:createOrder")).toBeInTheDocument();
  });
});
