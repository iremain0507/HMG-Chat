// backfill-session-titles.ts — P18-T1-01: 기존 '(제목 없음)' 세션(title=null) 일회성 백필.
//   app.ts 의 ensureSession(P17-uat-fix)이 신규 세션은 생성 시점에 title 을 채우므로, 그
//   이전에 만들어진 세션만 대상. title IS NULL 가드로 UPDATE 하므로 재실행해도 안전.
import { Client } from "pg";
import { backfillSessionTitles } from "../src/lib/backfill-session-titles.js";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("[backfill-session-titles] DATABASE_URL 미설정");
  process.exit(1);
}

const pg = new Client({ connectionString: url });
await pg.connect();
try {
  const { updated, skipped } = await backfillSessionTitles(pg);
  console.warn(
    `[backfill-session-titles] updated=${updated} skipped=${skipped}`,
  );
} finally {
  await pg.end();
}
process.exit(0);
