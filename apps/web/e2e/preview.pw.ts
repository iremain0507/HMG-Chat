import { test, expect } from "@playwright/test";

// e2e/preview.pw.ts — P10 브라우저 검증(Layer 1). /preview 갤러리를 실제 chromium 으로
//   열어 jsdom 이 못 잡는 것(Tailwind 컴파일·CSS·rehype 하이라이트/katex 실렌더·테마 토글)을 검증.
//   FE 태스크는 자기 컴포넌트 섹션에 대한 assertion 을 여기에 추가한다.
test.describe("P10 preview — 실제 브라우저 렌더", () => {
  test("갤러리가 렌더되고 하이라이트/수식/테마토글이 실제로 동작한다", async ({
    page,
  }) => {
    await page.goto("/preview");

    // 마크다운 섹션 렌더
    await expect(page.getByTestId("preview-markdown")).toBeVisible();

    // rehype-highlight 가 실제로 hljs 클래스를 붙였는지(코드 하이라이트 동작)
    await expect(page.locator("pre code.hljs").first()).toBeVisible();

    // rehype-katex 가 수식을 실제로 렌더했는지
    await expect(page.locator(".katex").first()).toBeVisible();

    // 테마 토글이 실제 DOM(html[data-theme])을 양방향으로 바꾸는지
    const html = page.locator("html");
    const toggle = page.getByTestId("theme-toggle").first();
    await toggle.click();
    const first = await html.getAttribute("data-theme");
    expect(first === "light" || first === "dark").toBe(true);
    await toggle.click();
    const second = await html.getAttribute("data-theme");
    expect(second).not.toBe(first);

    // 스크린샷 아카이브(리뷰/증적용)
    await page.screenshot({
      path: "../../.ralph/screenshots/preview-gallery.png",
      fullPage: true,
    });
  });
});
