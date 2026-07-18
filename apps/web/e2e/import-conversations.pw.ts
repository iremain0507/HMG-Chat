import { test, expect } from "@playwright/test";

// e2e/import-conversations.pw.ts — P22-T6-13(계약배치 C9) 브라우저 검증.
//   ShareExportMenu 의 [대화 가져오기] → 숨은 file input 에 실제 JSON 파일을 올려
//   POST /api/v1/sessions/import 요청 페이로드(format/payload)까지 실 chromium 으로 단언한다.
//   유닛(RTL)은 mock 된 헬퍼만 보므로, 여기서 파일 읽기→포맷 판별→네트워크 왕복이
//   실제 브라우저에서 성립하는지를 확인한다(L1: 유닛 green ≠ 실사용).
test.describe("P22 preview — 대화 가져오기(import)", () => {
  const NATIVE_EXPORT = {
    title: "가져온 대화",
    messages: [
      { role: "user", content: "안녕" },
      { role: "assistant", content: "반갑습니다" },
    ],
  };

  const CHATGPT_EXPORT = [
    {
      title: "ChatGPT 대화",
      mapping: {
        root: { id: "root", parent: null, children: ["m1"], message: null },
        m1: {
          id: "m1",
          parent: "root",
          children: [],
          message: {
            author: { role: "user" },
            content: { parts: ["ChatGPT 에서 옮긴 질문"] },
          },
        },
      },
    },
  ];

  test("native JSON 파일을 고르면 format=native 로 import 를 요청하고 성공 토스트를 띄운다", async ({
    page,
  }) => {
    const requests: Array<{ format: string; payload: unknown }> = [];
    await page.route("**/api/v1/sessions/import", async (route) => {
      requests.push(route.request().postDataJSON());
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({ data: { createdSessionIds: ["s-1"] } }),
      });
    });

    await page.goto("/preview");
    const section = page.getByTestId("preview-share-export-menu");
    await section.getByTestId("share-export-trigger").click();

    const menu = section.getByTestId("share-export-menu");
    await expect(
      menu.getByRole("button", { name: "대화 가져오기" }),
    ).toBeVisible();

    await section.getByTestId("import-file-input").setInputFiles({
      name: "conversation.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(NATIVE_EXPORT)),
    });

    await expect
      .poll(() => requests.length, { message: "import 요청이 전송되어야 한다" })
      .toBe(1);
    expect(requests[0]?.format).toBe("native");
    expect(requests[0]?.payload).toEqual(NATIVE_EXPORT);

    // /preview 는 토스트를 app-shell 과 preview-toast 두 곳에 렌더하므로 하나로 좁힌다.
    await expect(
      page.getByTestId("preview-toast").getByText("대화 1건을 가져왔습니다."),
    ).toBeVisible();
    await expect(menu).toBeHidden();

    await page.screenshot({
      path: "../../.ralph/screenshots/P22-T6-13-import-native.png",
      fullPage: true,
    });
  });

  test("ChatGPT conversations.json 은 format=chatgpt 로 판별해 보낸다", async ({
    page,
  }) => {
    const requests: Array<{ format: string }> = [];
    await page.route("**/api/v1/sessions/import", async (route) => {
      requests.push(route.request().postDataJSON());
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({ data: { createdSessionIds: ["s-1"] } }),
      });
    });

    await page.goto("/preview");
    const section = page.getByTestId("preview-share-export-menu");
    await section.getByTestId("share-export-trigger").click();
    await section.getByTestId("import-file-input").setInputFiles({
      name: "conversations.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(CHATGPT_EXPORT)),
    });

    await expect.poll(() => requests.length).toBe(1);
    expect(requests[0]?.format).toBe("chatgpt");
  });

  test("가져올 수 없는 JSON 이면 요청하지 않고 실패 토스트를 띄운다", async ({
    page,
  }) => {
    let called = 0;
    await page.route("**/api/v1/sessions/import", async (route) => {
      called += 1;
      await route.fulfill({ status: 201, body: "{}" });
    });

    await page.goto("/preview");
    const section = page.getByTestId("preview-share-export-menu");
    await section.getByTestId("share-export-trigger").click();
    await section.getByTestId("import-file-input").setInputFiles({
      name: "unknown.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify({ nope: 1 })),
    });

    // 성공 케이스와 동일하게, 두 곳에 렌더되는 토스트를 preview-toast 하나로 좁힌다.
    await expect(
      page
        .getByTestId("preview-toast")
        .getByText("대화를 가져오지 못했습니다. JSON 형식을 확인해주세요."),
    ).toBeVisible();
    expect(called).toBe(0);
  });
});
