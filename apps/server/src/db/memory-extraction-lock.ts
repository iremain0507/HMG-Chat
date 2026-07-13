// memory_extraction_locks DB layer — 06-DATA-MODEL.md § 0008 (Redis-like, DB 로 durability 확보).
// INSERT..ON CONFLICT..DO UPDATE..WHERE 는 단일 row 에 대해 atomic 하므로 동시 acquire 중
// 정확히 하나만 성공한다 (active-runs-service.ts 의 upsert 패턴과 동일 원리).
import { pgPool } from "./client";

export async function acquireExtractionLock(
  sessionId: string,
  ttlMs: number,
): Promise<boolean> {
  const res = await pgPool.query(
    `INSERT INTO memory_extraction_locks (session_id, locked_at, expires_at)
     VALUES ($1, NOW(), NOW() + ($2 || ' milliseconds')::INTERVAL)
     ON CONFLICT (session_id) DO UPDATE
       SET locked_at = NOW(), expires_at = NOW() + ($2 || ' milliseconds')::INTERVAL
       WHERE memory_extraction_locks.expires_at < NOW()
     RETURNING session_id`,
    [sessionId, ttlMs],
  );
  return res.rowCount === 1;
}

export async function releaseExtractionLock(sessionId: string): Promise<void> {
  await pgPool.query(
    "DELETE FROM memory_extraction_locks WHERE session_id = $1",
    [sessionId],
  );
}
