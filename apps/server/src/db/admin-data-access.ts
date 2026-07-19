// db/admin-data-access.ts — 16-API-CONTRACT.md § 14 GET /admin/dashboard, GET /admin/users,
// PATCH /admin/users/:id, POST /admin/users/:id/{suspend,unsuspend}, GET /admin/tool-metrics 단일 출처.
// 14-INTERFACES.md 의 Repo<User,UserFilter>(날짜/검색 필드 없음)·ToolMetricRepo.aggregate(toolName
// 필수, 전체 집계 불가)로는 이 admin 조회를 표현 못해(admin/health/history 의 from/to 미지원과 동일
// 사유) route-local AdminDataAccess(raw SQL 집계)로 구현 — role/status 변경·suspend 는 기존
// users 테이블 UPDATE + refresh_token_families 재사용(auth-data-access.ts 와 동일 org 범위 SQL).
import type { User } from "@wchat/interfaces";
import { pgPool } from "./client.js";

export interface AdminDashboardSummary {
  users: { total: number; activeLast24h: number; newLast7d: number };
  sessions: { total: number; activeNow: number; completedLast24h: number };
  errors: { last24h: number; last7d: number; critical: number };
  tools: { totalCalls24h: number; errorRate: number; p50LatencyMs: number };
}

export interface AdminToolMetricSummary {
  toolName: string;
  count: number;
  errorCount: number;
  errorRate: number;
  p50DurationMs: number;
  p95DurationMs: number;
  p99DurationMs: number;
  last24h: { count: number; errorRate: number };
  /** 툴 출처(0039 tool_metrics.source). 해당 툴의 최빈 source — 기존 NULL 행은
   *  'builtin' 으로 해석한다(하위호환). (P22-T6-19 / C17B) */
  source: ToolMetricSource;
  /** 최근 7일 일별 호출 추이. 항상 7 포인트(과거→현재), 기록 없는 날은 0 으로 채운다.
   *  admin 화면의 스파크라인 단일 출처. (P22-T6-19) */
  trend: Array<{ date: string; count: number; errorCount: number }>;
}

export type ToolMetricSource = "builtin" | "mcp" | "skill" | "openapi";

const TREND_DAYS = 7;

function toDayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** 툴별 source 분포 행에서 최빈 출처를 고른다. NULL(=0039 이전 행)은 'builtin'.
 *  행이 없으면 'builtin'. 순수 함수 — DB 없이 단언 가능. (P22-T6-19) */
export function pickPredominantSource(
  rows: Array<{ source: string | null; count: number }>,
): ToolMetricSource {
  let best: ToolMetricSource = "builtin";
  let bestCount = -1;
  const tally = new Map<ToolMetricSource, number>();
  for (const row of rows) {
    const key = (row.source ?? "builtin") as ToolMetricSource;
    tally.set(key, (tally.get(key) ?? 0) + row.count);
  }
  for (const [key, count] of tally) {
    if (count > bestCount) {
      best = key;
      bestCount = count;
    }
  }
  return best;
}

/** 일별 집계 행을 7 포인트(과거→현재)로 zero-fill 한다. 윈도우 밖 날짜는 버린다.
 *  순수 함수 — DB 없이 단언 가능. (P22-T6-19) */
export function buildToolMetricsTrend(
  rows: Array<{ day: string; count: number; errorCount: number }>,
  to: Date,
): Array<{ date: string; count: number; errorCount: number }> {
  const byDay = new Map(rows.map((r) => [r.day, r]));
  const end = new Date(
    Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate()),
  );
  const points: Array<{ date: string; count: number; errorCount: number }> = [];
  for (let offset = TREND_DAYS - 1; offset >= 0; offset -= 1) {
    const day = new Date(end);
    day.setUTCDate(day.getUTCDate() - offset);
    const date = toDayKey(day);
    const row = byDay.get(date);
    points.push({
      date,
      count: row?.count ?? 0,
      errorCount: row?.errorCount ?? 0,
    });
  }
  return points;
}

export interface AdminDataAccess {
  dashboardSummary(orgId: string): Promise<AdminDashboardSummary>;
  listUsers(
    orgId: string,
    filter: { search?: string; status?: User["status"] },
    limit: number,
  ): Promise<User[]>;
  patchUser(
    orgId: string,
    userId: string,
    patch: { role?: User["role"]; status?: User["status"] },
  ): Promise<User | null>;
  suspendUser(
    orgId: string,
    userId: string,
  ): Promise<{ sessionsRevoked: number } | null>;
  unsuspendUser(orgId: string, userId: string): Promise<boolean>;
  deleteUser(
    orgId: string,
    userId: string,
    requesterId: string,
  ): Promise<
    | { ok: true }
    | {
        ok: false;
        reason: "not_found" | "self" | "primary_owner" | "last_owner";
      }
  >;
  toolMetricsSummary(
    orgId: string,
    from: Date,
    to: Date,
  ): Promise<AdminToolMetricSummary[]>;
}

function toUser(row: Record<string, unknown>): User {
  return {
    id: row.id as string,
    orgId: row.org_id as string,
    email: row.email as string,
    name: (row.name as string | null) ?? null,
    role: row.role as User["role"],
    customInstructions: (row.custom_instructions as string | null) ?? null,
    // 0036_user_language — NULL = 서버 기본(ko).
    language: (row.language as string | null) ?? null,
    status: row.status as User["status"],
    lastLoginAt: (row.last_login_at as Date | null) ?? null,
    createdAt: row.created_at as Date,
  };
}

function num(v: unknown): number {
  return v === null || v === undefined ? 0 : Number(v);
}

export function createPgAdminDataAccess(): AdminDataAccess {
  return {
    async dashboardSummary(orgId) {
      const res = await pgPool.query(
        `SELECT
           (SELECT COUNT(*) FROM users WHERE org_id = $1) AS users_total,
           (SELECT COUNT(*) FROM users WHERE org_id = $1 AND last_login_at >= NOW() - INTERVAL '24 hours') AS users_active_24h,
           (SELECT COUNT(*) FROM users WHERE org_id = $1 AND created_at >= NOW() - INTERVAL '7 days') AS users_new_7d,
           (SELECT COUNT(*) FROM sessions s JOIN users u ON u.id = s.user_id WHERE u.org_id = $1) AS sessions_total,
           (SELECT COUNT(*) FROM sessions_active_runs sar
              JOIN sessions s ON s.id = sar.session_id
              JOIN users u ON u.id = s.user_id
              WHERE u.org_id = $1 AND sar.status = 'running') AS sessions_active_now,
           (SELECT COUNT(*) FROM sessions_active_runs sar
              JOIN sessions s ON s.id = sar.session_id
              JOIN users u ON u.id = s.user_id
              WHERE u.org_id = $1 AND sar.status = 'completed' AND sar.updated_at >= NOW() - INTERVAL '24 hours') AS sessions_completed_24h,
           (SELECT COUNT(*) FROM error_logs WHERE org_id = $1 AND created_at >= NOW() - INTERVAL '24 hours') AS errors_24h,
           (SELECT COUNT(*) FROM error_logs WHERE org_id = $1 AND created_at >= NOW() - INTERVAL '7 days') AS errors_7d,
           (SELECT COUNT(*) FROM error_logs WHERE org_id = $1 AND level = 'fatal' AND created_at >= NOW() - INTERVAL '7 days') AS errors_critical,
           (SELECT COUNT(*) FROM tool_metrics WHERE org_id = $1 AND created_at >= NOW() - INTERVAL '24 hours') AS tools_calls_24h,
           (SELECT COUNT(*) FILTER (WHERE status IN ('error','timeout')) FROM tool_metrics WHERE org_id = $1 AND created_at >= NOW() - INTERVAL '24 hours') AS tools_errors_24h,
           (SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY duration_ms) FROM tool_metrics WHERE org_id = $1 AND created_at >= NOW() - INTERVAL '24 hours') AS tools_p50_24h
        `,
        [orgId],
      );
      const row = res.rows[0] as Record<string, unknown>;
      const toolsCalls24h = num(row.tools_calls_24h);
      const toolsErrors24h = num(row.tools_errors_24h);
      return {
        users: {
          total: num(row.users_total),
          activeLast24h: num(row.users_active_24h),
          newLast7d: num(row.users_new_7d),
        },
        sessions: {
          total: num(row.sessions_total),
          activeNow: num(row.sessions_active_now),
          completedLast24h: num(row.sessions_completed_24h),
        },
        errors: {
          last24h: num(row.errors_24h),
          last7d: num(row.errors_7d),
          critical: num(row.errors_critical),
        },
        tools: {
          totalCalls24h: toolsCalls24h,
          errorRate: toolsCalls24h > 0 ? toolsErrors24h / toolsCalls24h : 0,
          p50LatencyMs: num(row.tools_p50_24h),
        },
      };
    },

    async listUsers(orgId, filter, limit) {
      const conditions = ["org_id = $1"];
      const values: unknown[] = [orgId];
      if (filter.status) {
        values.push(filter.status);
        conditions.push(`status = $${values.length}`);
      } else {
        conditions.push(`status != 'deleted'`);
      }
      if (filter.search) {
        values.push(`%${filter.search}%`);
        conditions.push(`email ILIKE $${values.length}`);
      }
      values.push(limit);
      const res = await pgPool.query(
        `SELECT * FROM users WHERE ${conditions.join(" AND ")}
         ORDER BY created_at DESC LIMIT $${values.length}`,
        values,
      );
      return res.rows.map(toUser);
    },

    async patchUser(orgId, userId, patch) {
      const res = await pgPool.query(
        `UPDATE users SET
           role = COALESCE($3, role),
           status = COALESCE($4, status),
           updated_at = NOW()
         WHERE id = $2 AND org_id = $1
         RETURNING *`,
        [orgId, userId, patch.role ?? null, patch.status ?? null],
      );
      return res.rows[0] ? toUser(res.rows[0]) : null;
    },

    async suspendUser(orgId, userId) {
      const res = await pgPool.query(
        `UPDATE users SET status = 'suspended', updated_at = NOW()
         WHERE id = $2 AND org_id = $1 RETURNING id`,
        [orgId, userId],
      );
      if (res.rows.length === 0) return null;
      const revoked = await pgPool.query(
        `UPDATE refresh_token_families SET revoked_at = NOW(), revoke_reason = 'admin'
         WHERE user_id = $1 AND revoked_at IS NULL`,
        [userId],
      );
      return { sessionsRevoked: revoked.rowCount ?? 0 };
    },

    async unsuspendUser(orgId, userId) {
      const res = await pgPool.query(
        `UPDATE users SET status = 'active', updated_at = NOW()
         WHERE id = $2 AND org_id = $1 RETURNING id`,
        [orgId, userId],
      );
      return res.rows.length > 0;
    },

    async deleteUser(orgId, userId, requesterId) {
      if (userId === requesterId) {
        return { ok: false, reason: "self" };
      }
      const targetRes = await pgPool.query(
        `SELECT role, status FROM users WHERE id = $1 AND org_id = $2`,
        [userId, orgId],
      );
      const target = targetRes.rows[0] as
        { role: User["role"]; status: User["status"] } | undefined;
      if (!target || target.status === "deleted") {
        return { ok: false, reason: "not_found" };
      }
      if (target.role === "owner") {
        const ownersRes = await pgPool.query(
          `SELECT id FROM users WHERE org_id = $1 AND role = 'owner' AND status != 'deleted'
           ORDER BY created_at ASC`,
          [orgId],
        );
        const owners = ownersRes.rows.map((r) => r.id as string);
        if (owners.length <= 1) {
          return { ok: false, reason: "last_owner" };
        }
        if (owners[0] === userId) {
          return { ok: false, reason: "primary_owner" };
        }
      }
      const res = await pgPool.query(
        `UPDATE users SET status = 'deleted', updated_at = NOW()
         WHERE id = $2 AND org_id = $1 RETURNING id`,
        [orgId, userId],
      );
      if (res.rows.length === 0) {
        return { ok: false, reason: "not_found" };
      }
      await pgPool.query(
        `UPDATE refresh_token_families SET revoked_at = NOW(), revoke_reason = 'admin'
         WHERE user_id = $1 AND revoked_at IS NULL`,
        [userId],
      );
      return { ok: true };
    },

    async toolMetricsSummary(orgId, from, to) {
      const windowed = await pgPool.query(
        `SELECT tool_name,
           COUNT(*) AS count,
           COUNT(*) FILTER (WHERE status IN ('error','timeout')) AS error_count,
           PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY duration_ms) AS p50,
           PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY duration_ms) AS p95,
           PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY duration_ms) AS p99
         FROM tool_metrics
         WHERE org_id = $1 AND created_at BETWEEN $2 AND $3
         GROUP BY tool_name`,
        [orgId, from, to],
      );
      const last24h = await pgPool.query(
        `SELECT tool_name,
           COUNT(*) AS count,
           COUNT(*) FILTER (WHERE status IN ('error','timeout')) AS error_count
         FROM tool_metrics
         WHERE org_id = $1 AND created_at >= NOW() - INTERVAL '24 hours'
         GROUP BY tool_name`,
        [orgId],
      );
      // P22-T6-19(C17B) — 0039 tool_metrics.source 분포. NULL(기존 행)도 그대로 받아
      //   pickPredominantSource 가 'builtin' 으로 해석한다.
      const sources = await pgPool.query(
        `SELECT tool_name, source, COUNT(*) AS count
         FROM tool_metrics
         WHERE org_id = $1 AND created_at BETWEEN $2 AND $3
         GROUP BY tool_name, source`,
        [orgId, from, to],
      );
      // P22-T6-19 — 최근 7일 일별 추이(스파크라인용). 조회 윈도우와 무관하게 항상 7일.
      const daily = await pgPool.query(
        `SELECT tool_name,
           TO_CHAR(DATE_TRUNC('day', created_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS day,
           COUNT(*) AS count,
           COUNT(*) FILTER (WHERE status IN ('error','timeout')) AS error_count
         FROM tool_metrics
         WHERE org_id = $1
           AND created_at >= $2::timestamptz - INTERVAL '6 days'
           AND created_at <= $2::timestamptz
         GROUP BY tool_name, day`,
        [orgId, to],
      );

      const last24hByTool = new Map<
        string,
        { count: number; errorCount: number }
      >();
      for (const row of last24h.rows as Record<string, unknown>[]) {
        last24hByTool.set(row.tool_name as string, {
          count: num(row.count),
          errorCount: num(row.error_count),
        });
      }
      const sourcesByTool = new Map<
        string,
        Array<{ source: string | null; count: number }>
      >();
      for (const row of sources.rows as Record<string, unknown>[]) {
        const toolName = row.tool_name as string;
        const list = sourcesByTool.get(toolName) ?? [];
        list.push({
          source: (row.source as string | null) ?? null,
          count: num(row.count),
        });
        sourcesByTool.set(toolName, list);
      }
      const dailyByTool = new Map<
        string,
        Array<{ day: string; count: number; errorCount: number }>
      >();
      for (const row of daily.rows as Record<string, unknown>[]) {
        const toolName = row.tool_name as string;
        const list = dailyByTool.get(toolName) ?? [];
        list.push({
          day: row.day as string,
          count: num(row.count),
          errorCount: num(row.error_count),
        });
        dailyByTool.set(toolName, list);
      }

      return (windowed.rows as Record<string, unknown>[]).map((row) => {
        const toolName = row.tool_name as string;
        const count = num(row.count);
        const errorCount = num(row.error_count);
        const bucket = last24hByTool.get(toolName) ?? {
          count: 0,
          errorCount: 0,
        };
        return {
          toolName,
          count,
          errorCount,
          errorRate: count > 0 ? errorCount / count : 0,
          p50DurationMs: num(row.p50),
          p95DurationMs: num(row.p95),
          p99DurationMs: num(row.p99),
          last24h: {
            count: bucket.count,
            errorRate: bucket.count > 0 ? bucket.errorCount / bucket.count : 0,
          },
          source: pickPredominantSource(sourcesByTool.get(toolName) ?? []),
          trend: buildToolMetricsTrend(dailyByTool.get(toolName) ?? [], to),
        };
      });
    },
  };
}
