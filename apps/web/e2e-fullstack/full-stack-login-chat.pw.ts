import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

// e2e-fullstack/full-stack-login-chat.pw.ts — P10-T6-18 (19-UIUX-UPGRADE.md § 19.4.1 Layer 2, 1회).
//   로컬 풀스택(DB + server:4010 + web:3102, playwright.fullstack.config.ts 가 기동)에서
//   magic-link 콘솔 토큰 로그인 → 채팅 → 전송을 실제 chromium 으로 검증하고 화면을 스크린샷한다.
//   dev-stub LLMProvider(ANTHROPIC_API_KEY 미설정) 사용 — tool_use/citation/artifact/hitl 은
//   실 Anthropic 키 없이는 발생하지 않으므로 이 스펙은 로그인→채팅→전송 골든패스만 검증한다
//   (feature_list.json P10-T6-18 acceptance 범위).
const DATABASE_URL =
  process.env.E2E_DATABASE_URL ??
  "postgres://wchat:localdev@localhost:5432/wchat_dev";
const SERVER_LOG = path.resolve(
  __dirname,
  "../../../.ralph/logs/e2e-fullstack-server.log",
);
const SCREENSHOT_DIR = path.resolve(
  __dirname,
  "../../../.ralph/screenshots/e2e",
);

function seedTestOrg() {
  execFileSync(
    "psql",
    [
      DATABASE_URL,
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      `INSERT INTO organizations (name, domain, plan, allowed_models, allowed_tools)
       VALUES ('E2E Fullstack Test Org', 'wchat.dev', 'standard', '["dev-stub"]'::jsonb, '[]'::jsonb)
       ON CONFLICT (domain) DO UPDATE SET allowed_models = EXCLUDED.allowed_models;`,
    ],
    { stdio: "inherit" },
  );
}

async function extractMagicLinkUrl(
  request: import("@playwright/test").APIRequestContext,
  email: string,
  name: string,
): Promise<string> {
  await request.post("/api/v1/auth/signup", { data: { email, name } });

  for (let attempt = 0; attempt < 20; attempt += 1) {
    const log = readFileSync(SERVER_LOG, "utf-8");
    const lines = log.split("\n");
    const toLineIdx = lines.findIndex((l) => l.includes(`to=${email} `));
    if (toLineIdx >= 0) {
      for (
        let i = toLineIdx;
        i < Math.min(lines.length, toLineIdx + 5);
        i += 1
      ) {
        const m = lines[i].match(
          /href="([^"]+magic-link\/verify\?token=[^"]+)"/,
        );
        if (m) return m[1];
      }
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`magic-link URL not found in server log for ${email}`);
}

test.describe("P10 phase-end 풀스택 e2e — 로그인 → 채팅 → 전송", () => {
  test.beforeAll(() => {
    seedTestOrg();
  });

  test("magic-link 콘솔 토큰 로그인 후 채팅 메시지를 보내고 응답을 받는다", async ({
    page,
    request,
  }) => {
    const email = `e2e-fullstack-${test.info().workerIndex}-${Date.now()}@wchat.dev`;
    const verifyUrl = await extractMagicLinkUrl(
      request,
      email,
      "E2E Fullstack User",
    );
    const verifyPath = new URL(verifyUrl).pathname + new URL(verifyUrl).search;

    // 1) 로그인: magic-link verify → 302 → "/" 홈 착지
    await page.goto(verifyPath);
    await expect(page.getByText(/안녕하세요,/)).toBeVisible({
      timeout: 15_000,
    });
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, "01-login-home.png"),
      fullPage: true,
    });

    // 2) 새 채팅 시작 → 채팅 화면(AppShell + SessionList + ChatInput)
    await page.getByRole("button", { name: "＋ 새 채팅 시작" }).click();
    await page.waitForURL(/\/chat\/.+/);
    const input = page.getByLabel("메시지 입력");
    await expect(input).toBeVisible({ timeout: 15_000 });
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, "02-chat-empty.png"),
      fullPage: true,
    });

    // 3) 메시지 전송 → user 말풍선 + assistant 응답(dev-stub echo) 렌더
    await input.fill("Hello WChat P10 e2e");
    await page.getByRole("button", { name: "전송" }).click();

    await expect(page.locator('li[data-role="user"]').last()).toContainText(
      "Hello WChat P10 e2e",
    );
    await expect(page.locator('li[data-role="assistant"]').last()).toBeVisible({
      timeout: 15_000,
    });
    await expect(
      page.locator('li[data-role="assistant"]').last(),
    ).toContainText("Hello WChat P10 e2e", { timeout: 15_000 });

    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, "03-chat-message-sent.png"),
      fullPage: true,
    });
  });
});
