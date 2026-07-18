import { test, expect } from "@playwright/test";

// e2e/message-queue.pw.ts — P22-T6-05 브라우저 검증(Open WebUI 파리티: 응답 생성 중 메시지 큐잉).
//   생성 중 Enter → 메시지가 버려지지 않고 눈에 보이는 큐(칩)로 쌓이고 in-flight 는 유지된다 /
//   큐 항목 취소 → 드롭 / 스트림 종료 시 큐 헤드가 FIFO 로 자동 디스패치돼 각자 새 턴을 만든다.
//   preview 갤러리(message-queue)가 useSessionStream 의 큐 로직을 로컬 state 로 흉내낸다.
test.describe("P22 preview — 응답 생성 중 메시지 큐잉", () => {
  test("생성 중 전송은 큐잉(비파괴)되고, 취소는 드롭, 종료 시 FIFO 자동 디스패치된다", async ({
    page,
  }) => {
    await page.goto("/preview");

    const section = page.getByTestId("preview-message-queue");
    await expect(section).toBeVisible();

    const textarea = section.getByLabel("메시지 입력");

    // 1) 첫 전송 → 스트리밍 시작(assistant 버블 생성 중, Stop 버튼 노출)
    await textarea.fill("첫 질문");
    await textarea.press("Enter");
    await expect(section.getByTestId("mq-turn-user")).toHaveText(/첫 질문/);
    await expect(section.getByRole("button", { name: "Stop" })).toBeVisible();
    const streamingAssistant = section.locator(
      '[data-testid="mq-turn-assistant"][data-streaming="true"]',
    );
    await expect(streamingAssistant).toBeVisible();

    // 2) 생성 중 두 건 전송 → in-flight abort 없이 큐(칩)로 쌓인다(acceptance #1)
    await textarea.fill("대기 A");
    await textarea.press("Enter");
    await textarea.fill("대기 B");
    await textarea.press("Enter");

    const queue = section.getByTestId("queued-messages");
    await expect(queue).toBeVisible();
    await expect(queue.getByText("대기 A")).toBeVisible();
    await expect(queue.getByText("대기 B")).toBeVisible();
    // in-flight 스트림은 abort 되지 않고 그대로 유지된다
    await expect(streamingAssistant).toBeVisible();
    // 유저 버블은 아직 첫 질문 하나뿐(큐 항목은 아직 전송 전)
    await expect(section.getByTestId("mq-turn-user")).toHaveCount(1);

    // 3) 큐 항목 취소 → 드롭되어 다시 전송되지 않는다(acceptance #3)
    await section
      .getByRole("button", { name: "대기 A 대기열에서 제거" })
      .click();
    await expect(queue.getByText("대기 A")).toBeHidden();
    await expect(queue.getByText("대기 B")).toBeVisible();

    // 4) 스트림 종료 → 큐 헤드(대기 B)가 FIFO 로 자동 디스패치돼 새 턴을 만든다(acceptance #2/#4)
    await section.getByTestId("mq-finish-response").click();
    await expect(section.getByTestId("mq-turn-user")).toHaveCount(2);
    await expect(section.getByTestId("mq-turn-user").nth(1)).toHaveText(
      /대기 B/,
    );
    // 큐는 비워지고, 대기 B 의 새 응답이 생성 중이다
    await expect(queue).toBeHidden();
    await expect(streamingAssistant).toBeVisible();

    await page.screenshot({
      path: "../../.ralph/screenshots/P22-T6-05-message-queue.png",
      fullPage: true,
    });
  });
});
