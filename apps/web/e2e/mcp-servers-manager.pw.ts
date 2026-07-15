import { test, expect } from "@playwright/test";

// e2e/mcp-servers-manager.pw.ts — P13-T6-11 브라우저 검증(Layer 1).
//   /preview 의 mcp-servers-manager 섹션(McpServersManager, F10) 을 실제 chromium 으로 열어
//   상태 도트·스코프 배지·도구 N개 hover 팝오버·보안 배지 2종·등록 3단계 모달이
//   design-reference 핸드오프대로 렌더/동작하는지 검증한다. useMcpServers 의 fetch 는 실
//   서버 없이도 재현 가능하도록 page.route() 로 목킹한다(project-documents.pw.ts 와 동일 패턴).
const ACTIVE_SERVER = {
  id: "srv-1",
  orgId: "org-1",
  projectId: null,
  userId: "user-1",
  name: "사내 PLM",
  url: "https://mcp.wia.local/plm",
  transport: "streamable_http" as const,
  authHeaderName: null,
  authSecretArn: null,
  supportedTools: [
    { name: "bom.read", description: "BOM 조회", inputSchema: {} },
    { name: "part.update", description: "부품 갱신", inputSchema: {} },
  ],
  lastDiscoveredAt: "2026-07-16T00:00:00Z",
  status: "active" as const,
};

const DEGRADED_SERVER = {
  ...ACTIVE_SERVER,
  id: "srv-2",
  projectId: null,
  userId: null,
  name: "QMS",
  status: "degraded" as const,
};

async function mockBackend(page: import("@playwright/test").Page) {
  let created: (typeof ACTIVE_SERVER)[] = [];
  await page.route("**/api/v1/mcp-servers", (route) => {
    if (route.request().method() === "POST") {
      const body = JSON.parse(route.request().postData() ?? "{}");
      const discovered = {
        ...ACTIVE_SERVER,
        id: "srv-new",
        name: body.name,
        url: body.url,
        supportedTools: [
          { name: "stock.query", description: "재고 조회", inputSchema: {} },
        ],
      };
      created = [discovered];
      return route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({ data: discovered }),
      });
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: [ACTIVE_SERVER, DEGRADED_SERVER, ...created],
      }),
    });
  });
}

test.describe("P13 preview — 커넥터(MCP) 설정(F10) 핸드오프 정렬", () => {
  test("상태 도트·스코프·도구 팝오버·등록 3단계 모달이 렌더/동작한다(라이트)", async ({
    page,
  }) => {
    await mockBackend(page);
    await page.goto("/preview");

    const section = page.getByTestId("preview-mcp-servers-manager");
    await expect(section).toBeVisible();
    await section.getByTestId("mcp-servers-manager-preview-trigger").click();

    await expect(section.getByText("SSRF 가드 활성")).toBeVisible();
    await expect(section.getByText("도구 설명 변경 시 재승인")).toBeVisible();

    await expect(section.getByText("사내 PLM")).toBeVisible();
    await expect(section.getByText("개인")).toBeVisible();
    await expect(section.getByText("도구 2개")).toBeVisible();

    await expect(section.getByText("QMS")).toBeVisible();
    await expect(
      section.getByText(
        "도구 설명이 변경되었습니다 — 프롬프트 주입 방지를 위해 재승인이 필요합니다",
      ),
    ).toBeVisible();

    await section.getByTestId("mcp-tools-trigger-srv-1").hover();
    const popover = section.getByTestId("mcp-tools-popover-srv-1");
    await expect(popover).toBeVisible();
    await expect(popover.getByText("bom.read")).toBeVisible();
    await expect(popover.getByText("읽기 전용")).toBeVisible();
    await expect(popover.getByText("승인 필요")).toBeVisible();

    await section.getByRole("button", { name: "＋ 커넥터 등록" }).click();
    await expect(section.getByText("등록 모달 ① 정보 입력")).toBeVisible();

    await section.getByLabel("서버 이름").fill("SCM 재고 조회");
    await section.getByLabel("서버 URL").fill("https://mcp.wia.local/scm");
    await section.getByRole("button", { name: "다음 — 검증" }).click();

    await expect(section.getByText("② 검증·도구 발견")).toBeVisible();
    await expect(
      section.getByText("③ 발견된 도구 — 기본 정책 확인"),
    ).toBeVisible();
    await expect(section.getByText("stock.query")).toBeVisible();

    await section.getByRole("button", { name: "등록", exact: true }).click();
    await expect(section.getByRole("dialog")).toBeHidden();

    await section.scrollIntoViewIfNeeded();
    await section.screenshot({
      path: "../../.ralph/screenshots/mcp-servers-manager-light.png",
    });
  });

  test("다크 테마에서도 커넥터 카드가 정상 렌더된다", async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem("wchat-theme", "dark");
    });
    await mockBackend(page);
    await page.goto("/preview");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

    const section = page.getByTestId("preview-mcp-servers-manager");
    await section.getByTestId("mcp-servers-manager-preview-trigger").click();

    await expect(section.getByText("사내 PLM")).toBeVisible();
    await expect(section.getByText("QMS")).toBeVisible();

    await section.scrollIntoViewIfNeeded();
    await section.screenshot({
      path: "../../.ralph/screenshots/mcp-servers-manager-dark.png",
    });
  });
});
