"use client";

// components/admin/AdminUsersManager.tsx — design-reference F15(관리자) 핸드오프 정렬
// (P13-T6-13). §3.9 이중 밀도 테이블 + 역할 select/정지 토글은 기존 동작(useAdminUsers)
// 그대로 — 재현은 외형·상태 배지뿐. suspend 사유는 window.prompt 최소 입력(별도 모달은
// acceptance 범위 밖, 기존 결정 유지).
import React from "react";
import { useAdminUsers, type AdminUserDto } from "../../hooks/useAdminUsers";
import { AdminSubNav } from "./AdminSubNav";

const ROLES: AdminUserDto["role"][] = ["member", "admin", "owner"];

const FOCUS_RING =
  "outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--focus-ring)] focus-visible:outline-offset-2";

const STATUS_BADGE: Record<AdminUserDto["status"], string> = {
  active: "border-success/30 bg-success-soft text-success",
  suspended: "border-accent/30 bg-accent/10 text-accent",
};

const TH_CLASS =
  "border-b border-border px-2.5 py-[7px] text-left text-[11.5px] font-semibold text-fg-muted";

export function AdminUsersManager() {
  const { users, loading, error, changeRole, suspend, unsuspend } =
    useAdminUsers();

  async function handleSuspendToggle(u: AdminUserDto) {
    if (u.status === "suspended") {
      await unsuspend(u.id);
      return;
    }
    const reason = window.prompt("정지 사유를 입력하세요.");
    if (!reason) return;
    await suspend(u.id, reason);
  }

  return (
    <section>
      <div className="flex items-center gap-2.5">
        <h2 className="text-xl font-bold text-fg">사용자 관리</h2>
        <span className="font-mono text-[11px] text-fg-subtle">
          /admin/users
        </span>
      </div>

      <AdminSubNav />

      {error && <p className="mt-3 text-sm text-accent">{error}</p>}

      {loading ? (
        <p className="mt-4 text-sm text-fg-muted">불러오는 중…</p>
      ) : users.length === 0 ? (
        <p className="mt-4 text-sm text-fg-muted">사용자가 없습니다.</p>
      ) : (
        <table className="mt-4 w-full border-collapse text-[12.5px]">
          <thead>
            <tr>
              <th className={TH_CLASS}>이메일</th>
              <th className={TH_CLASS}>이름</th>
              <th className={TH_CLASS}>조직</th>
              <th className={TH_CLASS}>역할</th>
              <th className={TH_CLASS}>상태</th>
              <th className={TH_CLASS}>최근 로그인</th>
              <th className={TH_CLASS}></th>
            </tr>
          </thead>
          <tbody>
            {users.map((u, i) => {
              const rowBorder =
                i === users.length - 1 ? "" : "border-b border-border";
              return (
                <tr key={u.id}>
                  <td className={`${rowBorder} px-2.5 py-[6px] text-fg`}>
                    {u.email}
                  </td>
                  <td className={`${rowBorder} px-2.5 py-[6px] text-fg`}>
                    {u.name}
                  </td>
                  <td
                    className={`${rowBorder} px-2.5 py-[6px] font-mono text-xs text-fg-muted`}
                  >
                    {u.orgId}
                  </td>
                  <td className={`${rowBorder} px-2.5 py-[6px]`}>
                    <select
                      aria-label={`역할 (${u.email})`}
                      value={u.role}
                      onChange={(e) =>
                        changeRole(u.id, e.target.value as AdminUserDto["role"])
                      }
                      className={`rounded-md border border-border bg-bg px-2 py-1 text-xs text-fg ${FOCUS_RING}`}
                    >
                      {ROLES.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className={`${rowBorder} px-2.5 py-[6px]`}>
                    <span
                      className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium ${STATUS_BADGE[u.status]}`}
                    >
                      {u.status}
                    </span>
                  </td>
                  <td
                    className={`${rowBorder} px-2.5 py-[6px] font-mono text-xs tabular-nums text-fg-muted`}
                  >
                    {u.lastLoginAt ?? "-"}
                  </td>
                  <td className={`${rowBorder} px-2.5 py-[6px] text-right`}>
                    <button
                      type="button"
                      className={`text-xs font-medium text-accent ${FOCUS_RING}`}
                      aria-label={`${u.status === "suspended" ? "정지 해제" : "정지"} (${u.email})`}
                      onClick={() => handleSuspendToggle(u)}
                    >
                      {u.status === "suspended" ? "정지 해제" : "정지"}
                    </button>
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
