import { test, expect } from "@playwright/test";

// e2e/group-grants.pw.ts — P22-T1-07 브라우저 검증(Layer B, ★needsBrowser).
//   /preview 의 groups-manager 섹션을 실제 chromium 으로 열어, 각 그룹 카드가 subject-scoped
//   GET /api/v1/admin/grants?subjectType=group&subjectId=<id> 로 자기 그룹의 접근 권한을
//   인카드로 (1) 조회 렌더, (2) 부여 폼 제출 시 subjectType=group 으로 POST, (3) 회수 버튼
//   클릭 시 subjectType=group 으로 DELETE 하는지 검증한다. 실 DB 반영·cross-org 격리는
//   admin-grants-subject-composition.test.ts(createApp+실Postgres)가 담당하고, 이 e2e 는
//   클라이언트가 실제 화면에서 그룹 카드 grant CRUD 를 서버 계약대로 호출하는 last-mile 만
//   실제 브라우저 이벤트로 단언한다(L1: 유닛 green ≠ 실사용).
test.describe("P22-T1-07 preview — 그룹 카드 접근 권한(group grants)", () => {
  test("그룹 카드가 subject-scoped 로 grant 를 조회/부여/회수한다", async ({
    page,
  }) => {
    let grants: Array<{
      resourceType: string;
      resourceId: string;
      access: string;
    }> = [{ resourceType: "model", resourceId: "gpt-x", access: "read" }];
    let capturedGetUrl: string | null = null;
    let capturedPostBody: unknown = null;
    let capturedDeleteUrl: string | null = null;

    await page.route("**/api/v1/admin/groups", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: [
            {
              id: "group-1",
              name: "엔지니어링",
              memberUserIds: [],
              createdAt: "2026-01-01T00:00:00.000Z",
              updatedAt: "2026-01-01T00:00:00.000Z",
            },
          ],
        }),
      }),
    );

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
        const body = capturedPostBody as {
          resourceType: string;
          resourceId: string;
          access: string;
        };
        grants = [
          ...grants,
          {
            resourceType: body.resourceType,
            resourceId: body.resourceId,
            access: body.access,
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
        grants = grants.filter(
          (g) => g.resourceId !== url.searchParams.get("resourceId"),
        );
        return route.fulfill({ status: 204, body: "" });
      }
      return route.continue();
    });

    await page.goto("/preview");

    const section = page.getByTestId("preview-groups-manager");
    await section.getByTestId("groups-manager-preview-trigger").click();

    // (1) 카드가 마운트되며 subject-scoped 로 이 그룹의 grant 를 조회·렌더한다.
    await expect
      .poll(() => capturedGetUrl)
      .toBe("/api/v1/admin/grants?subjectType=group&subjectId=group-1");
    await expect(
      section.getByTestId("group-grant-model-gpt-x-read"),
    ).toBeVisible();

    // (2) 인카드 부여 폼 제출 → subjectType=group 으로 POST.
    await section
      .getByLabel("리소스 종류 (엔지니어링)")
      .selectOption("knowledge");
    await section.getByLabel("리소스 ID (엔지니어링)").fill("kb-42");
    await section.getByLabel("접근 레벨 (엔지니어링)").selectOption("read");
    await section.getByLabel("권한 부여 (엔지니어링)").click();

    await expect
      .poll(() => capturedPostBody)
      .toEqual({
        resourceType: "knowledge",
        resourceId: "kb-42",
        subjectType: "group",
        subjectId: "group-1",
        access: "read",
      });
    await expect(
      section.getByTestId("group-grant-knowledge-kb-42-read"),
    ).toBeVisible();

    // (3) 회수 버튼 클릭 → subjectType=group 으로 DELETE.
    await section.getByLabel("권한 회수 (knowledge:kb-42, read)").click();

    await expect
      .poll(() => capturedDeleteUrl)
      .toBe(
        "/api/v1/admin/grants?resourceType=knowledge&resourceId=kb-42&subjectType=group&subjectId=group-1&access=read",
      );
    await expect(
      section.getByTestId("group-grant-knowledge-kb-42-read"),
    ).toBeHidden();
  });
});
