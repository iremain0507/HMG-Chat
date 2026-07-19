import { test, expect } from "@playwright/test";

// e2e/skills-manager.pw.ts — P13-T6-11 브라우저 검증(Layer 1).
//   /preview 의 skills-manager 섹션(SkillsManager, F11 "스킬" 목록) 을 실제 chromium 으로
//   열어 첫 행 강조 스타일 + 스킬명·버전·설명이 design-reference 핸드오프대로 렌더되는지
//   검증한다. useSkills 의 fetch 는 page.route() 로 목킹한다.
const SKILLS = [
  {
    id: "wchat-pptx@3.0.0",
    name: "WIA 브랜드 PPT",
    version: "3.0.0",
    description: "사내 표지·간지·본문 양식으로 PPTX 생성",
    triggers: ["ppt"],
    entryPoint: "skills/wchat-pptx/scripts/build.py",
    permissions: "user",
  },
  {
    id: "wchat-cert-parser@2.0.0",
    name: "시험성적서 파서",
    version: "2.0.0",
    description: "성적서 PDF에서 측정 항목·판정 결과를 표로 추출",
    triggers: ["성적서"],
    entryPoint: "skills/wchat-cert-parser/scripts/parse.py",
    permissions: "user",
  },
];

async function mockBackend(page: import("@playwright/test").Page) {
  // 관리 화면은 ?includeDisabled=true 로 조회한다(P22-T6-18) — 쿼리까지 매칭.
  await page.route("**/api/v1/skills**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: SKILLS }),
    }),
  );
}

test.describe("P13 preview — 에이전트·스킬 라이브러리(F11) 스킬 목록 핸드오프 정렬", () => {
  test("첫 행 강조 스타일과 스킬명·버전·설명이 렌더된다(라이트)", async ({
    page,
  }) => {
    await mockBackend(page);
    await page.goto("/preview");

    const section = page.getByTestId("preview-skills-manager");
    await expect(section).toBeVisible();
    await section.getByTestId("skills-manager-preview-trigger").click();

    await expect(section.getByText("WIA 브랜드 PPT")).toBeVisible();
    await expect(section.getByText("v3.0.0")).toBeVisible();
    await expect(
      section.getByText("사내 표지·간지·본문 양식으로 PPTX 생성"),
    ).toBeVisible();

    await expect(section.getByText("시험성적서 파서")).toBeVisible();
    await expect(section.getByText("v2.0.0")).toBeVisible();

    await section.scrollIntoViewIfNeeded();
    await section.screenshot({
      path: "../../.ralph/screenshots/skills-manager-light.png",
    });
  });

  test("다크 테마에서도 스킬 목록이 정상 렌더된다", async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem("wchat-theme", "dark");
    });
    await mockBackend(page);
    await page.goto("/preview");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

    const section = page.getByTestId("preview-skills-manager");
    await section.getByTestId("skills-manager-preview-trigger").click();

    await expect(section.getByText("WIA 브랜드 PPT")).toBeVisible();
    await expect(section.getByText("시험성적서 파서")).toBeVisible();

    await section.scrollIntoViewIfNeeded();
    await section.screenshot({
      path: "../../.ralph/screenshots/skills-manager-dark.png",
    });
  });
});
