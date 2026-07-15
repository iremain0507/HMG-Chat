// vitest globalSetup (통합테스트 전용) — 매 통합테스트 실행 전에 dev DB 를 리셋 + 재마이그레이션.
//   목적: 마이그레이션(RLS 정책 등)을 반복 수정하며 개발할 때, 편집한 마이그레이션이
//         매 test:integration 실행에 즉시 반영되게 한다 (이미 적용된 스키마에 막히지 않음).
//   db:reset = scripts/db-reset.ts(public/drizzle 스키마 초기화 + 확장 복원) + db:migrate.
import { execSync } from "node:child_process";
import { resolve } from "node:path";

export async function setup() {
  const serverRoot = resolve(import.meta.dirname, "..", "..", "..");
  execSync("pnpm db:reset", { cwd: serverRoot, stdio: "inherit" });
}
