import { test, expect } from "@playwright/test";

// e2e/artifact-canvas.pw.ts — P10-T6-10 / P13-T6-08 브라우저 검증(Layer 1).
//   ArtifactCanvas(우패널 3탭: 아티팩트·출처·활동) — 미리보기/코드 토글, 버전 페이저,
//   닫기/재오픈, 공유 다이얼로그 + 출처/활동 탭 전환이 실제 chromium 에서 동작하는지 검증.
test.describe("P10/P13 preview — ArtifactCanvas", () => {
  test("패널이 렌더되고 코드 토글·버전 페이저·공유·닫기가 동작한다", async ({
    page,
  }) => {
    await page.goto("/preview");

    const section = page.getByTestId("preview-artifact-canvas");
    await expect(section).toBeVisible();

    const panel = section.getByTestId("artifact-panel");
    await expect(panel).toBeVisible();
    await expect(panel).toContainText("report-v2.md");

    // 버전 페이저: v2/2 → 이전 클릭 → v1/2
    await expect(panel.getByTestId("artifact-version-pager")).toHaveText(
      "v2 / 2",
    );
    await panel.getByRole("button", { name: "이전 버전" }).click();
    await expect(panel.getByTestId("artifact-version-pager")).toHaveText(
      "v1 / 2",
    );
    await expect(panel).toContainText("report-v1.md");

    // 미리보기/코드 토글
    await panel.getByRole("button", { name: "코드" }).click();
    await expect(panel.getByTestId("artifact-code-view")).toBeVisible();
    await panel.getByRole("button", { name: "미리보기" }).click();

    // 공유 다이얼로그
    await panel.getByRole("button", { name: "공유" }).click();
    const dialog = page.getByRole("dialog", { name: "공유" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "닫기" }).click();
    await expect(dialog).toBeHidden();

    // 출처 탭 — 인용 목록 + 하이라이트(클릭 트리거 → 2초 후 자동 페이드아웃, P13-T6-09)
    await panel.getByTestId("artifact-panel-tab-sources").click();
    const sourceItem = panel.getByTestId("source-item-1");
    await expect(sourceItem).toBeVisible();
    await expect(sourceItem).toHaveAttribute("data-focused", "false");
    await expect(sourceItem).toContainText("열관리모듈_시험성적서.pdf");

    await section.getByTestId("citation-focus-trigger").click();
    await expect(sourceItem).toHaveAttribute("data-focused", "true");
    await expect(sourceItem).toHaveAttribute("data-focused", "false", {
      timeout: 2600,
    });

    // 활동 탭 — 멀티에이전트 진행(ActivityPanel) 재사용
    await panel.getByTestId("artifact-panel-tab-activity").click();
    await expect(panel.getByTestId("activity-panel")).toBeVisible();
    await expect(panel.getByTestId("activity-plan-summary")).toBeVisible();

    // 아티팩트 탭으로 복귀
    await panel.getByTestId("artifact-panel-tab-artifacts").click();
    await expect(panel).toContainText("report-v1.md");

    // 닫기 → 재오픈
    await panel.getByRole("button", { name: "아티팩트 패널 닫기" }).click();
    await expect(panel).toBeHidden();
    await section.getByRole("button", { name: "패널 다시 열기" }).click();
    await expect(section.getByTestId("artifact-panel")).toBeVisible();

    await section.getByTestId("artifact-panel").screenshot({
      path: "../../.ralph/screenshots/artifact-canvas-light.png",
    });
  });

  test("다크 모드에서도 3탭 패널이 렌더된다", async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem("wchat-theme", "dark");
    });
    await page.goto("/preview");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

    const section = page.getByTestId("preview-artifact-canvas");
    const panel = section.getByTestId("artifact-panel");
    await expect(panel).toBeVisible();
    await expect(
      panel.getByTestId("artifact-panel-tab-artifacts"),
    ).toBeVisible();

    await panel.getByTestId("artifact-panel-tab-sources").click();
    await expect(panel.getByTestId("source-item-1")).toBeVisible();

    await panel.screenshot({
      path: "../../.ralph/screenshots/artifact-canvas-dark.png",
    });
  });
});
