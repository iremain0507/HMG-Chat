import { test, expect } from "@playwright/test";

// e2e/openapi-tool-servers.pw.ts — P22-T6-21 브라우저 검증(Layer 1).
//   /preview 의 openapi-tool-servers 섹션(OpenApiToolServersManager)을 실제 chromium 으로 열어
//   등록 → 목록 반영 → 도구 펼치기 → 삭제 왕복이 실 DOM/네트워크로 동작하는지 확인한다.
//   서버(routes/openapi-tool-servers.ts, P22-T1-12)는 실 서버 없이 재현 가능하도록 page.route()
//   로 목킹한다(connections.pw.ts / mcp-servers-manager.pw.ts 와 동일 패턴).
//   목킹은 실제 서버 계약을 그대로 흉내낸다: POST 는 discovery 결과(supportedTools)를 동기 반환하고,
//   SSRF 차단은 400 + error.code=SSRF_BLOCKED 로 온다.

type ServerRow = {
  id: string;
  orgId: string;
  projectId: string | null;
  userId: string | null;
  name: string;
  specUrl: string;
  baseUrl: string;
  authHeaderName: string | null;
  authSecretArn: string | null;
  supportedTools: Array<{ name: string; description: string }>;
  lastDiscoveredAt: string | null;
  status: "active" | "degraded" | "suspended";
};

async function mockBackend(page: import("@playwright/test").Page) {
  let rows: ServerRow[] = [];

  // DELETE /:id — 목록 라우트보다 먼저 등록해야 :id 패턴이 먼저 매치된다.
  await page.route("**/api/v1/openapi-tool-servers/*", (route) => {
    if (route.request().method() !== "DELETE") return route.continue();
    const id = route.request().url().split("/").pop();
    rows = rows.filter((r) => r.id !== id);
    return route.fulfill({ status: 204, body: "" });
  });

  await page.route("**/api/v1/openapi-tool-servers", async (route) => {
    const method = route.request().method();
    if (method === "GET") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: rows, meta: { requestId: "req-list" } }),
      });
    }
    if (method === "POST") {
      const body = route.request().postDataJSON() as {
        name: string;
        specUrl: string;
      };
      // 실 서버의 SSRF 가드를 흉내 — 내부망 주소는 등록 전에 400 으로 거절된다.
      if (/169\.254\.|localhost|127\.0\.0\.1/.test(body.specUrl)) {
        return route.fulfill({
          status: 400,
          contentType: "application/json",
          body: JSON.stringify({
            error: {
              code: "SSRF_BLOCKED",
              category: "http",
              message: "내부망 주소는 등록할 수 없습니다.",
              retryable: false,
            },
          }),
        });
      }
      const created: ServerRow = {
        id: "oas-e2e-1",
        orgId: "org-1",
        projectId: null,
        userId: null,
        name: body.name,
        specUrl: body.specUrl,
        baseUrl: "https://api.example.com",
        authHeaderName: null,
        authSecretArn: null,
        supportedTools: [
          { name: "openapi:oas-e2e-1:listParts", description: "부품 목록" },
          { name: "openapi:oas-e2e-1:createOrder", description: "주문 생성" },
        ],
        lastDiscoveredAt: "2026-07-18T09:00:00.000Z",
        status: "active",
      };
      rows = [created];
      return route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          data: created,
          meta: { requestId: "req-create" },
        }),
      });
    }
    return route.continue();
  });
}

test.describe("OpenAPI 툴서버 admin 패널", () => {
  test("등록 → 목록 반영 → 도구 펼치기 → 삭제 왕복", async ({ page }) => {
    await mockBackend(page);
    await page.goto("/preview");

    const section = page.getByTestId("preview-openapi-tool-servers");
    await section.getByTestId("openapi-tool-servers-preview-trigger").click();

    await expect(
      section.getByText("등록된 OpenAPI 툴서버가 없습니다."),
    ).toBeVisible();

    // 등록
    await section.getByRole("button", { name: /툴서버 등록/ }).click();
    const dialog = page.getByRole("dialog", { name: "OpenAPI 툴서버 등록" });
    await dialog.getByLabel("툴서버 이름").fill("재고 API");
    await dialog
      .getByLabel("OpenAPI 스펙 URL")
      .fill("https://api.example.com/openapi.json");
    await dialog.getByRole("button", { name: "등록" }).click();

    // 성공 시 모달이 닫히고 목록에 반영된다.
    await expect(dialog).toBeHidden();
    await expect(section.getByText("재고 API")).toBeVisible();
    await expect(section.getByText("https://api.example.com")).toBeVisible();

    // 도구 펼치기 — 발견된 operation 이 실제로 화면에 나온다.
    const toolsToggle = section.getByRole("button", { name: "도구 2개" });
    await expect(toolsToggle).toHaveAttribute("aria-expanded", "false");
    await toolsToggle.click();
    await expect(toolsToggle).toHaveAttribute("aria-expanded", "true");
    await expect(
      section.getByText("openapi:oas-e2e-1:listParts"),
    ).toBeVisible();

    await page.screenshot({
      path: "../../.ralph/screenshots/P22-T6-21-registered.png",
      fullPage: false,
    });

    // 삭제 → 빈 상태로 복귀
    await section.getByRole("button", { name: "재고 API 삭제" }).click();
    await expect(
      section.getByText("등록된 OpenAPI 툴서버가 없습니다."),
    ).toBeVisible();
  });

  test("SSRF 차단 사유가 등록 폼에 표면화되고 모달이 유지된다", async ({
    page,
  }) => {
    await mockBackend(page);
    await page.goto("/preview");

    const section = page.getByTestId("preview-openapi-tool-servers");
    await section.getByTestId("openapi-tool-servers-preview-trigger").click();
    await section.getByRole("button", { name: /툴서버 등록/ }).click();

    const dialog = page.getByRole("dialog", { name: "OpenAPI 툴서버 등록" });
    await dialog.getByLabel("툴서버 이름").fill("메타데이터");
    await dialog
      .getByLabel("OpenAPI 스펙 URL")
      .fill("http://169.254.169.254/openapi.json");
    await dialog.getByRole("button", { name: "등록" }).click();

    // 사용자가 URL 을 고쳐 재시도할 수 있어야 하므로 모달은 열린 채 사유만 보인다.
    await expect(
      dialog.getByText("내부망 주소는 등록할 수 없습니다."),
    ).toBeVisible();
    await expect(dialog).toBeVisible();

    await page.screenshot({
      path: "../../.ralph/screenshots/P22-T6-21-ssrf-blocked.png",
      fullPage: false,
    });
  });
});
