// @vitest-environment jsdom
// hooks/useChannels.ts — P22-T6-12 채널(실시간 멀티유저 + @model 협업).
//   /api/v1/channels 계약: GET 목록 · POST 생성(201) · POST/:id/members(참여) ·
//   DELETE/:id/members/me(나가기) · GET/:id/messages · POST/:id/messages ·
//   POST/DELETE /:id/messages/:mid/reactions · GET/:id/stream(SSE).
//
//   실시간 경로(SSE)는 EventSource 를 스텁해 다른 사용자의 메시지가 리로드 없이
//   붙는지, 내가 보낸 메시지의 에코가 중복되지 않는지를 단언한다 — 이게 이 태스크의
//   본질(멀티유저 협업)이라 낙관적 전송만 검증하면 실사용 갭이 남는다(21-LOOP-LESSONS L1).
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useChannels, useChannelRoom } from "../useChannels";

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
// jsdom 에 EventSource 가 없다. 훅이 연 인스턴스를 잡아두고 테스트에서 직접
// 이벤트를 흘려보내 SSE 병합 로직(append/dedup/reaction)을 검증한다.
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

function stubEventSource() {
  instances.length = 0;
  vi.stubGlobal("EventSource", StubEventSource);
}

function lastStream(): StubEventSource {
  const es = instances.at(-1);
  if (!es) throw new Error("EventSource 가 열리지 않았다");
  return es;
}

// ---- fetch 스텁 -------------------------------------------------------------
interface Custom {
  ok: boolean;
  status?: number;
  body?: unknown;
}

function stubFetch(
  respond: (url: string, method: string) => Custom | null = () => null,
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
      return { ok: true, status: 200, json: async () => ({ data: [MSG_1] }) };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ data: [CHANNEL_1] }),
    };
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}

function methodOf(init: unknown): string | undefined {
  return (init as { method?: string } | undefined)?.method;
}

describe("useChannels", () => {
  beforeEach(() => {
    stubEventSource();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("채널 목록을 로드한다", async () => {
    stubFetch();
    const { result } = renderHook(() => useChannels());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.channels).toHaveLength(1);
    expect(result.current.channels[0]?.name).toBe("설비-보전");
    expect(fetch).toHaveBeenCalledWith(
      "/api/v1/channels",
      expect.objectContaining({ credentials: "include" }),
    );
  });

  it("create — POST 후 목록을 재조회한다", async () => {
    const mock = stubFetch((url, method) =>
      method === "POST" ? { ok: true, body: { data: CHANNEL_1 } } : null,
    );
    const { result } = renderHook(() => useChannels());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.create({ name: "신규채널" });
    });

    const post = mock.mock.calls.find(([, init]) => methodOf(init) === "POST");
    expect(post?.[0]).toBe("/api/v1/channels");
    expect((post?.[1] as { body: string }).body).toContain("신규채널");
    // 변이 후 재조회(GET)가 한 번 더 일어나 서버 상태를 단일 출처로 유지한다.
    expect(
      mock.mock.calls.filter(
        ([url, init]) =>
          url === "/api/v1/channels" && methodOf(init) === undefined,
      ),
    ).toHaveLength(2);
  });

  it("join — POST /:id/members 후 목록을 재조회한다", async () => {
    const mock = stubFetch((url, method) =>
      method === "POST" && url.endsWith("/members")
        ? { ok: true, body: {} }
        : null,
    );
    const { result } = renderHook(() => useChannels());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.join("ch-1");
    });

    const post = mock.mock.calls.find(([, init]) => methodOf(init) === "POST");
    expect(post?.[0]).toBe("/api/v1/channels/ch-1/members");
  });

  it("leave — DELETE /:id/members/me 를 호출한다", async () => {
    const mock = stubFetch((url, method) =>
      method === "DELETE" ? { ok: true, body: {} } : null,
    );
    const { result } = renderHook(() => useChannels());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.leave("ch-1");
    });

    const del = mock.mock.calls.find(([, init]) => methodOf(init) === "DELETE");
    expect(del?.[0]).toBe("/api/v1/channels/ch-1/members/me");
  });

  it("목록 로드 실패는 error 로 노출한다", async () => {
    stubFetch(() => ({ ok: false, status: 500, body: {} }));
    const { result } = renderHook(() => useChannels());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("채널 목록을 불러오지 못했습니다.");
  });
});

describe("useChannelRoom", () => {
  beforeEach(() => {
    stubEventSource();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("메시지를 오래된 순으로 로드하고 SSE 스트림을 연다", async () => {
    stubFetch();
    const { result } = renderHook(() => useChannelRoom("ch-1"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.messages).toHaveLength(1);
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/v1/channels/ch-1/messages"),
      expect.objectContaining({ credentials: "include" }),
    );
    expect(lastStream().url).toBe("/api/v1/channels/ch-1/stream");
  });

  it("다른 사용자의 channel_message 이벤트가 리로드 없이 목록에 붙는다", async () => {
    stubFetch();
    const { result } = renderHook(() => useChannelRoom("ch-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const incoming = {
      ...MSG_1,
      id: "msg-2",
      userId: "user-2",
      content: "3호기 온도 이상 확인했습니다.",
    };
    act(() => {
      lastStream().emit("channel_message", {
        type: "channel_message",
        message: incoming,
      });
    });

    expect(result.current.messages).toHaveLength(2);
    expect(result.current.messages[1]?.content).toBe(
      "3호기 온도 이상 확인했습니다.",
    );
  });

  it("내가 보낸 메시지가 스트림으로 되돌아와도 중복되지 않는다(dedup by id)", async () => {
    const created = {
      ...MSG_1,
      id: "msg-9",
      content: "내가 방금 보낸 메시지",
    };
    stubFetch((url, method) =>
      method === "POST" && url.endsWith("/messages")
        ? { ok: true, status: 201, body: { data: created } }
        : null,
    );
    const { result } = renderHook(() => useChannelRoom("ch-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.send("내가 방금 보낸 메시지");
    });
    expect(result.current.messages).toHaveLength(2);

    // 서버가 같은 메시지를 브로드캐스트로 되돌려 준다.
    act(() => {
      lastStream().emit("channel_message", {
        type: "channel_message",
        message: created,
      });
    });

    expect(result.current.messages).toHaveLength(2);
    expect(
      result.current.messages.filter((m) => m.id === "msg-9"),
    ).toHaveLength(1);
  });

  it("channel_reaction 이벤트를 로컬 리액션 집계에 반영한다", async () => {
    stubFetch();
    const { result } = renderHook(() => useChannelRoom("ch-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      lastStream().emit("channel_reaction", {
        type: "channel_reaction",
        messageId: "msg-1",
        emoji: "👍",
        userId: "user-2",
        op: "add",
      });
    });

    const reactions = result.current.messages[0]?.reactions ?? [];
    expect(reactions).toEqual([{ emoji: "👍", count: 1, reactedByMe: false }]);

    act(() => {
      lastStream().emit("channel_reaction", {
        type: "channel_reaction",
        messageId: "msg-1",
        emoji: "👍",
        userId: "user-2",
        op: "remove",
      });
    });
    expect(result.current.messages[0]?.reactions).toHaveLength(0);
  });

  it("리액션 토글은 낙관적으로 반영하고 실패하면 롤백한다", async () => {
    stubFetch((url, method) =>
      method === "POST" && url.includes("/reactions")
        ? { ok: false, status: 500, body: { error: { message: "실패" } } }
        : null,
    );
    const { result } = renderHook(() => useChannelRoom("ch-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.toggleReaction("msg-1", "👍");
    });

    // 서버가 거절했으므로 집계는 원래대로 비어 있어야 한다.
    expect(result.current.messages[0]?.reactions).toHaveLength(0);
    expect(result.current.error).toBeTruthy();
  });

  it("리액션 토글 성공 시 reactedByMe 가 켜지고 다시 누르면 DELETE 로 꺼진다", async () => {
    const mock = stubFetch((url) =>
      url.includes("/reactions") ? { ok: true, status: 201, body: {} } : null,
    );
    const { result } = renderHook(() => useChannelRoom("ch-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.toggleReaction("msg-1", "👍");
    });
    expect(result.current.messages[0]?.reactions).toEqual([
      { emoji: "👍", count: 1, reactedByMe: true },
    ]);

    await act(async () => {
      await result.current.toggleReaction("msg-1", "👍");
    });
    expect(result.current.messages[0]?.reactions).toHaveLength(0);

    const del = mock.mock.calls.find(([, init]) => methodOf(init) === "DELETE");
    expect(del?.[0]).toBe(
      `/api/v1/channels/ch-1/messages/msg-1/reactions/${encodeURIComponent("👍")}`,
    );
  });

  it("403 NOT_A_MEMBER 는 조용히 실패하지 않고 error 로 드러난다", async () => {
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
    const { result } = renderHook(() => useChannelRoom("ch-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.send("보내볼게요");
    });

    expect(result.current.error).toBe("채널 멤버만 메시지를 보낼 수 있습니다.");
    // 낙관적으로 붙였던 버블은 롤백된다(보내지지 않은 메시지를 남겨두면 오해를 부른다).
    expect(result.current.messages).toHaveLength(1);
  });

  it("channelId 가 바뀌면 이전 스트림을 닫고 새 스트림을 연다", async () => {
    stubFetch();
    const { rerender, result } = renderHook(
      ({ id }: { id: string }) => useChannelRoom(id),
      { initialProps: { id: "ch-1" } },
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    const first = lastStream();

    rerender({ id: "ch-2" });
    await waitFor(() => expect(instances).toHaveLength(2));

    expect(first.closed).toBe(true);
    expect(lastStream().url).toBe("/api/v1/channels/ch-2/stream");
  });

  it("언마운트 시 EventSource 를 닫는다", async () => {
    stubFetch();
    const { unmount, result } = renderHook(() => useChannelRoom("ch-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    const es = lastStream();

    unmount();
    expect(es.closed).toBe(true);
  });

  it("channelId 가 null 이면 스트림을 열지 않는다", async () => {
    stubFetch();
    renderHook(() => useChannelRoom(null));
    await waitFor(() => expect(instances).toHaveLength(0));
  });
});
