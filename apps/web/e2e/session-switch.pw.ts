import { test, expect } from "@playwright/test";

// e2e/session-switch.pw.ts — P21-T6-04(UX-16) 브라우저 검증(Layer 1).
//   /preview 의 session-switch 하네스(ChatView 를 언마운트하지 않고 sessionId prop 만
//   바꾸는, 실제 App Router 클라이언트 내비게이션과 동일한 시나리오)를 실 chromium 으로 열어
//   세션 A 히스토리를 본 뒤 세션 B 로 전환했을 때 A 의 메시지가 화면에 남지 않고 B 의
//   히스토리만 보이는지 검증한다(session-bulk-actions.pw.ts 와 동일 page.route 목킹 패턴).
async function mockBackend(page: import("@playwright/test").Page) {
  await page.route("**/api/v1/auth/me", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          user: {
            id: "user-1",
            email: "kim@example.com",
            name: "김민수",
            orgId: "org-1",
            role: "admin",
            customInstructions: null,
            createdAt: "2026-01-01T00:00:00Z",
          },
          org: null,
        },
      }),
    }),
  );
  await page.route("**/api/v1/prompts", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: [] }),
    }),
  );
  await page.route("**/api/v1/projects*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: [] }),
    }),
  );
  await page.route("**/api/v1/sessions/preview-session-a", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: { projectId: null } }),
    }),
  );
  await page.route("**/api/v1/sessions/preview-session-b", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: { projectId: null } }),
    }),
  );
  await page.route("**/api/v1/sessions/preview-session-a/messages", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: [
          { id: "a-1", role: "user", content: "세션 A 전용 메시지" },
          { id: "a-2", role: "assistant", content: "세션 A 답변입니다" },
        ],
      }),
    }),
  );
  await page.route("**/api/v1/sessions/preview-session-b/messages", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: [{ id: "b-1", role: "user", content: "세션 B 전용 메시지" }],
      }),
    }),
  );
  await page.route("**/api/v1/sessions/*/artifacts", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: [] }),
    }),
  );
  await page.route("**/api/v1/sessions/*/followups", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: { followups: [] } }),
    }),
  );
}

test("세션 전환 시 이전 세션 메시지가 사라지고 새 세션 히스토리만 보인다", async ({
  page,
}) => {
  await mockBackend(page);
  await page.goto("/preview");

  const section = page.getByTestId("preview-session-switch");
  // sr-only stream-announcer 라이브 리전이 메시지와 동일 텍스트를 중복 보유하므로
  // (strict-mode violation 회피) 실제 메시지 목록으로 범위를 좁혀 단언한다.
  const messageList = section.getByLabel("메시지 목록");
  await section.getByTestId("session-switch-a").click();

  await expect(messageList.getByText("세션 A 전용 메시지")).toBeVisible();
  await expect(messageList.getByText("세션 A 답변입니다")).toBeVisible();

  await section.getByTestId("session-switch-b").click();

  await expect(messageList.getByText("세션 B 전용 메시지")).toBeVisible();
  await expect(messageList.getByText("세션 A 전용 메시지")).toHaveCount(0);
  await expect(messageList.getByText("세션 A 답변입니다")).toHaveCount(0);
});
