// @vitest-environment jsdom
// components/settings/ConnectionsManager.tsx — P22-T6-14: 외부 OpenAI 호환 provider 연결 관리.
//   ApiKeysManager.test.tsx 와 동일하게 global fetch 를 stub 하고 실제 DOM 이벤트로 단언한다.
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
import { ConnectionsManager } from "../ConnectionsManager";

const CONN_1 = {
  id: "conn-1",
  orgId: "org-1",
  name: "사내 vLLM",
  kind: "openai-compatible" as const,
  baseUrl: "https://llm.example.com/v1",
  keyPrefix: "sk-abcd",
  enabled: true,
  verifiedAt: null as string | null,
  models: ["qwen3-32b", "llama-3.1-70b"],
  createdBy: "user-1",
  createdAt: "2026-07-01T00:00:00.000Z",
  updatedAt: "2026-07-01T00:00:00.000Z",
};

function jsonRes(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

describe("ConnectionsManager", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("(a) 연결 카드를 name·baseUrl·마스킹된 keyPrefix·models 칩과 함께 렌더한다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonRes({ data: [CONN_1] })),
    );

    render(<ConnectionsManager />);

    await waitFor(() => {
      expect(screen.getByText("사내 vLLM")).toBeInTheDocument();
    });
    expect(screen.getByText("https://llm.example.com/v1")).toBeInTheDocument();
    // 마스킹: keyPrefix + 점, 평문 키는 어디에도 없다.
    expect(screen.getByText(/sk-abcd/)).toHaveTextContent(/sk-abcd[•·]/);
    expect(screen.getByTestId("connection-card-conn-1")).not.toHaveTextContent(
      "supersecretplaintext",
    );
    expect(screen.getByText("qwen3-32b")).toBeInTheDocument();
    expect(screen.getByText("llama-3.1-70b")).toBeInTheDocument();
    // 아직 검증 전 → 미검증 뱃지
    expect(
      screen.getByTestId("connection-verify-badge-conn-1"),
    ).toHaveTextContent("미검증");
  });

  it("(b) 추가 폼을 제출하면 POST /api/v1/connections 를 호출하고 목록에 반영한다", async () => {
    const created = { ...CONN_1, id: "conn-new", name: "OpenAI" };
    const fetchMock = vi.fn(async (url: string, opts?: RequestInit) => {
      if (opts?.method === "POST") return jsonRes({ data: created }, 201);
      return jsonRes({ data: [] });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<ConnectionsManager />);

    await waitFor(() => {
      expect(screen.getByText("등록된 연결이 없습니다.")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "＋ 연결 추가" }));
    fireEvent.change(screen.getByLabelText("이름"), {
      target: { value: "OpenAI" },
    });
    fireEvent.change(screen.getByLabelText("Base URL"), {
      target: { value: "https://api.openai.com/v1" },
    });
    fireEvent.change(screen.getByLabelText("API 키"), {
      target: { value: "sk-supersecretplaintext" },
    });
    fireEvent.click(screen.getByRole("button", { name: "추가" }));

    await waitFor(() => {
      const post = fetchMock.mock.calls.find(
        ([, o]) => (o as RequestInit | undefined)?.method === "POST",
      );
      expect(post).toBeTruthy();
      expect(post![0]).toBe("/api/v1/connections");
      expect(
        JSON.parse((post![1] as RequestInit).body as string),
      ).toMatchObject({
        name: "OpenAI",
        baseUrl: "https://api.openai.com/v1",
        apiKey: "sk-supersecretplaintext",
      });
    });

    expect(await screen.findByText("OpenAI")).toBeInTheDocument();
    // 평문 키가 목록에 절대 남지 않는다.
    expect(document.body.textContent).not.toContain("sk-supersecretplaintext");
  });

  it("(c) 검증 버튼을 누르면 POST verify 후 검증됨 뱃지로 갱신된다", async () => {
    const verifiedAt = "2026-07-18T09:00:00.000Z";
    const fetchMock = vi.fn(async (url: string, opts?: RequestInit) => {
      if (opts?.method === "POST" && url.endsWith("/verify")) {
        return jsonRes({
          data: {
            verified: true,
            connection: { ...CONN_1, verifiedAt },
          },
        });
      }
      return jsonRes({ data: [CONN_1] });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<ConnectionsManager />);

    await waitFor(() => {
      expect(
        screen.getByTestId("connection-verify-badge-conn-1"),
      ).toHaveTextContent("미검증");
    });

    fireEvent.click(screen.getByRole("button", { name: "검증: 사내 vLLM" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/v1/connections/conn-1/verify",
        expect.objectContaining({ method: "POST" }),
      );
    });
    await waitFor(() => {
      expect(
        screen.getByTestId("connection-verify-badge-conn-1"),
      ).toHaveTextContent("검증됨");
    });
  });

  it("(c-2) 검증 실패 시 검증 실패 뱃지로 갱신된다", async () => {
    const fetchMock = vi.fn(async (url: string, opts?: RequestInit) => {
      if (opts?.method === "POST" && url.endsWith("/verify")) {
        return jsonRes({
          data: {
            verified: false,
            message: "401 Unauthorized",
            connection: { ...CONN_1, verifiedAt: null },
          },
        });
      }
      return jsonRes({
        data: [{ ...CONN_1, verifiedAt: "2026-07-01T00:00:00.000Z" }],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<ConnectionsManager />);

    await waitFor(() => {
      expect(
        screen.getByTestId("connection-verify-badge-conn-1"),
      ).toHaveTextContent("검증됨");
    });

    fireEvent.click(screen.getByRole("button", { name: "검증: 사내 vLLM" }));

    await waitFor(() => {
      expect(
        screen.getByTestId("connection-verify-badge-conn-1"),
      ).toHaveTextContent("검증 실패");
    });
  });

  it("(d) 사용 토글을 누르면 PATCH enabled:false 를 보내고 상태가 반영된다", async () => {
    const fetchMock = vi.fn(async (url: string, opts?: RequestInit) => {
      if (opts?.method === "PATCH") {
        return jsonRes({ data: { ...CONN_1, enabled: false } });
      }
      return jsonRes({ data: [CONN_1] });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<ConnectionsManager />);

    const toggle = await screen.findByRole("switch", {
      name: "사용: 사내 vLLM",
    });
    expect(toggle).toHaveAttribute("aria-checked", "true");

    fireEvent.click(toggle);

    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(
        ([, o]) => (o as RequestInit | undefined)?.method === "PATCH",
      );
      expect(patch).toBeTruthy();
      expect(patch![0]).toBe("/api/v1/connections/conn-1");
      expect(JSON.parse((patch![1] as RequestInit).body as string)).toEqual({
        enabled: false,
      });
    });
    await waitFor(() => {
      expect(
        screen.getByRole("switch", { name: "사용: 사내 vLLM" }),
      ).toHaveAttribute("aria-checked", "false");
    });
  });

  it("(e) 삭제는 확인 단계를 거친 뒤 DELETE 를 보내고 카드가 사라진다", async () => {
    const fetchMock = vi.fn(async (url: string, opts?: RequestInit) => {
      if (opts?.method === "DELETE")
        return { ok: true, status: 204, json: async () => ({}) };
      return jsonRes({ data: [CONN_1] });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<ConnectionsManager />);

    await waitFor(() => {
      expect(screen.getByText("사내 vLLM")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "삭제: 사내 vLLM" }));
    // 확인 전에는 DELETE 가 나가지 않는다.
    expect(
      fetchMock.mock.calls.filter(
        ([, o]) => (o as RequestInit | undefined)?.method === "DELETE",
      ),
    ).toHaveLength(0);

    fireEvent.click(
      screen.getByRole("button", { name: "삭제 확인: 사내 vLLM" }),
    );

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/v1/connections/conn-1",
        expect.objectContaining({ method: "DELETE" }),
      );
    });
    await waitFor(() => {
      expect(screen.queryByText("사내 vLLM")).not.toBeInTheDocument();
    });
  });
});
