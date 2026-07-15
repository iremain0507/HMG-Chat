// db-reset.ts — 로컬/CI dev DB 를 깨끗한 빈 스키마로 리셋 (마이그레이션 재적용 전 단계).
//   목적: 마이그레이션(0001~) 을 반복 수정하며 개발할 때, 이미 적용된 스키마를 초기화해
//         `pnpm db:migrate` 가 처음부터 다시 적용되게 한다. 통합테스트 globalSetup 이 사용.
//   안전장치: DATABASE_URL 의 DB 이름이 반드시 *_dev / *_test 여야 실행 (prod 보호).
//   접속: DROP/CREATE SCHEMA + CREATE EXTENSION 은 superuser 권한 필요 →
//         로컬 postgres 의 unix 소켓으로 OS superuser(peer) 접속. (앱은 별도 app-role 로 접속)
import pg from "pg";

const appUrl = process.env.DATABASE_URL;
if (!appUrl) {
  console.error("[db-reset] DATABASE_URL 미설정");
  process.exit(1);
}
const parsed = new URL(appUrl);
const dbName = parsed.pathname.replace(/^\//, "");
const appUser = decodeURIComponent(parsed.username) || "wchat";
const port = parsed.port ? Number(parsed.port) : 5432;

if (!/_(dev|test)$/.test(dbName)) {
  console.error(
    `[db-reset] 안전장치: DB '${dbName}' 이 *_dev/*_test 아님 — 리셋 거부`,
  );
  process.exit(1);
}

// superuser 접속: 소켓(peer) — host 를 소켓 디렉토리로 지정하면 pg 가 unix 소켓 사용.
const socketDir = process.env.PGHOST ?? "/tmp";
const superUser = process.env.DB_SUPERUSER ?? process.env.USER ?? "postgres";

const admin = new pg.Client({
  host: socketDir,
  port,
  user: superUser,
  database: dbName,
});

async function main() {
  await admin.connect();
  // public 스키마 통째로 초기화 → 모든 테이블/함수/정책/트리거 제거.
  await admin.query("DROP SCHEMA IF EXISTS public CASCADE");
  await admin.query("CREATE SCHEMA public");
  // drizzle 의 마이그레이션 기록(__drizzle_migrations)은 별도 'drizzle' 스키마에 있음 —
  // 함께 지워야 db:migrate 가 처음부터 재적용한다 (안 지우면 "0 pending" 으로 빈 스키마).
  await admin.query("DROP SCHEMA IF EXISTS drizzle CASCADE");
  await admin.query(
    `GRANT ALL ON SCHEMA public TO ${admin.escapeIdentifier(appUser)}`,
  );
  await admin.query(
    `ALTER SCHEMA public OWNER TO ${admin.escapeIdentifier(appUser)}`,
  );
  // 확장은 superuser 만 생성 가능 → 리셋 시 함께 복원 (P4 knowledge/RAG 에서 필요).
  await admin.query("CREATE EXTENSION IF NOT EXISTS vector");
  await admin.query("CREATE EXTENSION IF NOT EXISTS pg_trgm");
  await admin.end();
  console.warn(
    `[db-reset] '${dbName}' public 스키마 초기화 + 확장(vector,pg_trgm) 복원 완료`,
  );
}

main().catch((e) => {
  console.error("[db-reset] 실패:", e instanceof Error ? e.message : e);
  process.exit(1);
});
