import { test, expect } from "@playwright/test";

// e2e/admin-users-delete.pw.ts — P20-T1-13 브라우저 검증(Layer 1, ★needsBrowser).
//   /preview 의 admin-users-manager 섹션을 실제 chromium 으로 열어 (1) primary owner(org
//   최고령 owner)는 삭제 버튼이 disabled+사유(title)로 안내되는지, (2) 일반 member 는 삭제
//   확인(window.confirm) 후 DELETE 가 호출되고 목록에서 제거되는지, (3) 서버가 409(primary
//   owner 거부)를 반환하면 window.alert 로 사유가 노출되는지를 검증한다. 실앱 dev-login E2E
//   하네스는 이 세션에 아직 없어(§2, 동일 사유) /preview 갤러리 + route 목킹을 브라우저
//   레이어로 쓴다. 실제 DB soft-delete·primary/last-owner 가드·cross-org 격리는 이미
//   createApp+실Postgres 통합테스트(admin-users-delete-composition.test.ts)가 담당한다 —
//   이 e2e 는 클라이언트가 실제 화면에서 삭제 가드/흐름을 서버 계약대로 왜곡 없이 렌더·호출
//   하는 last-mile 만 검증한다.
const PRIMARY_OWNER = {
  id: "owner-primary",
  email: "owner-primary@example.com",
  name: "최고 관리자",
  orgId: "org-1",
  role: "owner" as const,
  status: "active" as const,
  lastLoginAt: null,
  createdAt: "2026-01-01T00:00:00Z",
};

const SECOND_OWNER = {
  id: "owner-second",
  email: "owner-second@example.com",
  name: "부관리자",
  orgId: "org-1",
  role: "owner" as const,
  status: "active" as const,
  lastLoginAt: null,
  createdAt: "2026-01-15T00:00:00Z",
};

const MEMBER = {
  id: "member-1",
  email: "member-1@example.com",
  name: "일반 사용자",
  orgId: "org-1",
  role: "member" as const,
  status: "active" as const,
  lastLoginAt: "2026-07-01T00:00:00Z",
  createdAt: "2026-02-01T00:00:00Z",
};

async function mockBackend(
  page: import("@playwright/test").Page,
  opts: { deleteStatus?: number; deleteBody?: unknown } = {},
) {
  let users = [PRIMARY_OWNER, SECOND_OWNER, MEMBER];
  await page.route("**/api/v1/admin/users/**", (route) => {
    if (route.request().method() !== "DELETE") return route.continue();
    const status = opts.deleteStatus ?? 200;
    if (status === 200) {
      const id = route.request().url().split("/").pop();
      users = users.filter((u) => u.id !== id);
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: { ok: true } }),
      });
    }
    return route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(
        opts.deleteBody ?? {
          error: {
            message: "최고 관리자(primary admin)는 삭제할 수 없습니다.",
          },
        },
      ),
    });
  });
  await page.route("**/api/v1/admin/users", (route) => {
    if (route.request().method() !== "GET") return route.continue();
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: users }),
    });
  });
  await page.route("**/api/v1/auth/me", (route) =>
    route.fulfill({ status: 401, body: "" }),
  );
}

test.describe("P20-T1-13 preview — 관리자 사용자 삭제(primary admin 보호)", () => {
  test("primary owner 는 삭제 버튼 disabled + 사유 안내", async ({ page }) => {
    await mockBackend(page);
    await page.goto("/preview");

    const usersManager = page.getByTestId("preview-admin-users-manager");
    await usersManager
      .getByTestId("admin-users-manager-preview-trigger")
      .click();
    await expect(usersManager.getByText(PRIMARY_OWNER.email)).toBeVisible();

    const deleteBtn = usersManager.getByRole("button", {
      name: `삭제 (${PRIMARY_OWNER.email})`,
    });
    await expect(deleteBtn).toBeDisabled();
    await expect(deleteBtn).toHaveAttribute(
      "title",
      "최고 관리자(primary admin)는 삭제할 수 없습니다.",
    );
  });

  test("일반 member 삭제 확인 → DELETE 호출 후 목록에서 제거", async ({
    page,
  }) => {
    await mockBackend(page);
    page.on("dialog", (d) => d.accept());
    await page.goto("/preview");

    const usersManager = page.getByTestId("preview-admin-users-manager");
    await usersManager
      .getByTestId("admin-users-manager-preview-trigger")
      .click();
    await expect(usersManager.getByText(MEMBER.email)).toBeVisible();

    const deleteBtn = usersManager.getByRole("button", {
      name: `삭제 (${MEMBER.email})`,
    });
    await expect(deleteBtn).toBeEnabled();
    await deleteBtn.click();

    await expect(usersManager.getByText(MEMBER.email)).toHaveCount(0);
    await expect(usersManager.getByText(PRIMARY_OWNER.email)).toBeVisible();
  });

  test("서버 거부(409) 시 alert 로 사유가 노출되고 목록은 유지된다", async ({
    page,
  }) => {
    await mockBackend(page, { deleteStatus: 409 });
    let alertMessage: string | null = null;
    page.on("dialog", (d) => {
      if (d.type() === "alert") alertMessage = d.message();
      void d.accept();
    });
    await page.goto("/preview");

    const usersManager = page.getByTestId("preview-admin-users-manager");
    await usersManager
      .getByTestId("admin-users-manager-preview-trigger")
      .click();

    const deleteBtn = usersManager.getByRole("button", {
      name: `삭제 (${MEMBER.email})`,
    });
    await deleteBtn.click();

    await expect
      .poll(() => alertMessage)
      .toBe("최고 관리자(primary admin)는 삭제할 수 없습니다.");
    await expect(usersManager.getByText(MEMBER.email)).toBeVisible();
  });
});
