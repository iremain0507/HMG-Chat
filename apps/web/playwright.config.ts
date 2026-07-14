import { defineConfig, devices } from "@playwright/test";

// apps/web/playwright.config.ts — P10 브라우저 검증(Layer 1).
//   /preview 라우트(컴포넌트 격리 갤러리) 대상 headless chromium 스모크.
//   · vitest 충돌 회피: Playwright 스펙은 e2e/**/*.pw.ts (vitest 의 .test/.spec 미매칭).
//   · dev :3000 충돌 회피: 전용 3100 인스턴스 자동 기동(reuse 가능).
//   · 인증/서버/DB 불필요 — 프리뷰 라우트는 목/stub 로 컴포넌트만 렌더.
export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.pw.ts",
  outputDir: "../../.ralph/screenshots/_pw-artifacts",
  fullyParallel: false,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:3100",
    screenshot: "only-on-failure",
    trace: "off",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "pnpm exec next dev --port 3100",
    url: "http://localhost:3100/preview",
    reuseExistingServer: true,
    timeout: 120_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
