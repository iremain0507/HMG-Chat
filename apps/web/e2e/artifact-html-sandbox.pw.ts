import { test, expect } from "@playwright/test";

// e2e/artifact-html-sandbox.pw.ts — P20-T6-03 브라우저 검증(L1 last-mile).
//   ArtifactPanel 의 html iframe 이 sandbox="allow-scripts"(allow-same-origin 미병기)로
//   바뀐 뒤에도 스크립트가 실제 실행되어 iframe 내부 DOM 을 변경하는지(속성만 켜지고
//   실행은 안 되는 무동작이 아닌지) 실 chromium 에서 확인한다.
const CONTENT_URL = "**/api/v1/artifacts/preview-artifact-html-1/content";
const HTML_BODY = `<!doctype html>
<div id="target">before</div>
<script>document.getElementById("target").textContent = "mutated-by-script";</script>`;

test.describe("P20-T6-03 — artifact html sandbox 스크립트 실행", () => {
  test("sandbox=allow-scripts iframe 안에서 스크립트가 실행되어 DOM 을 변경한다", async ({
    page,
  }) => {
    await page.route(CONTENT_URL, (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/html",
        body: HTML_BODY,
      }),
    );

    await page.goto("/preview");

    const section = page.getByTestId("preview-artifact-html-sandbox");
    const iframeEl = section.getByTestId("artifact-html");
    await expect(iframeEl).toBeVisible();
    await expect(iframeEl).toHaveAttribute("sandbox", "allow-scripts");

    const frame = section.frameLocator('[data-testid="artifact-html"]');
    await expect(frame.locator("#target")).toHaveText("mutated-by-script");
  });
});
