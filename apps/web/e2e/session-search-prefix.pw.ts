import { test, expect } from "@playwright/test";

// e2e/session-search-prefix.pw.ts — P20-T1-07 브라우저 검증(Layer 1, ★needsBrowser).
//   /preview 의 command-palette 섹션(토글 오픈, HitlPromptPreview 와 동일 패턴)을 실제 chromium
//   으로 열어 (1) 접두어 힌트칩 4종이 보이고 클릭 시 입력창에 삽입되는지, (2) tag:/folder: 접두어가
//   섞인 쿼리를 입력했을 때 실제 fetch 가 /api/v1/sessions/search?q= 로 접두어를 잘라내지 않고
//   그대로(라우트 파서가 소비할 원문 그대로) 보내는지를 검증한다. 실앱 dev-login E2E 하네스는 이
//   세션에 아직 없어(§2, P20-T6-04/06/08 과 동일 사유) /preview 갤러리를 브라우저 레이어로 쓴다.
//   서버측 실제 파싱·필터링(tag:report 예산 → report 태그+예산 매칭 세션만)은 createApp+실Postgres
//   통합테스트(session-search-composition.test.ts)가 담당한다 — 이 e2e 는 클라이언트가 입력을
//   왜곡 없이 그 배선까지 전달하는 last-mile 만 검증한다.
test.describe("P20-T1-07 preview — 검색 접두어 힌트 + 전달", () => {
  test("힌트칩 클릭으로 접두어가 삽입되고, 접두어 섞인 쿼리가 원문 그대로 서버로 전달된다", async ({
    page,
  }) => {
    let capturedQuery: string | null = null;
    await page.route("**/api/v1/sessions/search*", (route) => {
      const url = new URL(route.request().url());
      capturedQuery = url.searchParams.get("q");
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: [] }),
      });
    });

    await page.goto("/preview");

    const section = page.getByTestId("preview-command-palette");
    await section.getByTestId("command-palette-preview-trigger").click();

    const palette = section.getByTestId("command-palette");
    await expect(palette).toBeVisible();

    const input = section.getByTestId("command-palette-input");
    await expect(section.getByTestId("command-palette-hint-tag")).toHaveText(
      "tag:",
    );
    await expect(section.getByTestId("command-palette-hint-folder")).toHaveText(
      "folder:",
    );
    await expect(section.getByTestId("command-palette-hint-pinned")).toHaveText(
      "pinned:true",
    );
    await expect(
      section.getByTestId("command-palette-hint-archived"),
    ).toHaveText("archived:true");

    await section.getByTestId("command-palette-hint-tag").click();
    await expect(input).toHaveValue("tag:");
    await expect(input).toBeFocused();

    await input.fill("tag:report folder:업무 예산");

    await expect
      .poll(() => capturedQuery, { timeout: 3000 })
      .toBe("tag:report folder:업무 예산");
  });
});
