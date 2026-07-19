import { test, expect } from "@playwright/test";

// e2e/read-aloud.pw.ts — P22-T6-09 브라우저 검증(★needsBrowser).
//   TTS 낭독(read-aloud): assistant 메시지 액션바의 낭독 버튼이 실 chromium 에서 렌더/토글되고,
//   speechSynthesis.speak 이 "마크다운이 제거된 평문" utterance 로 호출되는지 검증한다.
//   헤드리스 chromium 은 실 음성엔진이 없어 speak/onend 타이밍이 비결정적이므로 addInitScript 로
//   speechSynthesis 를 결정론적 가짜로 대체한다(기존 관례: voice-input.pw.ts 의 SpeechRecognition 주입).
test.describe("P22-T6-09 낭독(TTS)", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      const spoken: string[] = [];
      let cancelCount = 0;
      class FakeUtterance {
        text: string;
        lang = "";
        onend: (() => void) | null = null;
        onerror: (() => void) | null = null;
        constructor(text: string) {
          this.text = text;
          (window as unknown as { __lastUtterance?: unknown }).__lastUtterance =
            this;
        }
      }
      (
        window as unknown as { SpeechSynthesisUtterance: unknown }
      ).SpeechSynthesisUtterance = FakeUtterance;
      Object.defineProperty(window, "speechSynthesis", {
        configurable: true,
        value: {
          speak: (u: FakeUtterance) => {
            spoken.push(u.text);
          },
          cancel: () => {
            cancelCount += 1;
          },
          get __spoken() {
            return spoken;
          },
          get __cancelCount() {
            return cancelCount;
          },
        },
      });
    });
  });

  test("낭독 버튼이 렌더되고 평문 utterance 로 speak 을 호출하며 재클릭 시 취소된다", async ({
    page,
  }) => {
    await page.goto("/preview");
    const section = page.getByTestId("preview-message-actions");
    await expect(section).toBeVisible();

    const readAloud = section.getByTestId("message-read-aloud");
    await expect(readAloud).toBeVisible();
    await expect(readAloud).toHaveAttribute("aria-pressed", "false");

    // 낭독 시작 → speak 호출 + 활성 상태
    await readAloud.click();
    await expect(readAloud).toHaveAttribute("aria-pressed", "true");
    const spoken = await page.evaluate(
      () =>
        (window.speechSynthesis as unknown as { __spoken: string[] }).__spoken,
    );
    expect(spoken).toEqual(["복사 대상 텍스트"]);

    // 재클릭 → cancel + idle 복귀
    await readAloud.click();
    await expect(readAloud).toHaveAttribute("aria-pressed", "false");
    const cancelCount = await page.evaluate(
      () =>
        (window.speechSynthesis as unknown as { __cancelCount: number })
          .__cancelCount,
    );
    expect(cancelCount).toBeGreaterThan(0);

    await section.screenshot({
      path: "../../.ralph/screenshots/P22-T6-09-read-aloud-light.png",
    });
  });

  test("utterance 가 onend 를 발화하면 버튼이 idle 로 복귀한다", async ({
    page,
  }) => {
    await page.goto("/preview");
    const section = page.getByTestId("preview-message-actions");
    const readAloud = section.getByTestId("message-read-aloud");

    await readAloud.click();
    await expect(readAloud).toHaveAttribute("aria-pressed", "true");

    await page.evaluate(() => {
      (
        window as unknown as { __lastUtterance: { onend: (() => void) | null } }
      ).__lastUtterance.onend?.();
    });
    await expect(readAloud).toHaveAttribute("aria-pressed", "false");
  });
});
