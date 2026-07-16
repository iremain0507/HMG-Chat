// lib/backfill-session-titles.ts — P18-T1-01: title=null 인 기존 세션(app.ts ensureSession
//   도입 이전에 생성돼 첫 메시지로도 제목이 채워지지 않은 세션)을 첫 사용자 메시지에서
//   deriveSessionTitle 로 백필한다. 메시지가 없는 세션은 파생할 원문이 없으므로 null 유지.
//   title IS NULL 가드로 UPDATE 하므로 재실행해도 안전(idempotent) — 이미 채워진 세션은
//   건드리지 않는다.
import { deriveSessionTitle } from "./session-title.js";

interface QueryResult<T> {
  rows: T[];
  rowCount: number | null;
}

export interface QueryableClient {
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    params?: unknown[],
  ): Promise<QueryResult<T>>;
}

export async function backfillSessionTitles(
  client: QueryableClient,
): Promise<{ updated: number; skipped: number }> {
  const { rows } = await client.query<{ id: string; content: unknown }>(
    `SELECT s.id, m.content
     FROM sessions s
     JOIN LATERAL (
       SELECT content FROM messages
       WHERE session_id = s.id AND role = 'user'
       ORDER BY created_at ASC LIMIT 1
     ) m ON true
     WHERE s.title IS NULL`,
  );

  let updated = 0;
  let skipped = 0;
  for (const row of rows) {
    const firstContent =
      typeof row.content === "string" ? row.content : undefined;
    const title = deriveSessionTitle(firstContent);
    if (!title) {
      skipped++;
      continue;
    }
    const res = await client.query(
      `UPDATE sessions SET title = $1 WHERE id = $2 AND title IS NULL`,
      [title, row.id],
    );
    if ((res.rowCount ?? 0) > 0) updated++;
    else skipped++;
  }
  return { updated, skipped };
}
