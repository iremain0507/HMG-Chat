import { test, expect } from "@playwright/test";

// e2e/citation.pw.ts — P10-T6-09 브라우저 검증(Layer 1).
//   [N] 인용 칩 렌더 + hover 스니펫 팝오버 + Reference 푸터 + 클릭→소스 포커스 인터랙션 검증.
test.describe("P10 preview — Citation", () => {
  test("[N] 칩과 Reference 푸터가 렌더되고, 클릭 시 해당 참조 항목이 포커스된다", async ({
    page,
  }) => {
    await page.goto("/preview");

    const section = page.getByTestId("preview-citation");
    await expect(section).toBeVisible();

    const chip1 = section.getByTestId("citation-chip-1");
    const chip2 = section.getByTestId("citation-chip-2");
    await expect(chip1).toBeVisible();
    await expect(chip2).toBeVisible();

    const footer = section.getByTestId("citation-reference-footer");
    await expect(footer).toContainText("manual.pdf");
    await expect(footer).toContainText("p.3");
    await expect(footer).toContainText("notes.md");

    const ref1 = section.getByTestId("citation-ref-1");
    await expect(ref1).toHaveAttribute("data-focused", "false");

    await chip1.hover();
    const tooltip1 = section.getByTestId("citation-tooltip-1");
    await expect(tooltip1).toContainText("manual.pdf");
    await expect(tooltip1).toContainText("p.3");
    await expect(tooltip1).toContainText("42 는 만물의 답이다.");

    await chip1.click();
    await expect(ref1).toHaveAttribute("data-focused", "true");

    await page.screenshot({
      path: "../../.ralph/screenshots/citation.png",
      fullPage: true,
    });
  });
});
