import { test, expect } from "@playwright/test";

// e2e/voice-input.pw.ts — P22-T6-08 브라우저 검증(★needsBrowser).
//   음성 입력(STT, Web Speech API 파리티): 컴포저 액션바의 마이크 토글이 실 chromium 에서
//   렌더/토글되고, 인식된 최종 텍스트가 textarea 에 삽입되는지 검증한다. 헤드리스 chromium 에
//   실 마이크·SpeechRecognition 이 없으므로 addInitScript 로 가짜 SpeechRecognition 을 주입해
//   onresult 이벤트를 결정론적으로 흉내낸다(기존 관례: /preview 갤러리를 브라우저 레이어로 사용).
test.describe("P22-T6-08 음성 입력(STT)", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      class FakeRecognition {
        lang = "";
        continuous = false;
        interimResults = false;
        started = false;
        onresult: ((e: unknown) => void) | null = null;
        onerror: ((e: unknown) => void) | null = null;
        onend: (() => void) | null = null;
        onstart: (() => void) | null = null;
        constructor() {
          (
            window as unknown as { __lastRecognition?: unknown }
          ).__lastRecognition = this;
        }
        start() {
          this.started = true;
          this.onstart?.();
        }
        stop() {
          this.started = false;
          this.onend?.();
        }
        abort() {
          this.started = false;
        }
        emitFinal(text: string) {
          const result = Object.assign([{ transcript: text }], {
            isFinal: true,
          });
          this.onresult?.({ resultIndex: 0, results: [result] });
        }
      }
      (window as unknown as { SpeechRecognition: unknown }).SpeechRecognition =
        FakeRecognition;
    });
  });

  test("마이크 토글이 렌더/동작하고 인식된 텍스트가 컴포저에 삽입된다(라이트)", async ({
    page,
  }) => {
    await page.goto("/preview");
    const section = page.getByTestId("preview-chat-input");
    await expect(section).toBeVisible();

    const mic = section.getByTestId("composer-trigger-mic");
    await expect(mic).toBeVisible();
    await expect(mic).toHaveAttribute("aria-pressed", "false");

    // 녹음 시작 → 활성 상태
    await mic.click();
    await expect(mic).toHaveAttribute("aria-pressed", "true");

    // 실제 SpeechRecognition onresult 흉내 → textarea 에 인식 텍스트 삽입
    await page.evaluate(() => {
      (
        window as unknown as {
          __lastRecognition: { emitFinal: (t: string) => void };
        }
      ).__lastRecognition.emitFinal("음성 입력 테스트 문장");
    });
    const textarea = section.getByLabel("메시지 입력");
    await expect(textarea).toHaveValue(/음성 입력 테스트 문장/);

    // 다시 토글 → 정지
    await mic.click();
    await expect(mic).toHaveAttribute("aria-pressed", "false");

    await section.screenshot({
      path: "../../.ralph/screenshots/P22-T6-08-voice-input-light.png",
    });
  });

  test("녹음 중 Escape 로 인식이 멈춘다", async ({ page }) => {
    await page.goto("/preview");
    const section = page.getByTestId("preview-chat-input");
    const mic = section.getByTestId("composer-trigger-mic");
    await mic.click();
    await expect(mic).toHaveAttribute("aria-pressed", "true");

    const textarea = section.getByLabel("메시지 입력");
    await textarea.press("Escape");
    await expect(mic).toHaveAttribute("aria-pressed", "false");
  });
});
