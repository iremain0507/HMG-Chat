import { test, expect } from "@playwright/test";

// e2e/connections.pw.ts — P22-T6-14 브라우저 검증(Layer 1).
//   /preview 의 connections-manager 섹션(ConnectionsManager)을 실제 chromium 으로 열어
//   추가 → 검증(verify) → 사용 토글이 실제 DOM/네트워크로 동작하는지 확인한다.
//   lib/connections.ts 의 fetch 는 실 서버 없이 재현 가능하도록 page.route() 로 목킹한다
//   (agent-gallery.pw.ts / mcp-servers-manager.pw.ts 와 동일 패턴).
const NOW = "2026-07-18T09:00:00.000Z";

type ConnRow = {
  id: string;
  orgId: string;
  name: string;
  kind: "openai-compatible";
  baseUrl: string;
  keyPrefix: string;
  enabled: boolean;
  verifiedAt: string | null;
  models: string[];
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

type Captured = { postBody?: Record<string, unknown>; verifyCount: number };

async function mockBackend(
  page: import("@playwright/test").Page,
  captured: Captured,
) {
  // 서버 계약: 응답에는 평문 키가 없고 keyPrefix 만 존재한다.
  let rows: ConnRow[] = [];

  await page.route("**/api/v1/connections/*/verify", (route) => {
    const id = route
      .request()
      .url()
      .match(/connections\/([^/]+)\/verify/)?.[1];
    captured.verifyCount += 1;
    const row = rows.find((r) => r.id === id);
    const verified: ConnRow = {
      ...(row as ConnRow),
      verifiedAt: NOW,
      models: ["gpt-4o-mini", "gpt-4o"],
    };
    rows = rows.map((r) => (r.id === id ? verified : r));
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: { verified: true, connection: verified },
        meta: { requestId: "req-verify" },
      }),
    });
  });

  await page.route("**/api/v1/connections/*", (route) => {
    const method = route.request().method();
    const id = route
      .request()
      .url()
      .match(/connections\/([^/?]+)/)?.[1];
    if (method === "PATCH") {
      const patch = JSON.parse(route.request().postData() ?? "{}") as {
        enabled?: boolean;
      };
      const updated = rows.map((r) =>
        r.id === id ? { ...r, ...patch, updatedAt: NOW } : r,
      );
      rows = updated;
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: rows.find((r) => r.id === id),
          meta: { requestId: "req-patch" },
        }),
      });
    }
    if (method === "DELETE") {
      rows = rows.filter((r) => r.id !== id);
      return route.fulfill({ status: 204, body: "" });
    }
    return route.continue();
  });

  await page.route("**/api/v1/connections", (route) => {
    const method = route.request().method();
    if (method === "POST") {
      const body = JSON.parse(route.request().postData() ?? "{}") as Record<
        string,
        unknown
      >;
      captured.postBody = body;
      const created: ConnRow = {
        id: "conn-new",
        orgId: "org-1",
        name: String(body.name),
        kind: "openai-compatible",
        baseUrl: String(body.baseUrl),
        keyPrefix: String(body.apiKey).slice(0, 7),
        enabled: true,
        verifiedAt: null,
        models: [],
        createdBy: "user-1",
        createdAt: NOW,
        updatedAt: NOW,
      };
      rows = [...rows, created];
      return route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({ data: created, meta: { requestId: "req-1" } }),
      });
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: rows, meta: { requestId: "req-list" } }),
    });
  });
}

test.describe("P22-T6-14 preview — 연결(Connections) 추가·검증·토글", () => {
  test("추가 폼 제출 → 검증 → 사용 토글이 실제 브라우저에서 동작한다", async ({
    page,
  }) => {
    const captured: Captured = { verifyCount: 0 };
    await mockBackend(page, captured);
    await page.goto("/preview");

    const section = page.getByTestId("preview-connections-manager");
    await section.getByTestId("connections-manager-preview-trigger").click();

    await expect(section.getByText("등록된 연결이 없습니다.")).toBeVisible();

    // 1) 추가
    await section.getByRole("button", { name: "＋ 연결 추가" }).click();
    const dialog = page.getByRole("dialog", { name: "연결 추가" });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("이름").fill("사내 vLLM");
    await dialog.getByLabel("Base URL").fill("https://llm.example.com/v1");
    await dialog.getByLabel("API 키").fill("sk-plaintextsecret");
    await dialog.getByRole("button", { name: "추가" }).click();

    await expect(dialog).toHaveCount(0);
    const card = section.getByTestId("connection-card-conn-new");
    await expect(card).toBeVisible();
    await expect(card).toContainText("사내 vLLM");
    await expect(card).toContainText("https://llm.example.com/v1");
    expect(captured.postBody).toMatchObject({
      name: "사내 vLLM",
      baseUrl: "https://llm.example.com/v1",
      apiKey: "sk-plaintextsecret",
    });
    // 평문 키는 화면 어디에도 남지 않는다(마스킹된 prefix 만).
    await expect(page.locator("body")).not.toContainText("sk-plaintextsecret");
    await expect(
      section.getByTestId("connection-verify-badge-conn-new"),
    ).toHaveText("미검증");

    // 2) 검증
    await section.getByRole("button", { name: "검증: 사내 vLLM" }).click();
    await expect(
      section.getByTestId("connection-verify-badge-conn-new"),
    ).toHaveText("검증됨");
    expect(captured.verifyCount).toBe(1);
    // 프로브가 돌려준 모델이 칩으로 반영된다.
    await expect(card.getByText("gpt-4o-mini")).toBeVisible();

    // 3) 사용 토글
    const toggle = section.getByRole("switch", { name: "사용: 사내 vLLM" });
    await expect(toggle).toHaveAttribute("aria-checked", "true");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "false");
  });
});
