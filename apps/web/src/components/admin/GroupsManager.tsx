"use client";

// components/admin/GroupsManager.tsx — P19-T6-18: RBAC 관리 UI(그룹).
//   /api/v1/admin/groups(P19-T1-13) 를 hooks/useGroups.ts 로 소비 — 그룹 생성·이름변경·삭제
//   + 멤버 추가/제거. ApiKeysManager 와 동일한 카드형 레이아웃/토큰 컨벤션.
//   리소스별(resource_grants, P19-T1-14) 접근 부여 토글은 이번 반복에서 범위 축소(PROGRESS.md
//   참고) — 해당 DB 레이어는 grantsForResource(리소스별 조회)만 지원해 "그룹이 가진 전체 권한
//   목록"을 나열할 조회 API 가 없고, 관리용 HTTP CRUD 라우트도 아직 없어(P19-T1-14 는 코어
//   canAccessResource 판정 로직까지만 구현) 이 T6 태스크의 파일 소유권(apps/web/src/) 만으로는
//   완성할 수 없다. 후속 T1 라우트(목록/부여/철회) 추가 후 이어서 배선.
import React, { useState } from "react";
import { useGroups, type GroupDto } from "../../hooks/useGroups";
import { AdminSubNav } from "./AdminSubNav";

const FOCUS_RING =
  "outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--focus-ring)] focus-visible:outline-offset-2";

export function GroupsManager() {
  const {
    groups,
    loading,
    error,
    createGroup,
    renameGroup,
    removeGroup,
    addMember,
    removeMember,
  } = useGroups();
  const [newGroupName, setNewGroupName] = useState("");
  const [memberInputs, setMemberInputs] = useState<Record<string, string>>({});

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    const name = newGroupName.trim();
    if (!name) return;
    await createGroup(name);
    setNewGroupName("");
  }

  function handleRename(g: GroupDto) {
    const name = window.prompt("새 그룹 이름을 입력하세요.", g.name);
    if (!name || !name.trim() || name.trim() === g.name) return;
    void renameGroup(g.id, name.trim());
  }

  async function handleAddMember(g: GroupDto) {
    const userId = (memberInputs[g.id] ?? "").trim();
    if (!userId) return;
    await addMember(g.id, userId);
    setMemberInputs((prev) => ({ ...prev, [g.id]: "" }));
  }

  return (
    <section>
      <div className="flex items-center gap-2.5">
        <h2 className="text-xl font-bold text-fg">그룹 관리</h2>
        <span className="font-mono text-[11px] text-fg-subtle">
          /admin/groups
        </span>
      </div>

      <AdminSubNav />

      <form onSubmit={(e) => void handleCreate(e)} className="mt-4 flex gap-2">
        <input
          aria-label="새 그룹 이름"
          value={newGroupName}
          onChange={(e) => setNewGroupName(e.target.value)}
          placeholder="새 그룹 이름"
          className={`h-8 w-full max-w-xs rounded-md border border-border bg-bg px-2.5 text-[13px] text-fg ${FOCUS_RING}`}
        />
        <button
          type="submit"
          disabled={!newGroupName.trim()}
          className={`h-8 shrink-0 rounded-md bg-primary px-3.5 text-[12.5px] font-semibold text-primary-fg disabled:opacity-60 ${FOCUS_RING}`}
        >
          ＋ 그룹 생성
        </button>
      </form>

      {error && <p className="mt-3 text-sm text-accent">{error}</p>}

      {loading ? (
        <p className="mt-4 text-sm text-fg-muted">불러오는 중…</p>
      ) : groups.length === 0 ? (
        <p className="mt-4 text-sm text-fg-muted">그룹이 없습니다.</p>
      ) : (
        <div className="mt-5 grid grid-cols-1 gap-3.5 sm:grid-cols-2">
          {groups.map((g) => (
            <div
              key={g.id}
              data-testid={`group-card-${g.id}`}
              className="rounded-[10px] border border-border bg-bg p-4"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="text-[14px] font-semibold text-fg">
                  {g.name}
                </div>
                <div className="flex shrink-0 gap-2.5">
                  <button
                    type="button"
                    aria-label={`이름 변경 (${g.name})`}
                    onClick={() => handleRename(g)}
                    className={`text-xs text-fg-muted ${FOCUS_RING}`}
                  >
                    이름 변경
                  </button>
                  <button
                    type="button"
                    aria-label={`삭제 (${g.name})`}
                    onClick={() => void removeGroup(g.id)}
                    className={`text-xs text-accent ${FOCUS_RING}`}
                  >
                    삭제
                  </button>
                </div>
              </div>

              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {g.memberUserIds.length === 0 ? (
                  <span className="text-xs text-fg-subtle">멤버 없음</span>
                ) : (
                  g.memberUserIds.map((uid) => (
                    <span
                      key={uid}
                      className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[11px] text-fg"
                    >
                      {uid}
                      <button
                        type="button"
                        aria-label={`멤버 제거 (${uid})`}
                        onClick={() => void removeMember(g.id, uid)}
                        className={`text-fg-subtle hover:text-accent ${FOCUS_RING}`}
                      >
                        ×
                      </button>
                    </span>
                  ))
                )}
              </div>

              <div className="mt-2.5 flex gap-1.5">
                <input
                  aria-label={`멤버 추가 (${g.name})`}
                  value={memberInputs[g.id] ?? ""}
                  onChange={(e) =>
                    setMemberInputs((prev) => ({
                      ...prev,
                      [g.id]: e.target.value,
                    }))
                  }
                  placeholder="userId"
                  className={`h-7 flex-1 rounded-md border border-border bg-bg px-2 text-xs text-fg ${FOCUS_RING}`}
                />
                <button
                  type="button"
                  aria-label={`멤버 추가 버튼 (${g.name})`}
                  onClick={() => void handleAddMember(g)}
                  className={`h-7 shrink-0 rounded-md border border-border px-2.5 text-xs text-fg ${FOCUS_RING}`}
                >
                  추가
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
