"use client";

// components/admin/AdminUsersManager.tsx — design-reference F15(관리자) 핸드오프 정렬
// (P13-T6-13). §3.9 이중 밀도 테이블 + 역할 select/정지 토글은 기존 동작(useAdminUsers)
// 그대로 — 재현은 외형·상태 배지뿐. suspend 사유는 window.prompt 최소 입력(별도 모달은
// acceptance 범위 밖, 기존 결정 유지).
import React from "react";
import { useAdminUsers, type AdminUserDto } from "../../hooks/useAdminUsers";
import { useCurrentUser } from "../../hooks/useCurrentUser";
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

// P20-T1-13 — 서버(db/admin-data-access.ts deleteUser)와 동일한 판정 로직을 클라이언트에서
// 미리 계산해 삭제 버튼을 disabled+사유로 안내한다(서버는 여전히 최종 권위자로 동일 가드 재검증).
function deleteGuardReason(
  target: AdminUserDto,
  users: AdminUserDto[],
  currentUserId: string | null,
): string | null {
  if (currentUserId && target.id === currentUserId) {
    return "자기 자신은 삭제할 수 없습니다.";
  }
  if (target.role === "owner") {
    const owners = users
      .filter((u) => u.role === "owner")
      .slice()
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    if (owners.length <= 1) {
      return "조직의 마지막 owner 는 삭제할 수 없습니다.";
    }
    if (owners[0]?.id === target.id) {
      return "최고 관리자(primary admin)는 삭제할 수 없습니다.";
    }
  }
  return null;
}

export function AdminUsersManager() {
  const { users, loading, error, changeRole, suspend, unsuspend, deleteUser } =
    useAdminUsers();
  const { user: currentUser } = useCurrentUser();

  async function handleSuspendToggle(u: AdminUserDto) {
    if (u.status === "suspended") {
      await unsuspend(u.id);
      return;
    }
    const reason = window.prompt("정지 사유를 입력하세요.");
    if (!reason) return;
    await suspend(u.id, reason);
  }

  async function handleDelete(u: AdminUserDto) {
    if (!window.confirm(`${u.email} 사용자를 삭제하시겠습니까?`)) return;
    const outcome = await deleteUser(u.id);
    if (!outcome.ok && outcome.message) {
      window.alert(outcome.message);
    }
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
              const guardReason = deleteGuardReason(
                u,
                users,
                currentUser?.id ?? null,
              );
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
                    <button
                      type="button"
                      disabled={!!guardReason}
                      title={guardReason ?? undefined}
                      className={`ml-2 text-xs font-medium text-accent disabled:cursor-not-allowed disabled:text-fg-subtle disabled:opacity-60 ${FOCUS_RING}`}
                      aria-label={`삭제 (${u.email})`}
                      onClick={() => handleDelete(u)}
                    >
                      삭제
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
