// @vitest-environment jsdom
// hooks/useAgents.ts — P22-T6-10 Agent registry(워크스페이스 커스텀 모델) 소비.
//   GET/POST/PATCH/DELETE /api/v1/agents 계약을 따른다.
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useAgents } from "../useAgents";

const AGENT_1 = {
  id: "agt-1",
  orgId: "org-1",
  name: "품질 분석가",
  description: "QMS 데이터를 분석한다",
  baseModel: "claude-sonnet-4-6",
  systemPrompt: "너는 품질 분석가다.",
  toolIds: ["web_search"],
  skillIds: [],
  projectIds: [],
  visibility: "org" as const,
  createdBy: "user-1",
  createdAt: "2026-07-18T00:00:00.000Z",
  updatedAt: "2026-07-18T00:00:00.000Z",
};

describe("useAgents", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("에이전트 목록을 로드한다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ data: [AGENT_1] }),
      })),
    );

    const { result } = renderHook(() => useAgents());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.agents).toHaveLength(1);
    expect(result.current.agents[0]?.name).toBe("품질 분석가");
    expect(fetch).toHaveBeenCalledWith(
      "/api/v1/agents",
      expect.objectContaining({ credentials: "include" }),
    );
  });

  it("create 는 POST 후 목록을 재조회한다", async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === "POST") {
          return {
            ok: true,
            status: 201,
            json: async () => ({ data: AGENT_1 }),
          };
        }
        const created = fetchMock.mock.calls.some(
          ([, i]) => (i as RequestInit | undefined)?.method === "POST",
        );
        return {
          ok: true,
          json: async () => ({ data: created ? [AGENT_1] : [] }),
        };
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useAgents());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.agents).toHaveLength(0);

    await act(async () => {
      await result.current.create({
        name: "품질 분석가",
        baseModel: "claude-sonnet-4-6",
        systemPrompt: "너는 품질 분석가다.",
      });
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/agents",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          name: "품질 분석가",
          baseModel: "claude-sonnet-4-6",
          systemPrompt: "너는 품질 분석가다.",
        }),
      }),
    );
    expect(result.current.agents).toHaveLength(1);
  });

  it("update 는 PATCH 후 목록을 재조회한다", async () => {
    const renamed = { ...AGENT_1, name: "품질 분석가 v2" };
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === "PATCH") {
          return { ok: true, json: async () => ({ data: renamed }) };
        }
        const patched = fetchMock.mock.calls.some(
          ([, i]) => (i as RequestInit | undefined)?.method === "PATCH",
        );
        return {
          ok: true,
          json: async () => ({ data: [patched ? renamed : AGENT_1] }),
        };
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useAgents());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.update("agt-1", { name: "품질 분석가 v2" });
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/agents/agt-1",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ name: "품질 분석가 v2" }),
      }),
    );
    expect(result.current.agents[0]?.name).toBe("품질 분석가 v2");
  });

  it("remove 는 DELETE 후 목록을 재조회한다", async () => {
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
          json: async () => ({ data: deleted ? [] : [AGENT_1] }),
        };
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useAgents());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.agents).toHaveLength(1);

    await act(async () => {
      await result.current.remove("agt-1");
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/agents/agt-1",
      expect.objectContaining({ method: "DELETE" }),
    );
    expect(result.current.agents).toHaveLength(0);
  });

  it("create 409(중복 이름) 시 서버 에러 메시지를 노출한다", async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === "POST") {
          return {
            ok: false,
            status: 409,
            json: async () => ({
              error: {
                code: "CONFLICT",
                message: "같은 이름의 에이전트가 이미 있습니다.",
              },
            }),
          };
        }
        return { ok: true, json: async () => ({ data: [] }) };
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useAgents());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.create({
        name: "품질 분석가",
        baseModel: "claude-sonnet-4-6",
      });
    });

    expect(result.current.error).toBe("같은 이름의 에이전트가 이미 있습니다.");
  });

  it("update 실패 시 에러 메시지를 노출한다", async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === "PATCH") {
          return {
            ok: false,
            status: 400,
            json: async () => ({
              error: {
                code: "INVALID_INPUT",
                message: "이름이 비어 있습니다.",
              },
            }),
          };
        }
        return { ok: true, json: async () => ({ data: [AGENT_1] }) };
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useAgents());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.update("agt-1", { name: "" });
    });

    expect(result.current.error).toBe("이름이 비어 있습니다.");
  });

  it("목록 조회 실패 시 에러를 노출하고 로딩을 끝낸다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 500,
        json: async () => ({}),
      })),
    );

    const { result } = renderHook(() => useAgents());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("에이전트 목록을 불러오지 못했습니다.");
    expect(result.current.agents).toHaveLength(0);
  });
});
