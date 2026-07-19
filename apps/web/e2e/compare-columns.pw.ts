import { test, expect } from "@playwright/test";

// e2e/compare-columns.pw.ts — P22-T6-06 브라우저 검증(Open WebUI 파리티: 멀티모델 병렬 비교).
//   ⚖️ 비교 토글 → 모델 체크박스 2+ 선택 → 한 프롬프트 전송 → 각 모델이 자기 컬럼으로 병렬
//   스트리밍(shimmer) → 종료 시 컬럼별 답변 표시 → 컬럼별 재생성이 그 컬럼에만 형제 답변을
//   추가하고 prev/next 페이저가 컬럼별로 독립 네비게이션한다(다른 컬럼 불변).
//   preview 갤러리(compare-columns)가 useSessionStream 의 팬아웃 로직을 로컬 state 로 흉내낸다.
test.describe("P22 preview — 멀티모델 병렬 비교", () => {
  test("비교 토글로 2모델 선택→전송하면 병렬 컬럼이 스트리밍되고, 컬럼별 재생성/페이저가 독립 동작한다", async ({
    page,
  }) => {
    await page.goto("/preview");

    const section = page.getByTestId("preview-compare-columns");
    await expect(section).toBeVisible();

    // 1) 기본은 단일 select. 비교 토글을 켜면 모델 체크박스가 노출된다.
    await section.getByRole("button", { name: "모델 비교 토글" }).click();
    await expect(section.getByTestId("compare-model-list")).toBeVisible();

    // 2) 두 번째 모델 추가로 2+ 모델 선택(첫 모델은 토글 시 기본 포함).
    await section.getByRole("checkbox", { name: "model-b 비교 선택" }).click();

    // 3) 한 프롬프트를 전송하면 각 모델이 자기 컬럼으로 병렬 스트리밍(shimmer)된다.
    const textarea = section.getByLabel("메시지 입력");
    await textarea.fill("이 프롬프트를 두 모델로 비교해줘");
    await textarea.press("Enter");

    await expect(section.getByTestId("compare-column-model-a")).toBeVisible();
    await expect(section.getByTestId("compare-column-model-b")).toBeVisible();
    await expect(section.getByTestId("compare-shimmer-model-a")).toBeVisible();
    await expect(section.getByTestId("compare-shimmer-model-b")).toBeVisible();
    // 각 컬럼에 모델 라벨이 붙는다(message_start.meta.model 라벨링).
    await expect(
      section.getByTestId("compare-column-label-model-a"),
    ).toHaveText("model-a");

    // 4) 스트림 종료 → 각 컬럼에 자기 모델 답변이 채워진다(서로 섞이지 않음).
    await section.getByTestId("compare-finish").click();
    const colA = section.getByTestId("compare-column-model-a");
    const colB = section.getByTestId("compare-column-model-b");
    await expect(colA.getByText("model-a 응답")).toBeVisible();
    await expect(colB.getByText("model-b 응답")).toBeVisible();

    // 5) model-a 만 재생성 → model-a 컬럼에 형제 답변이 추가되고 페이저(2/2)가 노출된다.
    //    model-b 컬럼은 페이저가 없다(독립 재생성).
    await colA.getByRole("button", { name: "model-a 재생성" }).click();
    await expect(section.getByTestId("compare-pager-model-a")).toHaveText(
      "2 / 2",
    );
    await expect(section.getByTestId("compare-pager-model-b")).toHaveCount(0);
    await expect(colA.getByText("model-a 재생성")).toBeVisible();

    // 6) model-a 이전 응답으로 이동 → 1/2. model-b 는 영향받지 않는다.
    await colA.getByRole("button", { name: "model-a 이전 응답" }).click();
    await expect(section.getByTestId("compare-pager-model-a")).toHaveText(
      "1 / 2",
    );
    await expect(colA.getByText("model-a 응답")).toBeVisible();
    await expect(colB.getByText("model-b 응답")).toBeVisible();

    await page.screenshot({
      path: "../../.ralph/screenshots/P22-T6-06-compare-columns.png",
      fullPage: true,
    });
  });
});
