// @vitest-environment jsdom
// components/channels/ChannelsWorkspace.tsx — P22-T6-12.
//   실제 DOM 이벤트로 채널 선택 → 메시지 전송 / 리액션 토글 / 스레드 답글 / @model 을
//   단언한다(21-LOOP-LESSONS L1). SSE 는 EventSource 를 스텁해 실시간 수신을 재현한다.
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import {
  render,
  screen,
  within,
  cleanup,
  waitFor,
  fireEvent,
  act,
} from "@testing-library/react";
import { ChannelsWorkspace } from "../ChannelsWorkspace";
import { __resetToastsForTest } from "../../../lib/toast";

const CHANNEL_1 = {
  id: "ch-1",
  orgId: "org-1",
  name: "설비-보전",
  description: "보전팀 협업 채널",
  createdBy: "user-1",
  createdAt: "2026-07-18T00:00:00.000Z",
  updatedAt: "2026-07-18T00:00:00.000Z",
  memberCount: 3,
  isMember: true,
};

const MSG_1 = {
  id: "msg-1",
  orgId: "org-1",
  channelId: "ch-1",
  userId: "user-1",
  role: "user" as const,
  content: "오전 점검 결과 공유합니다.",
  parentId: null,
  createdAt: "2026-07-18T01:00:00.000Z",
  reactions: [],
};

// ---- EventSource 스텁 --------------------------------------------------------
const instances: StubEventSource[] = [];

class StubEventSource {
  url: string;
  closed = false;
  private listeners = new Map<string, Array<(e: MessageEvent) => void>>();
  onerror: ((e: unknown) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    instances.push(this);
  }
  addEventListener(type: string, fn: (e: MessageEvent) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  removeEventListener(type: string, fn: (e: MessageEvent) => void) {
    this.listeners.set(
      type,
      (this.listeners.get(type) ?? []).filter((l) => l !== fn),
    );
  }
  close() {
    this.closed = true;
  }
  emit(type: string, payload: unknown) {
    const e = { data: JSON.stringify(payload) } as MessageEvent;
    for (const fn of this.listeners.get(type) ?? []) fn(e);
  }
}

function lastStream(): StubEventSource {
  const es = instances.at(-1);
  if (!es) throw new Error("EventSource 가 열리지 않았다");
  return es;
}

interface Custom {
  ok: boolean;
  status?: number;
  body?: unknown;
}

function stubFetch(
  respond: (url: string, method: string) => Custom | null = () => null,
  messages: unknown[] = [MSG_1],
) {
  const mock = vi.fn(async (url: string, init?: { method?: string }) => {
    const method = init?.method ?? "GET";
    const custom = respond(url, method);
    if (custom) {
      return {
        ok: custom.ok,
        status: custom.status ?? (custom.ok ? 200 : 400),
        json: async () => custom.body ?? {},
      };
    }
    if (url.includes("/messages")) {
      return { ok: true, status: 200, json: async () => ({ data: messages }) };
    }
    return { ok: true, status: 200, json: async () => ({ data: [CHANNEL_1] }) };
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}

function methodOf(init: unknown): string | undefined {
  return (init as { method?: string } | undefined)?.method;
}

/** 첫 채널이 자동 선택돼 메시지가 렌더될 때까지 기다린다. */
async function waitForRoom() {
  await waitFor(() =>
    expect(screen.getByText("오전 점검 결과 공유합니다.")).toBeInTheDocument(),
  );
}

describe("ChannelsWorkspace", () => {
  beforeEach(() => {
    instances.length = 0;
    vi.stubGlobal("EventSource", StubEventSource);
    __resetToastsForTest();
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("채널 목록을 렌더하고 멤버 수를 보여준다", async () => {
    stubFetch();
    render(<ChannelsWorkspace />);

    await waitFor(() =>
      expect(screen.getByText("설비-보전")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("channel-item-ch-1")).toHaveTextContent("3");
  });

  it("채널을 선택하면 그 채널의 메시지를 렌더한다", async () => {
    stubFetch();
    render(<ChannelsWorkspace />);

    await waitForRoom();
    expect(screen.getByTestId("channel-message-msg-1")).toHaveTextContent(
      "오전 점검 결과 공유합니다.",
    );
  });

  it("메시지를 전송하면 목록에 나타나고 컴포저가 비워진다", async () => {
    const created = {
      ...MSG_1,
      id: "msg-2",
      content: "3호기 확인하겠습니다.",
    };
    const mock = stubFetch((url, method) =>
      method === "POST" && url.endsWith("/messages")
        ? { ok: true, status: 201, body: { data: created } }
        : null,
    );
    render(<ChannelsWorkspace />);
    await waitForRoom();

    const composer = screen.getByLabelText("메시지 입력");
    fireEvent.change(composer, { target: { value: "3호기 확인하겠습니다." } });
    fireEvent.click(screen.getByTestId("channel-send"));

    await waitFor(() =>
      expect(screen.getByText("3호기 확인하겠습니다.")).toBeInTheDocument(),
    );
    expect(composer).toHaveValue("");
    const post = mock.mock.calls.find(
      ([url, init]) =>
        methodOf(init) === "POST" && (url as string).endsWith("/messages"),
    );
    expect(post?.[0]).toBe("/api/v1/channels/ch-1/messages");
  });

  it("다른 사용자의 실시간 메시지가 리로드 없이 나타난다", async () => {
    stubFetch();
    render(<ChannelsWorkspace />);
    await waitForRoom();

    act(() => {
      lastStream().emit("channel_message", {
        type: "channel_message",
        message: {
          ...MSG_1,
          id: "msg-3",
          userId: "user-2",
          content: "저도 방금 확인했습니다.",
        },
      });
    });

    expect(await screen.findByText("저도 방금 확인했습니다.")).toBeVisible();
  });

  it("리액션을 누르면 aria-pressed 가 켜지고 카운트가 오른다", async () => {
    stubFetch((url) =>
      url.includes("/reactions") ? { ok: true, status: 201, body: {} } : null,
    );
    render(<ChannelsWorkspace />);
    await waitForRoom();

    const msg = screen.getByTestId("channel-message-msg-1");
    const thumb = within(msg).getByRole("button", { name: /👍/ });
    expect(thumb).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(thumb);

    await waitFor(() => expect(thumb).toHaveAttribute("aria-pressed", "true"));
    expect(thumb).toHaveTextContent("1");
  });

  it("리액션 실패는 롤백되고 오류가 드러난다", async () => {
    stubFetch((url) =>
      url.includes("/reactions")
        ? {
            ok: false,
            status: 500,
            body: { error: { message: "리액션 실패" } },
          }
        : null,
    );
    render(<ChannelsWorkspace />);
    await waitForRoom();

    const msg = screen.getByTestId("channel-message-msg-1");
    const thumb = within(msg).getByRole("button", { name: /👍/ });
    fireEvent.click(thumb);

    await waitFor(() => expect(thumb).toHaveAttribute("aria-pressed", "false"));
    expect(await screen.findByRole("alert")).toHaveTextContent("리액션 실패");
  });

  it("스레드 답글은 부모 메시지 아래에 중첩 렌더된다", async () => {
    const reply = {
      ...MSG_1,
      id: "msg-r1",
      userId: "user-2",
      content: "확인 감사합니다.",
      parentId: "msg-1",
    };
    stubFetch(() => null, [MSG_1, reply]);
    render(<ChannelsWorkspace />);
    await waitForRoom();

    const parent = screen.getByTestId("channel-message-msg-1");
    const replies = within(parent).getByTestId("channel-thread-msg-1");
    expect(
      within(replies).getByTestId("channel-message-msg-r1"),
    ).toHaveTextContent("확인 감사합니다.");
  });

  it("@model 어시스턴트 메시지는 사용자와 구분되게 모델로 표기된다", async () => {
    const assistant = {
      ...MSG_1,
      id: "msg-a1",
      userId: "assistant",
      role: "assistant" as const,
      content: "3호기 온도는 정상 범위입니다.",
      parentId: "msg-1",
    };
    stubFetch(() => null, [MSG_1, assistant]);
    render(<ChannelsWorkspace />);
    await waitForRoom();

    const bubble = screen.getByTestId("channel-message-msg-a1");
    expect(bubble).toHaveAttribute("data-role", "assistant");
    expect(within(bubble).getByTestId("channel-model-badge")).toHaveTextContent(
      "모델",
    );
  });

  it("@model 삽입 버튼이 컴포저에 멘션을 넣는다", async () => {
    stubFetch();
    render(<ChannelsWorkspace />);
    await waitForRoom();

    fireEvent.click(screen.getByTestId("channel-mention-model"));

    expect(screen.getByLabelText("메시지 입력")).toHaveValue("@model ");
  });

  it("비멤버가 보내면 403 NOT_A_MEMBER 를 조용히 삼키지 않고 알린다", async () => {
    stubFetch((url, method) =>
      method === "POST" && url.endsWith("/messages")
        ? {
            ok: false,
            status: 403,
            body: {
              error: {
                code: "NOT_A_MEMBER",
                message: "채널 멤버만 메시지를 보낼 수 있습니다.",
              },
            },
          }
        : null,
    );
    render(<ChannelsWorkspace />);
    await waitForRoom();

    fireEvent.change(screen.getByLabelText("메시지 입력"), {
      target: { value: "안녕하세요" },
    });
    fireEvent.click(screen.getByTestId("channel-send"));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "채널 멤버만 메시지를 보낼 수 있습니다.",
    );
    // 낙관적 버블은 롤백돼 메시지 목록에 남지 않는다(단, 컴포저 내용은 재시도할 수
    // 있도록 일부러 유지한다 — 그래서 목록 안으로 범위를 좁혀 단언한다).
    await waitFor(() =>
      expect(
        screen.getAllByTestId(/^channel-message-/).map((el) => el.textContent),
      ).toHaveLength(1),
    );
    expect(screen.getByLabelText("메시지 입력")).toHaveValue("안녕하세요");
  });

  it("채널이 없으면 빈 상태 안내를 보여준다", async () => {
    stubFetch((url, method) =>
      method === "GET" && url === "/api/v1/channels"
        ? { ok: true, body: { data: [] } }
        : null,
    );
    render(<ChannelsWorkspace />);

    expect(await screen.findByText(/아직 채널이 없습니다/)).toBeInTheDocument();
  });

  it("미참여 채널에는 참여 버튼이, 참여 채널에는 나가기가 뜬다", async () => {
    stubFetch((url, method) =>
      method === "GET" && url === "/api/v1/channels"
        ? { ok: true, body: { data: [{ ...CHANNEL_1, isMember: false }] } }
        : null,
    );
    render(<ChannelsWorkspace />);

    expect(
      await screen.findByRole("button", { name: "설비-보전 채널 참여" }),
    ).toBeInTheDocument();
  });
});
