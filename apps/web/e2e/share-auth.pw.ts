import { test, expect } from "@playwright/test";

// e2e/share-auth.pw.ts — P13-T6-14 브라우저 검증(Layer 1).
//   /preview 의 share-public-view/login-form/signup-form 섹션을 실제 chromium 으로 열어
//   F16(공유+410 만료) 및 로그인/가입 폼이 design-reference 핸드오프 토큰(시맨틱 색·radius·
//   포커스 링)대로 렌더되는지 검증한다. SharePublicView 는 useShare 훅이 실 fetch 를 수행하므로
//   page.route 로 /api/v1/share/:token 응답을 가로채 정상/410 상태를 결정론적으로 재현한다.

async function stubShareRoutes(page: import("@playwright/test").Page) {
  await page.route("**/api/v1/share/preview-share-ok", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          token: "preview-share-ok",
          artifactId: "artifact-preview",
          filename: "열관리모듈_분석보고.pdf",
          type: "other",
          sizeBytes: 12345,
          mimeType: "application/pdf",
          expiresAt: "2026-08-14T00:00:00Z",
          viewCount: 3,
          revokedAt: null,
        },
      }),
    });
  });
  await page.route("**/api/v1/share/preview-share-expired", async (route) => {
    await route.fulfill({
      status: 410,
      contentType: "application/json",
      body: JSON.stringify({}),
    });
  });
}

test.describe("P13 preview — 공유(F16)+인증 핸드오프 정렬", () => {
  test("공유 정상/410 만료 상태가 렌더되고 라이트 스크린샷을 남긴다", async ({
    page,
  }) => {
    await stubShareRoutes(page);
    await page.goto("/preview");

    const section = page.getByTestId("preview-share-public-view");
    await expect(section).toBeVisible();
    await expect(section).toContainText("열관리모듈_분석보고.pdf");
    await expect(section).toContainText("2026-08-14 까지 유효");
    await expect(section).toContainText("410");
    await expect(section).toContainText(
      "이 링크는 만료되었거나 취소되었습니다.",
    );
    await expect(section.getByTestId("share-signature-label")).toHaveCount(2);

    await section.screenshot({
      path: "../../.ralph/screenshots/share-public-view-light.png",
    });
  });

  test("로그인 폼 제출 시 성공 카드가 표시된다(라이트)", async ({ page }) => {
    await page.route("**/api/v1/auth/magic-link", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: { sent: true } }),
      });
    });
    await page.goto("/preview");

    const section = page.getByTestId("preview-login-form");
    await expect(section).toBeVisible();
    await section.getByLabel("이메일").fill("user@wchat.dev");
    await section.getByRole("button", { name: "매직 링크 받기" }).click();
    await expect(section.getByRole("status")).toContainText(
      "이메일을 확인하세요",
    );

    await section.screenshot({
      path: "../../.ralph/screenshots/login-form-light.png",
    });
  });

  test("가입 폼이 렌더되고 라이트 스크린샷을 남긴다", async ({ page }) => {
    await page.goto("/preview");

    const section = page.getByTestId("preview-signup-form");
    await expect(section).toBeVisible();
    await expect(section.getByLabel("이메일")).toBeVisible();
    await expect(section.getByLabel("이름")).toBeVisible();

    await section.screenshot({
      path: "../../.ralph/screenshots/signup-form-light.png",
    });
  });

  test("다크 테마에서도 공유/로그인/가입 섹션이 정상 렌더된다", async ({
    page,
  }) => {
    await stubShareRoutes(page);
    await page.addInitScript(() => {
      window.localStorage.setItem("wchat-theme", "dark");
    });
    await page.goto("/preview");

    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

    const shareSection = page.getByTestId("preview-share-public-view");
    await expect(shareSection).toBeVisible();
    await expect(shareSection).toContainText("410");
    await shareSection.screenshot({
      path: "../../.ralph/screenshots/share-public-view-dark.png",
    });

    const loginSection = page.getByTestId("preview-login-form");
    await expect(loginSection).toBeVisible();
    await loginSection.screenshot({
      path: "../../.ralph/screenshots/login-form-dark.png",
    });

    const signupSection = page.getByTestId("preview-signup-form");
    await expect(signupSection).toBeVisible();
    await signupSection.screenshot({
      path: "../../.ralph/screenshots/signup-form-dark.png",
    });
  });
});
