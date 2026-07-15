"use client";

// components/admin/AdminUsersManager.tsx — 18-FRONTEND-WIREFRAMES § /admin/users
// 테이블(email/orgId/role/status/lastLogin) + role 변경 dropdown + suspend 토글.
// suspend 사유는 window.prompt 로 최소 입력(별도 modal 은 acceptance 범위 밖).
import React from "react";
import { useAdminUsers, type AdminUserDto } from "../../hooks/useAdminUsers";

const ROLES: AdminUserDto["role"][] = ["member", "admin", "owner"];

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

  if (loading) return <p>불러오는 중…</p>;
  if (error) return <p className="text-accent">{error}</p>;
  if (users.length === 0)
    return <p className="text-fg-muted">사용자가 없습니다.</p>;

  return (
    <table>
      <thead>
        <tr>
          <th>이메일</th>
          <th>이름</th>
          <th>조직</th>
          <th>역할</th>
          <th>상태</th>
          <th>최근 로그인</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {users.map((u) => (
          <tr key={u.id}>
            <td>{u.email}</td>
            <td>{u.name}</td>
            <td>{u.orgId}</td>
            <td>
              <select
                aria-label={`역할 (${u.email})`}
                value={u.role}
                onChange={(e) =>
                  changeRole(u.id, e.target.value as AdminUserDto["role"])
                }
              >
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </td>
            <td>{u.status}</td>
            <td>{u.lastLoginAt ?? "-"}</td>
            <td>
              <button
                type="button"
                className="text-accent"
                aria-label={`${u.status === "suspended" ? "정지 해제" : "정지"} (${u.email})`}
                onClick={() => handleSuspendToggle(u)}
              >
                {u.status === "suspended" ? "정지 해제" : "정지"}
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
