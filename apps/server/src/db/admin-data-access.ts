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
        };
      });
    },
  };
}
