// expand-only 마이그레이션 (additive, backward compatible) 실행.
// v1.0 단순 정책: 모든 migration 이 expand-safe 라고 가정 (CREATE TABLE / ADD COLUMN NULLABLE / CREATE INDEX CONCURRENTLY).
// contract migration (DROP / RENAME / NOT NULL on existing) 은 다음 릴리스의 expand step 으로 분리 — 본 wrapper 가 거부.
// 본 wrapper 는 drizzle-kit migrate 를 그대로 호출하지만, 별도 user (migrator_user) 의 connection string 우선.
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Client } from "pg";
import { resolve } from "node:path";

const url = process.env.DATABASE_URL_MIGRATOR ?? process.env.DATABASE_URL;
if (!url) { console.error("[migrate-expand] DATABASE_URL(_MIGRATOR) 미설정"); process.exit(1); }

const pg = new Client({ connectionString: url });
await pg.connect();
const db = drizzle(pg);

const migrationsFolder = resolve(import.meta.dirname, "..", "src/db/migrations");
console.warn(`[migrate-expand] running from ${migrationsFolder}`);

try {
  await migrate(db, { migrationsFolder });
  console.warn("[migrate-expand] ✓ done");
  await pg.end();
  process.exit(0);
} catch (e) {
  console.error("[migrate-expand] ❌", e);
  await pg.end();
  process.exit(1);
}
