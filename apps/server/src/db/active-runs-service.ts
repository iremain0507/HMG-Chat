// sessions_active_runs DB layer — 06-DATA-MODEL.md § 0003 / 14-INTERFACES.md SessionRepo.
// status 전이(pending/running/cancelled/completed)는 DB CHECK constraint 가 single source of truth.
import type { ActiveRunStatus } from "@wchat/interfaces";
import { pgPool } from "./client";

export interface ActiveRun {
  sessionId: string;
  jobId: string;
  status: ActiveRunStatus;
  pendingHitl: unknown | null;
  startedAt: Date;
  updatedAt: Date;
}

export async function setActiveRun(
  sessionId: string,
  jobId: string,
  status: ActiveRunStatus,
): Promise<void> {
  await pgPool.query(
    `INSERT INTO sessions_active_runs (session_id, job_id, status)
     VALUES ($1, $2, $3)
     ON CONFLICT (session_id)
     DO UPDATE SET job_id = EXCLUDED.job_id, status = EXCLUDED.status, updated_at = NOW()`,
    [sessionId, jobId, status],
  );
}

export async function clearActiveRun(sessionId: string): Promise<void> {
  await pgPool.query("DELETE FROM sessions_active_runs WHERE session_id = $1", [
    sessionId,
  ]);
}

export async function getActiveRun(
  sessionId: string,
): Promise<ActiveRun | null> {
  const res = await pgPool.query(
    `SELECT session_id, job_id, status, pending_hitl, started_at, updated_at
     FROM sessions_active_runs WHERE session_id = $1`,
    [sessionId],
  );
  const row = res.rows[0];
  if (!row) return null;
  return {
    sessionId: row.session_id,
    jobId: row.job_id,
    status: row.status,
    pendingHitl: row.pending_hitl,
    startedAt: row.started_at,
    updatedAt: row.updated_at,
  };
}
