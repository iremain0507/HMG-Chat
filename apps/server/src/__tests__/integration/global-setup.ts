// vitest globalSetup (통합테스트 전용) — 매 통합테스트 실행 전에 **별도 test DB(wchat_test)** 를
//   리셋 + 재마이그레이션한다. dev DB(wchat_dev)는 절대 건드리지 않는다(과거엔 dev DB 를 리셋해
//   개발 데이터가 통합테스트 1회 실행에 전부 사라지는 문제가 있었음).
//   db:reset = scripts/db-reset.ts(public/drizzle 스키마 초기화 + 확장 복원) + db:migrate.
import { execSync } from "node:child_process";
import { resolve } from "node:path";
import pg from "pg";
import { TEST_DATABASE_URL } from "./test-database.js";

export async function setup() {
  const dbName = new URL(TEST_DATABASE_URL).pathname.replace(/^\//, "");
  // 안전장치: 통합테스트는 반드시 *_test DB 만 리셋한다(dev/prod 보호).
  if (!dbName.endsWith("_test")) {
    throw new Error(
      `[integration] TEST_DATABASE_URL 은 *_test DB 여야 합니다(현재: ${dbName}). dev 보호.`,
    );
  }
  await ensureDatabaseExists(dbName);
  // db:reset 을 test DB 로 실행(DATABASE_URL override) — wchat_dev 는 건드리지 않는다.
  const serverRoot = resolve(import.meta.dirname, "..", "..", "..");
  execSync("pnpm db:reset", {
    cwd: serverRoot,
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
  });
}

// test DB 가 없으면 생성(maintenance DB=postgres 로 접속). best-effort — 이미 존재/권한부족 시 무시.
async function ensureDatabaseExists(dbName: string): Promise<void> {
  const adminUrl = new URL(TEST_DATABASE_URL);
  adminUrl.pathname = "/postgres";
  const admin = new pg.Client({ connectionString: adminUrl.toString() });
  try {
    await admin.connect();
    const { rowCount } = await admin.query(
      "SELECT 1 FROM pg_database WHERE datname = $1",
      [dbName],
    );
    if (!rowCount) {
      await admin.query(`CREATE DATABASE ${admin.escapeIdentifier(dbName)}`);
    }
  } catch {
    /* best-effort — 존재하거나 권한 부족이면 db:reset 이 최종 판단 */
  } finally {
    await admin.end().catch(() => {});
  }
}
