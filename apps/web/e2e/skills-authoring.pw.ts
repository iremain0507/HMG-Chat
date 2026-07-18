import { test, expect } from "@playwright/test";

// e2e/skills-authoring.pw.ts — P22-T6-18(계약 C12) 브라우저 검증.
//   /preview 의 skills-manager 섹션(SkillsManager)을 실제 chromium 으로 열어
//   Open WebUI Workspace > Tools/Functions 파리티(작성 모달 → POST · 활성화 토글 → PATCH ·
//   삭제 confirm → DELETE · 빌트인 불변)를 실제 클릭/입력/키보드로 검증한다.
//   useSkills 의 fetch 는 실 서버 없이 재현 가능하도록 page.route() 로 목킹한다
//   (mcp-servers-manager.pw.ts 와 동일 패턴). 목록 렌더 자체는 skills-manager.pw.ts 담당.
const BUILTIN = {
  id: "wchat-pptx@1.0.0",
  name: "wchat-pptx",
  version: "1.0.0",
  description: "브랜드 PPTX 생성 스킬입니다.",
  triggers: ["ppt"],
  entryPoint: "skills/wchat-pptx/scripts/build.py",
  permissions: "user",
  source: "builtin",
  enabled: true,
};

const MINE = {
  id: "my-report@1.0.0",
  name: "my-report",
  version: "1.0.0",
  description: "분기 실적 보고서를 자동 작성하는 사용자 스킬입니다.",
  triggers: ["보고서"],
  entryPoint: "scripts/build.py",
  permissions: "user",
  source: "user",
  enabled: true,
  skillId: "11111111-1111-1111-1111-111111111111",
};

const VALID_MD = `---
name: my-report
version: 1.0.0
description: 분기 실적 보고서를 자동 작성하는 사용자 스킬입니다.
entryPoint: scripts/build.py
---

# my-report
`;

interface Recorded {
  posts: string[];
  patches: Array<{ url: string; body: string }>;
  deletes: string[];
}

/** 목록 GET 은 rows 를, 변이는 성공 응답을 돌려주며 실제 요청을 기록한다. */
async function mockBackend(
  page: import("@playwright/test").Page,
  rows: unknown[],
): Promise<Recorded> {
  const recorded: Recorded = { posts: [], patches: [], deletes: [] };
  await page.route("**/api/v1/skills**", (route) => {
    const req = route.request();
    const method = req.method();
    if (method === "POST") {
      recorded.posts.push(req.postData() ?? "");
      return route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({ data: MINE }),
      });
    }
    if (method === "PATCH") {
      recorded.patches.push({ url: req.url(), body: req.postData() ?? "" });
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: { ...MINE, enabled: false } }),
      });
    }
    if (method === "DELETE") {
      recorded.deletes.push(req.url());
      return route.fulfill({ status: 204, body: "" });
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: rows }),
    });
  });
  return recorded;
}

async function openSection(page: import("@playwright/test").Page) {
  await page.goto("/preview");
  const section = page.getByTestId("preview-skills-manager");
  await expect(section).toBeVisible();
  await section.getByTestId("skills-manager-preview-trigger").click();
  return section;
}

test.describe("P22-T6-18 — 스킬 작성/활성화/삭제(C12)", () => {
  test("＋ 스킬 작성 모달에 SKILL.md 를 입력하고 저장하면 POST 가 나간다", async ({
    page,
  }) => {
    const recorded = await mockBackend(page, []);
    const section = await openSection(page);

    await section.getByRole("button", { name: "＋ 스킬 작성" }).click();
    const dialog = section.getByRole("dialog", { name: "스킬 작성" });
    await expect(dialog).toBeVisible();

    await dialog.getByLabel("SKILL.md 내용").fill(VALID_MD);
    await dialog.getByRole("button", { name: "저장" }).click();

    await expect(dialog).toBeHidden();
    expect(recorded.posts).toHaveLength(1);
    expect(JSON.parse(recorded.posts[0] ?? "{}")).toEqual({
      skillMd: VALID_MD,
    });
  });

  test("사용자 스킬 토글은 PATCH, 삭제는 확인 후 DELETE 를 호출한다", async ({
    page,
  }) => {
    const recorded = await mockBackend(page, [BUILTIN, MINE]);
    const section = await openSection(page);

    await expect(section.getByText("my-report")).toBeVisible();

    const toggle = section.getByRole("switch", { name: "my-report 활성화" });
    await expect(toggle).toHaveAttribute("aria-checked", "true");
    await toggle.click();
    await expect.poll(() => recorded.patches.length, { timeout: 5000 }).toBe(1);
    expect(recorded.patches[0]?.url).toContain(
      `/api/v1/skills/${MINE.skillId}`,
    );
    expect(JSON.parse(recorded.patches[0]?.body ?? "{}")).toEqual({
      enabled: false,
    });

    // window.confirm 은 브라우저 네이티브 다이얼로그 — 수락 핸들러를 붙인다.
    page.once("dialog", (d) => void d.accept());
    await section.getByRole("button", { name: "my-report 삭제" }).click();
    await expect.poll(() => recorded.deletes.length, { timeout: 5000 }).toBe(1);
    expect(recorded.deletes[0]).toContain(`/api/v1/skills/${MINE.skillId}`);
  });

  test("빌트인 스킬은 '기본 제공' 배지만 갖고 토글·삭제 UI 가 없다", async ({
    page,
  }) => {
    await mockBackend(page, [BUILTIN]);
    const section = await openSection(page);

    await expect(section.getByText("wchat-pptx")).toBeVisible();
    await expect(section.getByText("기본 제공")).toBeVisible();
    await expect(
      section.getByRole("button", { name: "wchat-pptx 삭제" }),
    ).toHaveCount(0);
    await expect(
      section.getByRole("switch", { name: "wchat-pptx 활성화" }),
    ).toHaveCount(0);
  });

  test("작성 모달이 Escape 로 닫히고 트리거로 포커스가 복귀한다(다크)", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem("wchat-theme", "dark");
    });
    await mockBackend(page, [MINE]);
    const section = await openSection(page);
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

    const trigger = section.getByRole("button", { name: "＋ 스킬 작성" });
    await trigger.click();
    await expect(section.getByRole("dialog")).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(section.getByRole("dialog")).toBeHidden();
    await expect(trigger).toBeFocused();

    await section.scrollIntoViewIfNeeded();
    await section.screenshot({
      path: "../../.ralph/screenshots/P22-T6-18-skills-authoring-dark.png",
    });
  });
});
