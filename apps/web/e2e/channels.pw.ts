import { test, expect } from "@playwright/test";

// e2e/channels.pw.ts — P22-T6-12 브라우저 검증(Layer 1).
//   /preview 의 channels-workspace 섹션(ChannelsWorkspace)을 실제 chromium 으로 열어
//   채널 선택 → 메시지 전송 / 리액션 토글 / 스레드 답글 / @model 어시스턴트 표기가
//   실 DOM·실 네트워크로 동작하는지 확인한다. REST 는 page.route() 로 목킹한다
//   (notes.pw.ts 와 동일 패턴).
//
//   SSE(GET /:id/stream)도 page.route 로 text/event-stream 본문을 채워 응답한다.
//   EventSource 가 아예 붙지 못하면 브라우저가 계속 재연결을 시도해 콘솔이 시끄러워지므로,
//   유효한 프레임 + 하트비트를 한 번 흘려 정상 연결을 흉내낸다. 실시간 병합 로직 자체
//   (append/dedup/reaction)는 RTL 유닛 테스트가 이벤트를 직접 주입해 검증한다.
const NOW = "2026-07-18T09:00:00.000Z";

type ChannelRow = {
  id: string;
  orgId: string;
  name: string;
  description: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  memberCount: number;
  isMember: boolean;
};

type Reaction = { emoji: string; count: number; reactedByMe: boolean };

type MessageRow = {
  id: string;
  orgId: string;
  channelId: string;
  userId: string;
  role: "user" | "assistant";
  content: string;
  parentId: string | null;
  createdAt: string;
  reactions: Reaction[];
};

const CHANNELS: ChannelRow[] = [
  {
    id: "ch-1",
    orgId: "org-1",
    name: "설비-보전",
    description: "보전팀 협업 채널",
    createdBy: "user-1",
    createdAt: NOW,
    updatedAt: NOW,
    memberCount: 3,
    isMember: true,
  },
  {
    id: "ch-2",
    orgId: "org-1",
    name: "품질-이슈",
    description: null,
    createdBy: "user-2",
    createdAt: NOW,
    updatedAt: NOW,
    memberCount: 5,
    isMember: true,
  },
];

function msg(over: Partial<MessageRow> & { id: string }): MessageRow {
  return {
    orgId: "org-1",
    channelId: "ch-1",
    userId: "user-1",
    role: "user",
    content: "",
    parentId: null,
    createdAt: NOW,
    reactions: [],
    ...over,
  };
}

const MESSAGES: Record<string, MessageRow[]> = {
  "ch-1": [
    msg({ id: "m1", content: "오전 점검 결과 공유합니다." }),
    msg({
      id: "m2",
      userId: "user-2",
      parentId: "m1",
      content: "확인 감사합니다.",
    }),
    msg({
      id: "m3",
      userId: "assistant",
      role: "assistant",
      parentId: "m1",
      content: "3호기 온도는 정상 범위입니다.",
    }),
  ],
  "ch-2": [
    msg({ id: "q1", channelId: "ch-2", content: "품질 이슈 트래킹 시작." }),
  ],
};

type Captured = {
  postedBodies: Record<string, unknown>[];
  reactionOps: string[];
};

async function mockBackend(
  page: import("@playwright/test").Page,
  captured: Captured,
) {
  const rows: Record<string, MessageRow[]> = {
    "ch-1": MESSAGES["ch-1"]!.map((m) => ({ ...m })),
    "ch-2": MESSAGES["ch-2"]!.map((m) => ({ ...m })),
  };
  let seq = 0;

  // SSE — 유효한 이벤트 프레임 하나 + 주석 하트비트로 연결을 성립시킨다.
  await page.route("**/api/v1/channels/*/stream", (route) =>
    route.fulfill({
      status: 200,
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
      },
      body: `event: ping\ndata: {"type":"ping"}\n\n: heartbeat\n\n`,
    }),
  );

  await page.route("**/api/v1/channels/*/messages/*/reactions/*", (route) => {
    if (route.request().method() === "DELETE") {
      captured.reactionOps.push(`remove ${route.request().url()}`);
      return route.fulfill({ status: 204, body: "" });
    }
    return route.fallback();
  });

  await page.route("**/api/v1/channels/*/messages/*/reactions", (route) => {
    if (route.request().method() === "POST") {
      captured.reactionOps.push(`add ${route.request().url()}`);
      return route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({ data: {}, meta: { requestId: "req-react" } }),
      });
    }
    return route.fallback();
  });

  await page.route("**/api/v1/channels/*/messages*", (route) => {
    const url = route.request().url();
    const channelId = url.match(/channels\/([^/]+)\/messages/)?.[1] as string;

    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON() as {
        content: string;
        parentId?: string;
      };
      captured.postedBodies.push(body);
      const created = msg({
        id: `new-${seq++}`,
        channelId,
        userId: "me",
        content: body.content,
        parentId: body.parentId ?? null,
      });
      rows[channelId] = [...(rows[channelId] ?? []), created];
      return route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({ data: created, meta: { requestId: "req-msg" } }),
      });
    }

    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: rows[channelId] ?? [],
        meta: { requestId: "req-msgs" },
      }),
    });
  });

  await page.route("**/api/v1/channels", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: CHANNELS,
        meta: { requestId: "req-list" },
      }),
    }),
  );
}

async function openWorkspace(page: import("@playwright/test").Page) {
  await page.goto("/preview");
  const section = page.getByTestId("preview-channels-workspace");
  await section.getByTestId("channels-workspace-preview-trigger").click();
  // 목록이 로드되면 첫 채널이 자동 선택돼 메시지가 채워진다.
  await expect(section.getByTestId("channel-message-m1")).toContainText(
    "오전 점검 결과 공유합니다.",
  );
  return section;
}

test.describe("P22-T6-12 채널 워크스페이스", () => {
  test("채널을 선택하면 그 채널의 메시지가 렌더된다", async ({ page }) => {
    const captured: Captured = { postedBodies: [], reactionOps: [] };
    await mockBackend(page, captured);
    const section = await openWorkspace(page);

    // 다른 채널로 전환하면 그 채널의 메시지로 교체된다.
    await section
      .getByRole("button", { name: /품질-이슈/ })
      .first()
      .click();

    await expect(section.getByTestId("channel-message-q1")).toContainText(
      "품질 이슈 트래킹 시작.",
    );
    await expect(section.getByTestId("channel-message-m1")).toHaveCount(0);
  });

  test("메시지를 보내면 목록에 나타난다", async ({ page }) => {
    const captured: Captured = { postedBodies: [], reactionOps: [] };
    await mockBackend(page, captured);
    const section = await openWorkspace(page);

    await section.getByLabel("메시지 입력").fill("4호기도 점검하겠습니다.");
    await section.getByTestId("channel-send").click();

    // 컴포저에도 같은 문자열이 잠시 남아 있으므로 메시지 버블로 범위를 좁혀 단언한다.
    await expect(
      section
        .locator('[data-testid^="channel-message-"]')
        .filter({ hasText: "4호기도 점검하겠습니다." })
        .first(),
    ).toBeVisible();
    await expect(section.getByLabel("메시지 입력")).toHaveValue("");
    expect(captured.postedBodies[0]?.content).toBe("4호기도 점검하겠습니다.");
  });

  test("리액션을 누르면 aria-pressed 와 카운트가 반영된다", async ({
    page,
  }) => {
    const captured: Captured = { postedBodies: [], reactionOps: [] };
    await mockBackend(page, captured);
    const section = await openWorkspace(page);

    const bubble = section.getByTestId("channel-message-m1");
    const thumb = bubble.getByRole("button", { name: /👍/ }).first();
    await expect(thumb).toHaveAttribute("aria-pressed", "false");

    await thumb.click();

    await expect(thumb).toHaveAttribute("aria-pressed", "true");
    await expect(thumb).toContainText("1");
    expect(captured.reactionOps[0]).toContain("add");

    // 다시 누르면 해제되고 DELETE 가 나간다.
    await thumb.click();
    await expect(thumb).toHaveAttribute("aria-pressed", "false");
    expect(captured.reactionOps[1]).toContain("remove");
  });

  test("스레드 답글은 부모 메시지 아래에 중첩된다", async ({ page }) => {
    const captured: Captured = { postedBodies: [], reactionOps: [] };
    await mockBackend(page, captured);
    const section = await openWorkspace(page);

    const parent = section.getByTestId("channel-message-m1");
    const thread = parent.getByTestId("channel-thread-m1");
    await expect(thread.getByTestId("channel-message-m2")).toContainText(
      "확인 감사합니다.",
    );
  });

  test("@model 어시스턴트 메시지는 모델로 표기된다", async ({ page }) => {
    const captured: Captured = { postedBodies: [], reactionOps: [] };
    await mockBackend(page, captured);
    const section = await openWorkspace(page);

    const assistant = section.getByTestId("channel-message-m3");
    await expect(assistant).toHaveAttribute("data-role", "assistant");
    await expect(assistant.getByTestId("channel-model-badge")).toHaveText(
      "모델",
    );

    // 컴포저의 @model 버튼이 멘션을 삽입한다.
    await section.getByTestId("channel-mention-model").click();
    await expect(section.getByLabel("메시지 입력")).toHaveValue("@model ");
  });
});
