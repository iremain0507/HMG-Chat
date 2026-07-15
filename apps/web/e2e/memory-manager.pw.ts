import { test, expect } from "@playwright/test";

// e2e/memory-manager.pw.ts — P13-T6-12 브라우저 검증(Layer 1).
//   /preview 의 memory-manager 섹션(MemoryManager, F13) 을 실제 chromium 으로 열어
//   카테고리 pill 탭·카드(출처·날짜 메타)·편집/삭제가 design-reference 핸드오프대로
//   렌더/동작하는지 검증한다. useMemories 의 fetch 는 page.route() 로 목킹한다.
const MEMORY_PINNED = {
  id: "mem-1",
  userId: "user-1",
  category: "user" as const,
  content: "구동부품 품질팀 소속, 직무는 공정 데이터 분석",
  source: "auto-extract" as const,
  sessionId: null,
  pinned: true,
  metadata: null,
  createdAt: "2026-06-20T00:00:00Z",
  updatedAt: "2026-06-20T00:00:00Z",
};

const MEMORY_MANUAL = {
  id: "mem-2",
  userId: "user-1",
  category: "feedback" as const,
  content: "답변은 5문장 이내로 요약",
  source: "manual" as const,
  sessionId: null,
  pinned: false,
  metadata: null,
  createdAt: "2026-05-30T00:00:00Z",
  updatedAt: "2026-05-30T00:00:00Z",
};

async function mockBackend(page: import("@playwright/test").Page) {
  await page.route("**/api/v1/memories*", (route) => {
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: [MEMORY_PINNED, MEMORY_MANUAL] }),
    });
  });
}

test.describe("P13 preview — 메모리 설정(F13) 핸드오프 정렬", () => {
  test("카테고리 pill·메모리 카드(출처·날짜)가 렌더된다(라이트)", async ({
    page,
  }) => {
    await mockBackend(page);
    await page.goto("/preview");

    const section = page.getByTestId("preview-memory-manager");
    await expect(section).toBeVisible();
    await section.getByTestId("memory-manager-preview-trigger").click();

    await expect(section.getByText("/settings/memories")).toBeVisible();
    await expect(
      section.getByText(
        "저장된 메모리는 모든 대화에 자동 적용됩니다 — 채팅 헤더의 메모리 아이콘에서 적용 현황을 확인할 수 있습니다",
      ),
    ).toBeVisible();

    await expect(
      section.getByText("구동부품 품질팀 소속, 직무는 공정 데이터 분석"),
    ).toBeVisible();
    await expect(section.getByText("고정됨")).toBeVisible();
    await expect(section.getByText(/자동 추출/)).toBeVisible();

    await expect(section.getByText("답변은 5문장 이내로 요약")).toBeVisible();
    await expect(section.getByText(/수동 입력/)).toBeVisible();

    await section.getByRole("button", { name: "피드백", exact: true }).click();

    await section.scrollIntoViewIfNeeded();
    await section.screenshot({
      path: "../../.ralph/screenshots/memory-manager-light.png",
    });
  });

  test("다크 테마에서도 메모리 카드가 정상 렌더된다", async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem("wchat-theme", "dark");
    });
    await mockBackend(page);
    await page.goto("/preview");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

    const section = page.getByTestId("preview-memory-manager");
    await section.getByTestId("memory-manager-preview-trigger").click();

    await expect(
      section.getByText("구동부품 품질팀 소속, 직무는 공정 데이터 분석"),
    ).toBeVisible();

    await section.scrollIntoViewIfNeeded();
    await section.screenshot({
      path: "../../.ralph/screenshots/memory-manager-dark.png",
    });
  });
});
