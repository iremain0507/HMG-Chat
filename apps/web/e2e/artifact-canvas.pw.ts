import { test, expect } from "@playwright/test";

// e2e/artifact-canvas.pw.ts — P10-T6-10 브라우저 검증(Layer 1).
//   ArtifactCanvas(우측 아티팩트 패널) — 미리보기/코드 토글, 버전 페이저, 닫기/재오픈,
//   공유 다이얼로그가 실제 chromium 에서 동작하는지 검증.
test.describe("P10 preview — ArtifactCanvas", () => {
  test("패널이 렌더되고 코드 토글·버전 페이저·공유·닫기가 동작한다", async ({
    page,
  }) => {
    await page.goto("/preview");

    const section = page.getByTestId("preview-artifact-canvas");
    await expect(section).toBeVisible();

    const panel = section.getByTestId("artifact-panel");
    await expect(panel).toBeVisible();
    await expect(panel).toContainText("report-v2.md");

    // 버전 페이저: 2/2 → 이전 클릭 → 1/2
    await expect(panel.getByTestId("artifact-version-pager")).toHaveText(
      "2 / 2",
    );
    await panel.getByRole("button", { name: "이전 버전" }).click();
    await expect(panel.getByTestId("artifact-version-pager")).toHaveText(
      "1 / 2",
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

    // 닫기 → 재오픈
    await panel.getByRole("button", { name: "아티팩트 패널 닫기" }).click();
    await expect(panel).toBeHidden();
    await section.getByRole("button", { name: "패널 다시 열기" }).click();
    await expect(section.getByTestId("artifact-panel")).toBeVisible();

    await page.screenshot({
      path: "../../.ralph/screenshots/artifact-canvas.png",
      fullPage: true,
    });
  });
});
