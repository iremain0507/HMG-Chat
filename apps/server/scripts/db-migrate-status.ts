// 현재 schema 와 migration journal 의 차이 출력 (CI 의 migrate-status job 이 호출).
// drizzle-kit 의 status 명령이 직접 없으므로 journal 과 DB 비교를 통해 pending 확인.
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { Client } from "pg";

const journalPath = resolve(import.meta.dirname, "..", "src/db/migrations/meta/_journal.json");
if (!existsSync(journalPath)) {
  console.error("[migrate-status] _journal.json 없음");
  process.exit(1);
}
const journal = JSON.parse(readFileSync(journalPath, "utf-8")) as { entries: Array<{ idx: number; tag: string; when: number }> };

const url = process.env.DATABASE_URL;
if (!url) { console.error("[migrate-status] DATABASE_URL 미설정"); process.exit(1); }

const pg = new Client({ connectionString: url });
await pg.connect();

const tableExists = await pg.query(`SELECT to_regclass('public.__drizzle_migrations') AS t`);
if (!tableExists.rows[0].t) {
  console.warn(`[migrate-status] __drizzle_migrations 없음 — ${journal.entries.length} pending`);
  await pg.end();
  process.exit(0);
}

const applied = await pg.query<{ hash: string; created_at: string }>(`SELECT hash, created_at FROM __drizzle_migrations ORDER BY created_at`);
const pending = journal.entries.length - applied.rows.length;
console.warn(`[migrate-status] applied=${applied.rows.length} journal=${journal.entries.length} pending=${pending}`);
if (pending > 0) {
  for (let i = applied.rows.length; i < journal.entries.length; i++) {
    console.warn(`  pending: ${journal.entries[i]!.tag}`);
  }
}
await pg.end();
process.exit(0);
