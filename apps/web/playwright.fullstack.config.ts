import { defineConfig, devices } from "@playwright/test";

// apps/web/playwright.fullstack.config.ts — P10-T6-18 (19-UIUX-UPGRADE.md § 19.4.1 Layer 2).
//   phase-end 1회 풀스택 e2e: 로컬 DB + server(:4010) + web(:3102) 실 프로세스 기동 후
//   magic-link 콘솔 토큰으로 로그인 → 채팅 → 전송을 실제 chromium 으로 검증.
//   Layer 1(playwright.config.ts, testDir ./e2e, :3100)과 완전히 분리된 포트/testDir —
//   병행 실행/게이트 간섭 없음. 실행: `pnpm exec playwright test --config playwright.fullstack.config.ts`.
const DATABASE_URL =
  process.env.E2E_DATABASE_URL ??
  "postgres://wchat:localdev@localhost:5432/wchat_dev";
const SERVER_LOG = "../../.ralph/logs/e2e-fullstack-server.log";

export default defineConfig({
  testDir: "./e2e-fullstack",
  testMatch: "**/*.pw.ts",
  outputDir: "../../.ralph/screenshots/_pw-fullstack-artifacts",
  fullyParallel: false,
  retries: 0,
  timeout: 60_000,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:3102",
    screenshot: "only-on-failure",
    trace: "off",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: [
        "PORT=4010",
        `DATABASE_URL="${DATABASE_URL}"`,
        'REDIS_URL="redis://localhost:6379"',
        'JWT_SECRET="e2e-fullstack-test-secret-key-minimum-32-chars-long"',
        'ALLOWED_DOMAINS="wchat.dev,gmail.com"',
        'EMAIL_SENDER_KIND="console"',
        'APP_ORIGIN="http://localhost:3102"',
        'NODE_ENV="development"',
        "pnpm --filter @wchat/server exec tsx src/index.ts",
        `> ${SERVER_LOG} 2>&1`,
      ].join(" "),
      url: "http://localhost:4010/health",
      reuseExistingServer: true,
      timeout: 120_000,
    },
    {
      command:
        'NEXT_PUBLIC_API_BASE="http://localhost:4010/api/v1" pnpm --filter @wchat/web exec next dev --port 3102',
      url: "http://localhost:3102/login",
      reuseExistingServer: true,
      timeout: 120_000,
    },
  ],
});
