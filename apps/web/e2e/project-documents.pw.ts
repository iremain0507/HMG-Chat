import { test, expect } from "@playwright/test";

// e2e/project-documents.pw.ts — P13-T6-10 브라우저 검증(Layer 1).
//   /preview 의 project-documents 섹션(ProjectDetail+DocumentsPanel, F09)을 실제 chromium
//   으로 열어 문서 인덱싱 상태 테이블(indexed·embedding 진행 중·failed+재시도)이
//   design-reference 핸드오프대로 렌더/동작하는지 검증한다. useProject/useDocuments 의
//   fetch 는 실 서버 없이도 재현 가능하도록 page.route() 로 목킹한다(app-shell.pw.ts 와 동일 패턴).
const PROJECT_ID = "preview-project-1";

const DOCS = [
  {
    id: "doc-1",
    projectId: PROJECT_ID,
    filename: "HVAC_설계검토_v3.pdf",
    contentHash: "hash1",
    mimeType: "application/pdf",
    sizeBytes: 8_200_000,
    indexStatus: "indexed",
    chunkCount: 42,
    indexedAt: "2026-06-20T00:00:00Z",
    failureReason: null,
    createdBy: "user-1",
    createdAt: "2026-06-20T00:00:00Z",
    updatedAt: "2026-06-20T00:00:00Z",
  },
  {
    id: "doc-2",
    projectId: PROJECT_ID,
    filename: "e-COMP_사양서.docx",
    contentHash: "hash2",
    mimeType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    sizeBytes: 3_400_000,
    indexStatus: "embedding",
    chunkCount: 0,
    indexedAt: null,
    failureReason: null,
    createdBy: "user-1",
    createdAt: "2026-07-15T00:00:00Z",
    updatedAt: "2026-07-15T00:00:00Z",
  },
  {
    id: "doc-3",
    projectId: PROJECT_ID,
    filename: "구형매뉴얼.pdf",
    contentHash: "hash3",
    mimeType: "application/pdf",
    sizeBytes: 12_000_000,
    indexStatus: "failed",
    chunkCount: 0,
    indexedAt: null,
    failureReason: "암호화된 PDF",
    createdBy: "user-1",
    createdAt: "2026-06-12T00:00:00Z",
    updatedAt: "2026-06-12T00:00:00Z",
  },
];

async function mockBackend(page: import("@playwright/test").Page) {
  await page.route(`**/api/v1/projects/${PROJECT_ID}`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          id: PROJECT_ID,
          name: "HVAC 개발 문서",
          description: "HVAC 개발 관련 사내 문서 프로젝트",
          visibility: "team",
          orgUnitId: null,
          ownerId: "user-1",
          createdAt: "2026-06-01T00:00:00Z",
        },
      }),
    }),
  );
  let doc3Retried = false;
  await page.route(`**/api/v1/documents?projectId=${PROJECT_ID}`, (route) => {
    if (route.request().method() !== "GET") return route.continue();
    const docs = doc3Retried
      ? DOCS.map((d) =>
          d.id === "doc-3"
            ? { ...d, indexStatus: "pending", failureReason: null }
            : d,
        )
      : DOCS;
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: docs }),
    });
  });
  await page.route(`**/api/v1/documents/doc-3/retry`, (route) => {
    doc3Retried = true;
    return route.fulfill({
      status: 202,
      contentType: "application/json",
      body: JSON.stringify({
        data: { documentId: "doc-3", indexStatus: "pending" },
      }),
    });
  });
}

test.describe("P13 preview — 프로젝트 상세/문서 인덱싱 상태 테이블(F09) 핸드오프 정렬", () => {
  test("indexed·embedding·failed 상태가 모두 렌더되고 재시도가 동작한다(라이트)", async ({
    page,
  }) => {
    await mockBackend(page);
    await page.goto("/preview");

    const section = page.getByTestId("preview-project-documents");
    await expect(section).toBeVisible();
    await section.getByTestId("project-detail-preview-trigger").click();

    await expect(section.getByText("HVAC 개발 문서")).toBeVisible();
    await expect(section.getByText("팀")).toBeVisible();

    await expect(section.getByText("HVAC_설계검토_v3.pdf")).toBeVisible();
    await expect(section.getByText("인덱스 완료")).toBeVisible();

    await expect(section.getByText("e-COMP_사양서.docx")).toBeVisible();
    const embeddingRow = section
      .getByText("e-COMP_사양서.docx")
      .locator("xpath=ancestor::tr");
    await expect(embeddingRow.getByText("임베딩중")).toBeVisible();
    await expect(
      embeddingRow.getByTestId("document-progress-doc-2"),
    ).toBeVisible();

    await expect(section.getByText("구형매뉴얼.pdf")).toBeVisible();
    await expect(section.getByText("암호화된 PDF")).toBeVisible();
    const retryButton = section.getByRole("button", { name: "다시 시도" });
    await expect(retryButton).toBeVisible();

    await retryButton.click();
    await expect(section.getByText("암호화된 PDF")).toBeHidden();

    await section.scrollIntoViewIfNeeded();
    await section.screenshot({
      path: "../../.ralph/screenshots/project-documents-light.png",
    });
  });

  test("다크 테마에서도 상태 테이블이 정상 렌더된다", async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem("wchat-theme", "dark");
    });
    await mockBackend(page);
    await page.goto("/preview");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

    const section = page.getByTestId("preview-project-documents");
    await section.getByTestId("project-detail-preview-trigger").click();

    await expect(section.getByText("HVAC_설계검토_v3.pdf")).toBeVisible();
    await expect(section.getByText("인덱스 완료")).toBeVisible();
    await expect(section.getByText("실패")).toBeVisible();

    await section.scrollIntoViewIfNeeded();
    await section.screenshot({
      path: "../../.ralph/screenshots/project-documents-dark.png",
    });
  });
});
