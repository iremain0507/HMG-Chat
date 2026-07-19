import { test, expect } from "@playwright/test";

// e2e/conversation-share.pw.ts — P20-T1-08 대화 스냅샷 공유 브라우저 검증(Layer 1).
//   /preview 의 conversation-share-public-view 섹션을 실제 chromium 으로 열어 정상/410
//   상태가 design-reference 핸드오프 토큰(시맨틱 색·radius·포커스 링)대로 렌더되는지 검증한다.
//   ConversationSharePublicView 는 useConversationShare 훅이 실 fetch 를 수행하므로 page.route
//   로 /api/v1/conversation-shares/:token 응답을 가로채 정상/410 상태를 결정론적으로 재현한다.

async function stubConversationShareRoutes(
  page: import("@playwright/test").Page,
) {
  await page.route(
    "**/api/v1/conversation-shares/preview-conversation-ok",
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: {
            token: "preview-conversation-ok",
            sessionId: "session-preview",
            title: "이번 분기 매출 분석",
            capturedAt: "2026-07-17T00:00:00.000Z",
            messages: [
              {
                id: "m1",
                role: "user",
                content: "이번 분기 매출 요약해줘",
                createdAt: "2026-07-17T00:00:00.000Z",
              },
              {
                id: "m2",
                role: "assistant",
                content: "이번 분기 매출은 전분기 대비 12% 상승했습니다.",
                createdAt: "2026-07-17T00:01:00.000Z",
              },
            ],
            revokedAt: null,
          },
        }),
      });
    },
  );
  await page.route(
    "**/api/v1/conversation-shares/preview-conversation-gone",
    async (route) => {
      await route.fulfill({
        status: 410,
        contentType: "application/json",
        body: JSON.stringify({}),
      });
    },
  );
}

test.describe("P20-T1-08 preview — 대화 스냅샷 공유", () => {
  test("스냅샷 정상/410 상태가 렌더되고 라이트 스크린샷을 남긴다", async ({
    page,
  }) => {
    await stubConversationShareRoutes(page);
    await page.goto("/preview");

    const section = page.getByTestId("preview-conversation-share-public-view");
    await expect(section).toBeVisible();
    await expect(section).toContainText("이번 분기 매출 분석");
    await expect(section).toContainText("이번 분기 매출 요약해줘");
    await expect(section).toContainText(
      "이번 분기 매출은 전분기 대비 12% 상승했습니다.",
    );
    await expect(section).toContainText("2026-07-17 에 생성되었습니다.");
    await expect(section).toContainText("410");
    await expect(section).toContainText(
      "이 링크는 만료되었거나 취소되었습니다.",
    );

    await section.screenshot({
      path: "../../.ralph/screenshots/conversation-share-public-view-light.png",
    });
  });

  test("다크 테마에서도 대화 스냅샷 공유 섹션이 정상 렌더된다", async ({
    page,
  }) => {
    await stubConversationShareRoutes(page);
    await page.addInitScript(() => {
      window.localStorage.setItem("wchat-theme", "dark");
    });
    await page.goto("/preview");

    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

    const section = page.getByTestId("preview-conversation-share-public-view");
    await expect(section).toBeVisible();
    await expect(section).toContainText("이번 분기 매출 분석");
    await expect(section).toContainText("410");
    await section.screenshot({
      path: "../../.ralph/screenshots/conversation-share-public-view-dark.png",
    });
  });
});
