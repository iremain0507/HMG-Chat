"use client";

// components/admin/AuditLogTable.tsx — P20-T1-16: 감사 로그(audit_log) 읽기 전용 조회 테이블.
// GET /api/v1/admin/audit-logs 소비, ToolMetricsTable/AnalyticsDashboard 와 동일 고밀도
// 스타일 + 시맨틱 토큰만 사용.
import React from "react";
import { useAdminAuditLogs } from "../../hooks/useAdminAuditLogs";
import { AdminSubNav } from "./AdminSubNav";

const TH_CLASS =
  "border-b border-border px-2.5 py-[7px] text-[11.5px] font-semibold text-fg-muted";

function formatCreatedAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

export function AuditLogTable() {
  const { entries, loading, error, actionFilter, setActionFilter } =
    useAdminAuditLogs();

  return (
    <section>
      <div className="flex items-center gap-2.5">
        <h2 className="text-xl font-bold text-fg">감사 로그</h2>
        <span className="font-mono text-[11px] text-fg-subtle">
          /admin/audit-logs
        </span>
      </div>

      <AdminSubNav />

      <div className="mt-4">
        <label
          htmlFor="audit-log-action-filter"
          className="text-xs font-semibold text-fg-muted"
        >
          action 필터
        </label>
        <input
          id="audit-log-action-filter"
          type="text"
          value={actionFilter}
          onChange={(e) => setActionFilter(e.target.value)}
          placeholder="예: admin.settings.updated"
          className="ml-2 rounded-md border border-border bg-transparent px-2 py-1 text-xs text-fg"
        />
      </div>

      {error && <p className="mt-3 text-sm text-accent">{error}</p>}

      {loading ? (
        <p className="mt-4 text-sm text-fg-muted">불러오는 중…</p>
      ) : entries.length === 0 ? (
        <p className="mt-4 text-sm text-fg-muted">
          표시할 감사 로그가 없습니다.
        </p>
      ) : (
        <table className="mt-2 w-full border-collapse text-[12.5px]">
          <thead>
            <tr>
              <th className={`${TH_CLASS} text-left`}>시각</th>
              <th className={`${TH_CLASS} text-left`}>action</th>
              <th className={`${TH_CLASS} text-left`}>리소스</th>
              <th className={`${TH_CLASS} text-left`}>actor</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry, i) => {
              const rowBorder =
                i === entries.length - 1 ? "" : "border-b border-border";
              return (
                <tr key={entry.id}>
                  <td
                    className={`${rowBorder} px-2.5 py-[6px] font-mono text-xs text-fg`}
                  >
                    {formatCreatedAt(entry.createdAt)}
                  </td>
                  <td
                    className={`${rowBorder} px-2.5 py-[6px] font-mono text-xs text-fg`}
                  >
                    {entry.action}
                  </td>
                  <td
                    className={`${rowBorder} px-2.5 py-[6px] font-mono text-xs text-fg-muted`}
                  >
                    {entry.resourceType
                      ? `${entry.resourceType}${entry.resourceId ? `:${entry.resourceId}` : ""}`
                      : "—"}
                  </td>
                  <td
                    className={`${rowBorder} px-2.5 py-[6px] font-mono text-xs text-fg-muted`}
                  >
                    {entry.actorUserId ?? "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}
