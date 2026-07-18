import { test, expect } from "@playwright/test";

// e2e/pwa-install.pw.ts — P22-T6-07 브라우저 검증(★needsBrowser).
//   설치형 PWA: (1) /manifest.webmanifest 가 display:standalone·아이콘·테마색을 담은 유효
//   manifest 를 반환, (2) 설치 어포던스(InstallPwaButton)는 beforeinstallprompt 발화 전엔
//   숨겨져 있다가 발화 시 노출되고 클릭 시 네이티브 prompt() 를 호출, (3) appinstalled 후
//   숨겨진다. 실앱 dev-login E2E 하네스가 없어(§2) 기존 관례대로 /preview 갤러리(실 chromium)를
//   브라우저 레이어로 사용한다.
test.describe("P22-T6-07 PWA 설치 가능", () => {
  test("/manifest.webmanifest 가 standalone·아이콘·테마색을 담은 유효 manifest 를 반환한다", async ({
    request,
  }) => {
    const res = await request.get("/manifest.webmanifest");
    expect(res.ok()).toBe(true);
    const manifest = await res.json();
    expect(manifest.name).toBe("WChat");
    expect(manifest.short_name).toBeTruthy();
    expect(manifest.start_url).toBe("/");
    expect(manifest.display).toBe("standalone");
    expect(String(manifest.theme_color).toLowerCase()).toBe("#00287a");
    const sizes = (manifest.icons ?? []).map((i: { sizes: string }) => i.sizes);
    expect(sizes).toContain("192x192");
    expect(sizes).toContain("512x512");
    const hasMaskable = (manifest.icons ?? []).some((i: { purpose?: string }) =>
      (i.purpose ?? "").includes("maskable"),
    );
    expect(hasMaskable).toBe(true);
  });

  test("아이콘 자산이 실제 PNG 로 서빙된다", async ({ request }) => {
    for (const path of ["/icon-192.png", "/icon-512.png"]) {
      const res = await request.get(path);
      expect(res.ok()).toBe(true);
      expect(res.headers()["content-type"]).toContain("image/png");
    }
  });

  test("설치 버튼은 beforeinstallprompt 발화 시 노출되고 클릭 시 prompt() 를 호출, appinstalled 후 숨겨진다", async ({
    page,
  }) => {
    await page.goto("/preview");
    const section = page.getByTestId("preview-install-pwa");
    await expect(section).toBeVisible();

    const button = section.getByTestId("install-pwa-button");
    // 설치 가능 신호 전에는 숨김
    await expect(button).toBeHidden();

    // beforeinstallprompt 발화(브라우저가 설치 가능하다고 판단한 상태를 재현).
    await page.evaluate(() => {
      const w = window as unknown as { __pwaPromptCalled?: boolean };
      w.__pwaPromptCalled = false;
      const evt = new Event("beforeinstallprompt") as Event & {
        prompt: () => Promise<void>;
        userChoice: Promise<{ outcome: string }>;
      };
      evt.prompt = () => {
        w.__pwaPromptCalled = true;
        return Promise.resolve();
      };
      evt.userChoice = Promise.resolve({ outcome: "accepted" });
      window.dispatchEvent(evt);
    });

    await expect(button).toBeVisible();
    await expect(button).toHaveAccessibleName("앱 설치");

    await section.screenshot({
      path: "../../.ralph/screenshots/P22-T6-07-install-button.png",
    });

    await button.click();
    const promptCalled = await page.evaluate(
      () =>
        (window as unknown as { __pwaPromptCalled?: boolean })
          .__pwaPromptCalled,
    );
    expect(promptCalled).toBe(true);

    // 설치 완료 후 버튼은 사라진다.
    await page.evaluate(() => window.dispatchEvent(new Event("appinstalled")));
    await expect(button).toBeHidden();
  });
});
