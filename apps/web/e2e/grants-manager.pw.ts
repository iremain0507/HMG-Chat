import { test, expect } from "@playwright/test";

// e2e/grants-manager.pw.ts — P20-T6-11 브라우저 검증(Layer 1, ★needsBrowser).
//   /preview 의 grants-manager 섹션을 실제 chromium 으로 열어 (1) 리소스 조회 폼 제출 시
//   GET /api/v1/admin/grants 가 정확한 쿼리로 호출되고 목록이 렌더되는지, (2) 부여 폼 제출 시
//   POST 가 올바른 body 로 호출되는지, (3) 회수 버튼 클릭 시 DELETE 가 올바른 쿼리로 호출되는지를
//   검증한다. 실앱 dev-login E2E 하네스는 이 세션에 아직 없어(§2, P20-T6-04/06/08/T1-07 과
//   동일 사유) /preview 갤러리 + route 목킹을 브라우저 레이어로 쓴다. 실제 DB 반영·cross-org
//   격리·조회 노출 변화(서버측 실배선)는 createApp+실Postgres 통합테스트
//   (admin-grants-composition.test.ts, resource-grants-enforcement-composition.test.ts)가 담당한다
//   — 이 e2e 는 클라이언트가 실제 화면에서 grant CRUD 를 서버 계약대로 왜곡 없이 호출하는
//   last-mile 만 검증한다.
test.describe("P20-T6-11 preview — 접근 권한(grants) 관리 UI", () => {
  test("리소스 조회→부여→회수 흐름이 서버 계약대로 호출된다", async ({
    page,
  }) => {
    let grants: Array<{
      subjectType: string;
      subjectId: string;
      access: string;
    }> = [];
    let capturedGetUrl: string | null = null;
    let capturedPostBody: unknown = null;
    let capturedDeleteUrl: string | null = null;

    await page.route("**/api/v1/admin/grants*", (route) => {
      const req = route.request();
      const url = new URL(req.url());
      if (req.method() === "GET") {
        capturedGetUrl = url.pathname + url.search;
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ data: grants }),
        });
      }
      if (req.method() === "POST") {
        capturedPostBody = req.postDataJSON();
        grants = [
          ...grants,
          {
            subjectType: (capturedPostBody as { subjectType: string })
              .subjectType,
            subjectId: (capturedPostBody as { subjectId: string }).subjectId,
            access: (capturedPostBody as { access: string }).access,
          },
        ];
        return route.fulfill({
          status: 201,
          contentType: "application/json",
          body: JSON.stringify({ data: {} }),
        });
      }
      if (req.method() === "DELETE") {
        capturedDeleteUrl = url.pathname + url.search;
        grants = [];
        return route.fulfill({ status: 204, body: "" });
      }
      return route.continue();
    });

    await page.goto("/preview");

    const section = page.getByTestId("preview-grants-manager");
    await section.getByTestId("grants-manager-preview-trigger").click();

    await section.getByLabel("리소스 종류").selectOption("knowledge");
    await section.getByLabel("리소스 ID").fill("doc-1");
    await section.getByRole("button", { name: "조회" }).click();

    await expect
      .poll(() => capturedGetUrl)
      .toBe("/api/v1/admin/grants?resourceType=knowledge&resourceId=doc-1");
    await expect(section.getByText("권한이 없습니다.")).toBeVisible();

    await section.getByLabel("대상 종류").selectOption("group");
    await section.getByLabel("대상 ID").fill("group-1");
    await section.getByLabel("접근 레벨").selectOption("read");
    await section.getByRole("button", { name: "부여" }).click();

    await expect
      .poll(() => capturedPostBody)
      .toEqual({
        resourceType: "knowledge",
        resourceId: "doc-1",
        subjectType: "group",
        subjectId: "group-1",
        access: "read",
      });
    await expect(section.getByText("group-1")).toBeVisible();

    await section.getByRole("button", { name: "회수 (group-1, read)" }).click();

    await expect
      .poll(() => capturedDeleteUrl)
      .toBe(
        "/api/v1/admin/grants?resourceType=knowledge&resourceId=doc-1&subjectType=group&subjectId=group-1&access=read",
      );
    await expect(section.getByText("권한이 없습니다.")).toBeVisible();
  });
});
