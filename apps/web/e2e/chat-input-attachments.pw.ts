import { test, expect } from "@playwright/test";

// e2e/chat-input-attachments.pw.ts — P10-T6-11 브라우저 검증(Layer 1).
//   ChatInput 컴포저 첨부 — 드래그드롭 하이라이트, 드롭 업로드→칩 렌더, 붙여넣기 업로드,
//   칩 제거, 전송 버튼 활성/비활성 인터랙션이 실제 chromium 에서 동작하는지 검증.
//   POST /api/v1/uploads 는 preview 라우트가 인증/서버 없이 뜨므로 page.route 로 모킹.
test.describe("P10 preview — ChatInput 첨부", () => {
  test("드래그드롭·붙여넣기로 파일을 첨부하면 업로드 후 칩이 렌더되고, 제거·전송 버튼 활성화가 동작한다", async ({
    page,
  }) => {
    let uploadCount = 0;
    await page.route("**/api/v1/uploads", async (route) => {
      uploadCount += 1;
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          data: {
            id: `upload-e2e-${uploadCount}`,
            filename: uploadCount === 1 ? "notes.md" : "shot.png",
            mimeType: uploadCount === 1 ? "text/markdown" : "image/png",
            sizeBytes: 12,
          },
          meta: { requestId: "11111111-1111-1111-1111-111111111111" },
        }),
      });
    });

    await page.goto("/preview");
    const section = page.getByTestId("preview-chat-input");
    await expect(section).toBeVisible();

    const dropzone = section.getByTestId("composer-dropzone");
    const sendButton = section.getByRole("button", { name: "전송" });

    // 드래그 하이라이트
    await dropzone.dispatchEvent("dragover");
    await expect(dropzone).toHaveAttribute("data-drag-active", "true");
    await dropzone.dispatchEvent("dragleave");
    await expect(dropzone).toHaveAttribute("data-drag-active", "false");

    // 드롭 → 업로드 → 칩
    const dropTransfer = await page.evaluateHandle(() => {
      const dt = new DataTransfer();
      dt.items.add(new File(["hello"], "notes.md", { type: "text/markdown" }));
      return dt;
    });
    await dropzone.dispatchEvent("drop", { dataTransfer: dropTransfer });
    await expect(section.getByText("notes.md")).toBeVisible();

    // 붙여넣기 → 업로드 → 칩 (ClipboardEvent.clipboardData 는 Playwright dispatchEvent 의
    // eventInit 매핑 대상이 아니라(DragEvent 만 지원), page.evaluate 로 실제 ClipboardEvent 를
    // 구성해 element.dispatchEvent 를 직접 호출한다)
    const textarea = section.getByLabel("메시지 입력");
    await textarea.evaluate((el) => {
      const dt = new DataTransfer();
      dt.items.add(new File(["binary"], "shot.png", { type: "image/png" }));
      const event = new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
        clipboardData: dt,
      });
      el.dispatchEvent(event);
    });
    await expect(section.getByText("shot.png")).toBeVisible();

    // 텍스트가 비어 있으면 전송 버튼은 비활성
    await expect(sendButton).toBeDisabled();
    await textarea.fill("첨부 파일 확인해줘");
    await expect(sendButton).toBeEnabled();

    // 칩 제거
    await section.getByLabel("notes.md 제거").click();
    await expect(section.getByText("notes.md")).toBeHidden();
    await expect(section.getByText("shot.png")).toBeVisible();

    await page.screenshot({
      path: "../../.ralph/screenshots/chat-input-attachments.png",
      fullPage: true,
    });
  });
});
