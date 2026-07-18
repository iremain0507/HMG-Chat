import { test, expect } from "@playwright/test";

// e2e/composer-autocomplete.pw.ts — P22-T6-16 / 계약배치 C10 브라우저 검증.
//   컴포저 입력 자동완성(ghost text)이 실제 chromium 에서 동작하는지 검증한다:
//   타이핑 정지 → POST /api/v1/completions 호출 → 커서 뒤 회색 ghost text → Tab 수락 /
//   Escape 해제 / 계속 타이핑 시 낡은 제안 미노출 / org 가 끈 경우(403) 무제안.
//   백엔드는 page.route() 로 목킹(preview 하네스는 delayMs=50 으로 결정론적).
test.describe("P22 preview — 컴포저 자동완성(ghost text)", () => {
  test("타이핑을 멈추면 ghost text 가 뜨고 Tab 으로 수락된다", async ({
    page,
  }) => {
    await page.route("**/api/v1/completions", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: { completion: " 알려줘." } }),
      });
    });

    await page.goto("/preview");
    const section = page.getByTestId("preview-composer-autocomplete");
    await expect(section).toBeVisible();

    const textarea = section.getByLabel("메시지 입력");
    await textarea.fill("이번 분기 매출을");

    const ghost = section.getByTestId("composer-ghost-text");
    await expect(ghost).toBeVisible();
    await expect(ghost).toHaveText(" 알려줘.");

    await textarea.press("Tab");
    await expect(textarea).toHaveValue("이번 분기 매출을 알려줘.");
    await expect(ghost).toBeHidden();

    await page.screenshot({
      path: "../../.ralph/screenshots/P22-T6-16-ghost-accept.png",
      fullPage: false,
    });
  });

  test("Escape 로 제안을 닫으면 초안은 그대로 유지된다", async ({ page }) => {
    await page.route("**/api/v1/completions", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: { completion: " 요약해줘." } }),
      });
    });

    await page.goto("/preview");
    const section = page.getByTestId("preview-composer-autocomplete");
    const textarea = section.getByLabel("메시지 입력");
    await textarea.fill("회의록을");

    const ghost = section.getByTestId("composer-ghost-text");
    await expect(ghost).toBeVisible();

    await textarea.press("Escape");
    await expect(ghost).toBeHidden();
    await expect(textarea).toHaveValue("회의록을");
  });

  // 계약배치 C10 승인 조건: in-flight 응답이 늦게 도착해도 최신 입력을 덮어쓰지 않는다.
  // 첫 요청은 느리게(300ms) 낡은 제안을, 이후 요청은 즉시 최신 제안을 돌려주도록 목킹한다.
  test("응답 대기 중 계속 타이핑하면 낡은 제안이 노출되지 않는다", async ({
    page,
  }) => {
    // 호출 순서가 아니라 draft 내용으로 분기한다 — 순서로 분기하면 debounce(50ms) 안에서
    // 두 fill 이 합쳐져 요청이 1건만 나갈 때 그 1건이 "낡은" 응답이 돼 테스트가 거짓 실패한다.
    await page.route("**/api/v1/completions", async (route) => {
      const draft = (route.request().postDataJSON() as { draft: string }).draft;
      const isFirst = draft === "첫번째";
      // 낡은 요청은 느리게 응답해 최신 요청보다 뒤에 도착하도록 만든다.
      if (isFirst) await new Promise((r) => setTimeout(r, 300));
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: { completion: isFirst ? " STALE-낡은제안" : " 최신제안" },
        }),
      });
    });

    await page.goto("/preview");
    const section = page.getByTestId("preview-composer-autocomplete");
    const textarea = section.getByLabel("메시지 입력");

    await textarea.fill("첫번째");
    // debounce 를 넘겨 첫 요청이 실제로 in-flight 가 된 뒤에 이어서 타이핑한다.
    await page.waitForTimeout(150);
    await textarea.fill("첫번째 초안을 계속 이어서");

    const ghost = section.getByTestId("composer-ghost-text");
    await expect(ghost).toHaveText(" 최신제안");

    // 낡은 응답이 도착할 시간을 충분히 준 뒤에도 최신 제안이 유지돼야 한다.
    await page.waitForTimeout(500);
    await expect(ghost).toHaveText(" 최신제안");
  });

  // org 가 기능을 끄면 서버가 403 FEATURE_DISABLED 로 거절하고 ghost text 는 뜨지 않는다.
  test("org 가 기능을 끈 경우(403) ghost text 가 뜨지 않는다", async ({
    page,
  }) => {
    await page.route("**/api/v1/completions", async (route) => {
      await route.fulfill({
        status: 403,
        contentType: "application/json",
        body: JSON.stringify({
          error: {
            code: "FEATURE_DISABLED",
            category: "http",
            message: "입력 자동완성이 조직 설정에서 비활성화돼 있습니다.",
            retryable: false,
          },
        }),
      });
    });

    await page.goto("/preview");
    const section = page.getByTestId("preview-composer-autocomplete");
    const textarea = section.getByLabel("메시지 입력");
    await textarea.fill("자동완성이 꺼진 조직");

    await page.waitForTimeout(400);
    await expect(section.getByTestId("composer-ghost-text")).toHaveCount(0);
  });
});
