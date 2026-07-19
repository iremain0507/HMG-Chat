// @vitest-environment jsdom
// components/agents/AgentGallery.tsx — P22-T6-10 워크스페이스 에이전트 갤러리
//   (Open WebUI Workspace › Models 참조 흐름): 카드 목록 · 만들기 · 편집 · 삭제.
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
import { AgentGallery } from "../AgentGallery";

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

const AGENT_2 = {
  ...AGENT_1,
  id: "agt-2",
  name: "설비 진단",
  description: null,
  visibility: "private" as const,
};

function stubList(agents: unknown[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => ({ data: agents }) })),
  );
}

describe("AgentGallery", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("로딩 중에는 안내 문구를 보여준다", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise(() => {})),
    );
    render(<AgentGallery />);
    expect(screen.getByText("불러오는 중…")).toBeInTheDocument();
  });

  it("에이전트가 없으면 빈 상태를 보여준다", async () => {
    stubList([]);
    render(<AgentGallery />);
    await waitFor(() => {
      expect(
        screen.getByText("등록된 에이전트가 없습니다."),
      ).toBeInTheDocument();
    });
  });

  it("카드에 이름·설명·기본 모델·공개 범위 배지를 표시한다", async () => {
    stubList([AGENT_1, AGENT_2]);
    render(<AgentGallery />);

    const card1 = await screen.findByTestId("agent-card-agt-1");
    expect(within(card1).getByText("품질 분석가")).toBeInTheDocument();
    expect(
      within(card1).getByText("QMS 데이터를 분석한다"),
    ).toBeInTheDocument();
    expect(within(card1).getByText("claude-sonnet-4-6")).toBeInTheDocument();
    expect(within(card1).getByText("조직")).toBeInTheDocument();

    const card2 = screen.getByTestId("agent-card-agt-2");
    expect(within(card2).getByText("설비 진단")).toBeInTheDocument();
    expect(within(card2).getByText("비공개")).toBeInTheDocument();
  });

  it("＋ 에이전트 만들기 → 입력 → 저장 시 POST 후 새 카드가 보인다", async () => {
    const created = { ...AGENT_2, id: "agt-new", name: "설비 진단" };
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === "POST") {
          return {
            ok: true,
            status: 201,
            json: async () => ({ data: created }),
          };
        }
        const done = fetchMock.mock.calls.some(
          ([, i]) => (i as RequestInit | undefined)?.method === "POST",
        );
        return {
          ok: true,
          json: async () => ({ data: done ? [created] : [] }),
        };
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<AgentGallery />);
    await waitFor(() =>
      expect(
        screen.getByText("등록된 에이전트가 없습니다."),
      ).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("button", { name: "＋ 에이전트 만들기" }));
    const dialog = await screen.findByRole("dialog");

    fireEvent.change(within(dialog).getByLabelText("이름"), {
      target: { value: "설비 진단" },
    });
    fireEvent.change(within(dialog).getByLabelText("시스템 프롬프트"), {
      target: { value: "너는 설비 진단 전문가다." },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "저장" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    const postCall = fetchMock.mock.calls.find(
      ([, i]) => (i as RequestInit | undefined)?.method === "POST",
    );
    expect(postCall?.[0]).toBe("/api/v1/agents");
    const body = JSON.parse(
      (postCall?.[1] as RequestInit).body as string,
    ) as Record<string, unknown>;
    expect(body.name).toBe("설비 진단");
    expect(body.systemPrompt).toBe("너는 설비 진단 전문가다.");
    expect(typeof body.baseModel).toBe("string");

    await waitFor(() => {
      expect(screen.getByTestId("agent-card-agt-new")).toBeInTheDocument();
    });
  });

  it("편집 버튼은 해당 에이전트 값이 프리필된 편집기를 열고 PATCH 한다", async () => {
    const renamed = { ...AGENT_1, name: "품질 분석가 v2" };
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === "PATCH") {
          return { ok: true, json: async () => ({ data: renamed }) };
        }
        const done = fetchMock.mock.calls.some(
          ([, i]) => (i as RequestInit | undefined)?.method === "PATCH",
        );
        return {
          ok: true,
          json: async () => ({ data: [done ? renamed : AGENT_1] }),
        };
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<AgentGallery />);
    await screen.findByTestId("agent-card-agt-1");

    fireEvent.click(screen.getByRole("button", { name: "품질 분석가 편집" }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByLabelText("이름")).toHaveValue("품질 분석가");

    fireEvent.change(within(dialog).getByLabelText("이름"), {
      target: { value: "품질 분석가 v2" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "저장" }));

    await waitFor(() => {
      const patchCall = fetchMock.mock.calls.find(
        ([, i]) => (i as RequestInit | undefined)?.method === "PATCH",
      );
      expect(patchCall?.[0]).toBe("/api/v1/agents/agt-1");
    });
    await waitFor(() => {
      expect(screen.getByText("품질 분석가 v2")).toBeInTheDocument();
    });
  });

  it("삭제 버튼은 DELETE 를 호출하고 카드를 제거한다", async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === "DELETE") {
          return { ok: true, status: 204, json: async () => ({}) };
        }
        const done = fetchMock.mock.calls.some(
          ([, i]) => (i as RequestInit | undefined)?.method === "DELETE",
        );
        return {
          ok: true,
          json: async () => ({ data: done ? [] : [AGENT_1] }),
        };
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<AgentGallery />);
    await screen.findByTestId("agent-card-agt-1");

    fireEvent.click(screen.getByRole("button", { name: "품질 분석가 삭제" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/v1/agents/agt-1",
        expect.objectContaining({ method: "DELETE" }),
      );
    });
    await waitFor(() => {
      expect(
        screen.getByText("등록된 에이전트가 없습니다."),
      ).toBeInTheDocument();
    });
  });

  it("서버 에러 메시지를 노출한다", async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === "POST") {
          return {
            ok: false,
            status: 409,
            json: async () => ({
              error: { code: "CONFLICT", message: "이름이 중복됩니다." },
            }),
          };
        }
        return { ok: true, json: async () => ({ data: [] }) };
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<AgentGallery />);
    await waitFor(() =>
      expect(
        screen.getByText("등록된 에이전트가 없습니다."),
      ).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("button", { name: "＋ 에이전트 만들기" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("이름"), {
      target: { value: "품질 분석가" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "저장" }));

    await waitFor(() => {
      expect(screen.getByText("이름이 중복됩니다.")).toBeInTheDocument();
    });
  });
});
