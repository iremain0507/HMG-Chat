import { test, expect } from "@playwright/test";

// e2e/mobile-f17.pw.ts — P13-T6-15 브라우저 검증(Layer 1).
//   F17(모바일 3종, 390px) 핸드오프: ① Run Rail → 좌측 1px 인디케이터로 축소(개별 눈금
//   숨김) ② @/멘션·슬래시 픽커 → 하단 고정 바텀시트(전폭·상단 그래버) ③ 아티팩트 → 풀스크린
//   시트(상단 그래버). 데스크톱 대비(app-shell.pw.ts 등)는 그대로 두고 이 스펙만 390×844
//   모바일 뷰포트로 실 렌더를 검증한다.
test.use({ viewport: { width: 390, height: 844 } });

// ArtifactCanvasPreview 는 기본 open=true 로 렌더되는데, ArtifactCanvas 자체가
// md 미만에서 `fixed inset-0`(풀스크린 시트)로 전환되어 페이지 전체를 덮는다 — 다른 섹션의
// 상호작용/스크린샷을 검증하는 테스트에서는 먼저 닫아 간섭을 제거한다(아티팩트 테스트 자체는 예외).
async function closeMobileArtifactOverlay(
  page: import("@playwright/test").Page,
) {
  const closeButton = page
    .getByTestId("preview-artifact-canvas")
    .getByRole("button", { name: "아티팩트 패널 닫기" });
  if (await closeButton.isVisible().catch(() => false)) {
    await closeButton.click();
  }
}

test.describe("P13 preview — F17 모바일 핸드오프 정렬", () => {
  test("Run Rail 이 1px 인디케이터로 축소되고 개별 눈금은 숨겨진다(라이트)", async ({
    page,
  }) => {
    await page.goto("/preview");
    await closeMobileArtifactOverlay(page);

    const section = page.getByTestId("preview-chat-agentic");
    await expect(section).toBeVisible();

    const compact = section.getByTestId("run-rail-compact");
    await expect(compact).toBeVisible();

    const tick = section.getByTestId("run-rail-tick-preview-rail-1");
    await expect(tick).toBeHidden();

    await section.screenshot({
      path: "../../.ralph/screenshots/mobile-f17-run-rail-light.png",
    });
  });

  test("@/슬래시 픽커가 하단 고정 바텀시트(전폭·상단 그래버)로 렌더된다", async ({
    page,
  }) => {
    await page.goto("/preview");
    await closeMobileArtifactOverlay(page);
    const section = page.getByTestId("preview-chat-input");
    const textarea = section.getByLabel("메시지 입력");
    await textarea.fill("/검");

    const popover = section.getByTestId("composer-popover");
    await expect(popover).toBeVisible();
    await expect(section.getByTestId("composer-popover-grabber")).toBeVisible();
    await expect(
      section.getByTestId("composer-popover-backdrop"),
    ).toBeVisible();

    const box = await popover.boundingBox();
    const viewport = page.viewportSize();
    if (!box || !viewport) throw new Error("bounding box unavailable");
    // 바텀시트 — 전폭 + 뷰포트 하단에 고정(바닥에서 여유 없이 붙음).
    expect(box.width).toBeGreaterThan(viewport.width - 4);
    expect(box.y + box.height).toBeGreaterThanOrEqual(viewport.height - 2);

    await page.screenshot({
      path: "../../.ralph/screenshots/mobile-f17-picker-light.png",
    });
  });

  test("아티팩트 패널이 풀스크린 시트 + 상단 그래버로 렌더된다(다크 포함)", async ({
    page,
  }) => {
    await page.goto("/preview");
    const section = page.getByTestId("preview-artifact-canvas");
    const panel = section.getByTestId("artifact-panel");
    await expect(panel).toBeVisible();
    await expect(panel.getByTestId("artifact-panel-grabber")).toBeVisible();

    const box = await panel.boundingBox();
    const viewport = page.viewportSize();
    if (!box || !viewport) throw new Error("bounding box unavailable");
    expect(box.width).toBeGreaterThan(viewport.width - 4);
    expect(box.height).toBeGreaterThan(viewport.height - 4);

    await page.addInitScript(() => {
      window.localStorage.setItem("wchat-theme", "dark");
    });
    await page.goto("/preview");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    const darkPanel = page
      .getByTestId("preview-artifact-canvas")
      .getByTestId("artifact-panel");
    await expect(darkPanel).toBeVisible();
    await expect(darkPanel.getByTestId("artifact-panel-grabber")).toBeVisible();

    await darkPanel.screenshot({
      path: "../../.ralph/screenshots/mobile-f17-artifact-dark.png",
    });
  });
});
