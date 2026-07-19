import { test, expect } from "@playwright/test";

// e2e/notes.pw.ts — P22-T6-17 브라우저 검증(Layer 1).
//   /preview 의 notes-workspace 섹션(NotesWorkspace)을 실제 chromium 으로 열어
//   편집 → 저장 / AI 개선 / 삭제 확인 흐름이 실 DOM·실 네트워크로 동작하는지 확인한다.
//   useNotes 의 fetch 는 실 서버 없이 재현 가능하도록 page.route() 로 목킹한다
//   (connections.pw.ts / agent-gallery.pw.ts 와 동일 패턴).
const NOW = "2026-07-18T09:00:00.000Z";

type NoteRow = {
  id: string;
  orgId: string;
  userId: string;
  title: string;
  content: string;
  createdAt: string;
  updatedAt: string;
};

type Captured = { patchBody?: Record<string, unknown>; deleteCount: number };

const SEED: NoteRow = {
  id: "note-1",
  orgId: "org-1",
  userId: "user-1",
  title: "설비 점검 메모",
  content: "# 점검\n\n- 항목 1",
  createdAt: NOW,
  updatedAt: NOW,
};

async function mockBackend(
  page: import("@playwright/test").Page,
  captured: Captured,
) {
  let rows: NoteRow[] = [{ ...SEED }];

  // enhance 는 저장된 본문을 다듬어 *저장까지* 마친 노트를 돌려준다(서버 계약).
  await page.route("**/api/v1/notes/*/enhance", (route) => {
    const id = route
      .request()
      .url()
      .match(/notes\/([^/]+)\/enhance/)?.[1];
    const row = rows.find((r) => r.id === id) as NoteRow;
    const improved: NoteRow = {
      ...row,
      content: `${row.content}\n\n> AI 가 다듬은 문단.`,
      updatedAt: NOW,
    };
    rows = rows.map((r) => (r.id === id ? improved : r));
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: improved,
        meta: { requestId: "req-enhance" },
      }),
    });
  });

  await page.route("**/api/v1/notes/*", (route) => {
    const method = route.request().method();
    const id = route
      .request()
      .url()
      .match(/notes\/([^/?]+)/)?.[1];

    if (method === "PATCH") {
      captured.patchBody = route.request().postDataJSON() as Record<
        string,
        unknown
      >;
      rows = rows.map((r) =>
        r.id === id ? { ...r, ...captured.patchBody, updatedAt: NOW } : r,
      );
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: rows.find((r) => r.id === id),
          meta: { requestId: "req-patch" },
        }),
      });
    }

    if (method === "DELETE") {
      captured.deleteCount += 1;
      rows = rows.filter((r) => r.id !== id);
      return route.fulfill({ status: 204, body: "" });
    }

    return route.fallback();
  });

  await page.route("**/api/v1/notes", (route) => {
    if (route.request().method() === "POST") {
      const created: NoteRow = {
        ...SEED,
        id: `note-${rows.length + 1}`,
        title: "제목 없는 노트",
        content: "",
      };
      rows = [created, ...rows];
      return route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          data: created,
          meta: { requestId: "req-post" },
        }),
      });
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: rows, meta: { requestId: "req-list" } }),
    });
  });
}

async function openWorkspace(page: import("@playwright/test").Page) {
  await page.goto("/preview");
  const section = page.getByTestId("preview-notes-workspace");
  await section.getByTestId("notes-workspace-preview-trigger").click();
  // 목록이 로드되면 첫 노트가 자동 선택돼 에디터가 채워진다.
  await expect(section.getByLabel("노트 제목")).toHaveValue("설비 점검 메모");
  return section;
}

test.describe("P22-T6-17 노트 워크스페이스", () => {
  test("본문을 편집하면 dirty 배지가 뜨고 저장하면 PATCH 가 나간다", async ({
    page,
  }) => {
    const captured: Captured = { deleteCount: 0 };
    await mockBackend(page, captured);
    const section = await openWorkspace(page);

    // 변경 전에는 저장이 비활성 — 불필요한 PATCH 를 막는다.
    await expect(section.getByTestId("note-save")).toBeDisabled();
    await expect(section.getByTestId("note-dirty")).toHaveCount(0);

    await section
      .getByLabel("노트 본문(마크다운)")
      .fill("# 점검\n\n- 항목 1\n- 항목 2");

    await expect(section.getByTestId("note-dirty")).toBeVisible();
    await section.getByTestId("note-save").click();

    await expect(section.getByTestId("note-dirty")).toHaveCount(0);
    expect(captured.patchBody?.content).toBe("# 점검\n\n- 항목 1\n- 항목 2");
  });

  test("AI 개선을 누르면 개선된 본문이 에디터에 반영된다", async ({ page }) => {
    const captured: Captured = { deleteCount: 0 };
    await mockBackend(page, captured);
    const section = await openWorkspace(page);

    await section.getByTestId("note-enhance").click();

    await expect(section.getByLabel("노트 본문(마크다운)")).toHaveValue(
      "# 점검\n\n- 항목 1\n\n> AI 가 다듬은 문단.",
    );
    await expect(section.getByTestId("note-dirty")).toHaveCount(0);
  });

  test("삭제는 확인 단계를 거친 뒤에만 DELETE 를 보낸다", async ({ page }) => {
    const captured: Captured = { deleteCount: 0 };
    await mockBackend(page, captured);
    const section = await openWorkspace(page);

    await section.getByTestId("note-delete").click();
    // 확인 대화가 뜬 시점에는 아직 DELETE 가 나가지 않았다.
    const dialog = section.getByRole("alertdialog", { name: "노트 삭제 확인" });
    await expect(dialog).toBeVisible();
    expect(captured.deleteCount).toBe(0);

    await section.getByTestId("note-delete-confirm").click();

    await expect(section.getByTestId("notes-workspace")).toContainText(
      "아직 노트가 없습니다",
    );
    expect(captured.deleteCount).toBe(1);
  });
});
