import { test, expect } from "@playwright/test";

// e2e/i18n-language-switch.pw.ts — P22-T6-15(C11) 브라우저 검증(Layer 1).
//   /preview 의 language-switch 섹션(LocaleProvider > NavRail + ProfileManager)을 실 chromium
//   으로 열어 Open WebUI 레퍼런스 플로우를 확인한다:
//     Settings/Profile 에서 언어를 한국어 → English 로 바꾸면
//     (a) 선택기 자신뿐 아니라 *다른* 컴포넌트(NavRail)의 라벨까지 즉시 영어로 다시 그려지고
//     (b) 그 동안 페이지 리로드가 일어나지 않으며(acceptance "without a full page reload")
//     (c) 선택이 PATCH /auth/me {language:"en"} 로 계정에 저장된다(재로그인 후 유지의 근거).
//   백엔드는 connections.pw.ts 와 동일하게 page.route() 로 목킹한다.
const NOW = "2026-01-01T00:00:00.000Z";

type Captured = { patchBodies: Record<string, unknown>[] };

function meUser(language: string | null) {
  return {
    id: "user-1",
    email: "a@b.com",
    name: "김민수",
    orgId: "org-1",
    role: "member",
    customInstructions: "항상 한국어로 답해줘",
    language,
    createdAt: NOW,
  };
}

async function mockBackend(
  page: import("@playwright/test").Page,
  captured: Captured,
) {
  // language 는 서버가 기억하는 값 — PATCH 하면 이후 GET 이 그 값을 돌려준다.
  let language: string | null = null;

  await page.route("**/api/v1/auth/me", (route) => {
    const method = route.request().method();
    if (method === "PATCH") {
      const body = JSON.parse(route.request().postData() ?? "{}") as Record<
        string,
        unknown
      >;
      captured.patchBodies.push(body);
      if (typeof body.language === "string") language = body.language;
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: meUser(language),
          meta: { requestId: "req-patch" },
        }),
      });
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: { user: meUser(language), org: null },
        meta: { requestId: "req-me" },
      }),
    });
  });
}

test.describe("P22-T6-15 preview — 사용자별 UI 언어 전환", () => {
  test("언어를 English 로 바꾸면 리로드 없이 NavRail 까지 영어로 재렌더되고 계정에 저장된다", async ({
    page,
  }) => {
    const captured: Captured = { patchBodies: [] };
    await mockBackend(page, captured);
    await page.goto("/preview");

    const section = page.getByTestId("preview-language-switch");
    await section.getByTestId("language-switch-preview-trigger").click();

    // 초기 상태: User.language=null → 서버 기본 ko.
    const navHome = section.getByTestId("nav-rail-home");
    await expect(navHome).toHaveAttribute("aria-label", "홈");
    await expect(section.getByLabel("언어")).toHaveValue("ko");
    await expect(section.getByRole("button", { name: "저장" })).toBeVisible();

    // 리로드 감지용 센티넬 — 실제 페이지 리로드가 나면 이 값이 사라진다.
    await page.evaluate(() => {
      (window as unknown as Record<string, unknown>).__wchatNoReload = "alive";
    });

    // 언어 전환(저장 버튼과 무관하게 선택 즉시 적용).
    await section.getByLabel("언어").selectOption("en");

    // (a) 선택기가 아닌 NavRail 라벨까지 영어로 재렌더된다.
    await expect(navHome).toHaveAttribute("aria-label", "Home");
    await expect(section.getByTestId("nav-rail-projects")).toHaveAttribute(
      "aria-label",
      "Projects",
    );
    await expect(
      section.getByRole("navigation", { name: "Primary navigation" }),
    ).toBeVisible();
    // 같은 화면의 프로필 폼 라벨도 함께 바뀐다.
    await expect(section.getByLabel("Name")).toHaveValue("김민수");
    await expect(section.getByRole("button", { name: "Save" })).toBeVisible();

    // (b) 페이지 리로드가 없었다.
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as unknown as Record<string, unknown>).__wchatNoReload ??
            null,
        ),
      )
      .toBe("alive");

    // (c) 계정에 저장 — 재로그인 후에도 유지되는 근거.
    await expect
      .poll(() => captured.patchBodies.some((b) => b.language === "en"))
      .toBe(true);

    // <html lang> 도 실제 로케일과 맞는다(스크린리더·번역기).
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
  });
});
