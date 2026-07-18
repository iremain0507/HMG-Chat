import { test, expect } from "@playwright/test";

// e2e/agent-gallery.pw.ts — P22-T6-10 브라우저 검증(Layer 1).
//   /preview 의 agent-gallery 섹션(AgentGallery)을 실제 chromium 으로 열어 카드 그리드 ·
//   ＋ 에이전트 만들기 슬라이드오버 · POST 본문 · Escape 닫기가 동작하는지 검증한다.
//   useAgents 의 fetch 는 실 서버 없이 재현 가능하도록 page.route() 로 목킹한다
//   (mcp-servers-manager.pw.ts 와 동일 패턴).
const AGENT_ORG = {
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

const AGENT_PRIVATE = {
  ...AGENT_ORG,
  id: "agt-2",
  name: "도면 검토",
  description: null,
  visibility: "private" as const,
  toolIds: [],
};

type PostBody = Record<string, unknown>;

async function mockBackend(
  page: import("@playwright/test").Page,
  captured: { body?: PostBody },
) {
  let created: (typeof AGENT_ORG)[] = [];
  await page.route("**/api/v1/agents**", (route) => {
    const method = route.request().method();
    if (method === "POST") {
      const body = JSON.parse(route.request().postData() ?? "{}") as PostBody;
      captured.body = body;
      const agent = {
        ...AGENT_PRIVATE,
        id: "agt-new",
        name: String(body.name),
        description: (body.description as string | null) ?? null,
        systemPrompt: (body.systemPrompt as string | null) ?? null,
      };
      created = [agent];
      return route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({ data: agent, meta: { requestId: "req-1" } }),
      });
    }
    if (method === "DELETE") {
      return route.fulfill({ status: 204, body: "" });
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: [AGENT_ORG, AGENT_PRIVATE, ...created],
        meta: { requestId: "req-1" },
      }),
    });
  });
}

test.describe("P22 preview — 워크스페이스 에이전트 갤러리(Agent registry)", () => {
  test("카드 목록 → 만들기 슬라이드오버 → 저장 시 계약 본문으로 POST 하고 새 카드가 보인다(라이트)", async ({
    page,
  }) => {
    const captured: { body?: PostBody } = {};
    await mockBackend(page, captured);
    await page.goto("/preview");

    const section = page.getByTestId("preview-agent-gallery");
    await expect(section).toBeVisible();
    await section.getByTestId("agent-gallery-preview-trigger").click();

    await expect(section.getByTestId("agent-card-agt-1")).toBeVisible();
    await expect(section.getByText("품질 분석가")).toBeVisible();
    await expect(section.getByText("QMS 데이터를 분석한다")).toBeVisible();
    await expect(
      section.getByTestId("agent-card-agt-1").getByText("claude-sonnet-4-6"),
    ).toBeVisible();
    await expect(
      section.getByTestId("agent-card-agt-1").getByText("조직"),
    ).toBeVisible();
    await expect(
      section.getByTestId("agent-card-agt-2").getByText("비공개"),
    ).toBeVisible();

    await section.getByRole("button", { name: "＋ 에이전트 만들기" }).click();

    const dialog = page.getByRole("dialog", { name: "에이전트 만들기" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel("이름")).toBeFocused();

    await dialog.getByLabel("이름").fill("설비 진단");
    await dialog
      .getByLabel("시스템 프롬프트")
      .fill("너는 설비 로그 진단 전문가다.");
    await dialog.getByLabel("도구 IDs").fill("web_search, code_interpreter");
    await dialog.getByRole("button", { name: "저장" }).click();

    await expect(dialog).toBeHidden();
    await expect(section.getByTestId("agent-card-agt-new")).toBeVisible();

    expect(captured.body).toBeTruthy();
    expect(captured.body?.name).toBe("설비 진단");
    expect(captured.body?.systemPrompt).toBe("너는 설비 로그 진단 전문가다.");
    expect(captured.body?.toolIds).toEqual(["web_search", "code_interpreter"]);
    expect(captured.body?.visibility).toBe("private");
    expect(typeof captured.body?.baseModel).toBe("string");

    await section.scrollIntoViewIfNeeded();
    await section.screenshot({
      path: "../../.ralph/screenshots/agent-gallery-light.png",
    });
  });

  test("편집 슬라이드오버는 값이 프리필되고 Escape 로 닫히며 트리거로 포커스가 복귀한다", async ({
    page,
  }) => {
    await mockBackend(page, {});
    await page.goto("/preview");

    const section = page.getByTestId("preview-agent-gallery");
    await section.getByTestId("agent-gallery-preview-trigger").click();

    const editTrigger = section.getByRole("button", {
      name: "품질 분석가 편집",
    });
    await editTrigger.click();

    const dialog = page.getByRole("dialog", { name: "에이전트 편집" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel("이름")).toHaveValue("품질 분석가");
    await expect(dialog.getByLabel("시스템 프롬프트")).toHaveValue(
      "너는 품질 분석가다.",
    );

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(editTrigger).toBeFocused();
  });

  test("다크 테마에서도 에이전트 카드가 정상 렌더된다", async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem("wchat-theme", "dark");
    });
    await mockBackend(page, {});
    await page.goto("/preview");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

    const section = page.getByTestId("preview-agent-gallery");
    await section.getByTestId("agent-gallery-preview-trigger").click();

    await expect(section.getByTestId("agent-card-agt-1")).toBeVisible();
    await expect(section.getByTestId("agent-card-agt-2")).toBeVisible();

    await section.scrollIntoViewIfNeeded();
    await section.screenshot({
      path: "../../.ralph/screenshots/agent-gallery-dark.png",
    });
  });
});
