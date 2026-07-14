import { test, expect } from "@playwright/test";

// e2e/tool-call-renderer.pw.ts — P10-T6-07 브라우저 검증(Layer 1).
//   ToolCallRenderer + StatusChip 이 실제 chromium 에서 렌더/펼침/재시도 인터랙션이 동작하는지 검증.
test.describe("P10 preview — ToolCallRenderer", () => {
  test("상태칩 3종(running/done/error)이 렌더되고 펼침·재시도 인터랙션이 동작한다", async ({
    page,
  }) => {
    await page.goto("/preview");

    const section = page.getByTestId("preview-tool-call-renderer");
    await expect(section).toBeVisible();

    const cards = section.getByTestId("tool-call");
    await expect(cards).toHaveCount(3);

    // running 카드
    const runningCard = cards.nth(0);
    await expect(runningCard.getByTestId("status-chip")).toHaveAttribute(
      "data-status",
      "running",
    );

    // done 카드 — MCP 라벨 + 접힌 상태 요약, 클릭 시 args/result 펼침
    const doneCard = cards.nth(1);
    await expect(doneCard).toContainText("srv-1 › search");
    await expect(doneCard.getByTestId("status-chip")).toHaveAttribute(
      "data-status",
      "done",
    );
    await expect(doneCard).toContainText("검색 결과 3건");
    await doneCard.getByRole("button", { name: /mcp:srv-1:search/ }).click();
    await expect(doneCard.locator("pre").first()).toBeVisible();
    await expect(doneCard.locator("pre").first()).toContainText("query");

    // error 카드 — 재시도 칩 노출
    const errorCard = cards.nth(2);
    await expect(errorCard.getByTestId("status-chip")).toHaveAttribute(
      "data-status",
      "error",
    );
    await expect(
      errorCard.getByRole("button", { name: "재시도", exact: true }),
    ).toBeVisible();

    await page.screenshot({
      path: "../../.ralph/screenshots/tool-call-renderer.png",
      fullPage: true,
    });
  });
});
