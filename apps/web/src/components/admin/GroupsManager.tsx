"use client";

// components/admin/GroupsManager.tsx — P19-T6-18: RBAC 관리 UI(그룹).
//   /api/v1/admin/groups(P19-T1-13) 를 hooks/useGroups.ts 로 소비 — 그룹 생성·이름변경·삭제
//   + 멤버 추가/제거. ApiKeysManager 와 동일한 카드형 레이아웃/토큰 컨벤션.
//   P22-T1-07: subject-scoped GET /api/v1/admin/grants?subjectType=group&subjectId=… 가
//   추가되어, 각 그룹 카드가 그 그룹이 보유한 리소스별 접근 권한을 인카드로 조회/부여/회수한다
//   (useGroupGrants). Open WebUI 그룹 권한 편집 플로우 참조 · 디자인은 시맨틱 토큰 유지.
import React, { useEffect, useState } from "react";
import { useGroups, type GroupDto } from "../../hooks/useGroups";
import {
  useGroupGrants,
  type GrantAccessLevel,
  type GrantResourceType,
} from "../../hooks/useGrants";
import { AdminSubNav } from "./AdminSubNav";

const GRANT_RESOURCE_TYPES: GrantResourceType[] = [
  "model",
  "knowledge",
  "tool",
  "prompt",
];
const GRANT_ACCESS_LEVELS: GrantAccessLevel[] = ["read", "write"];

function GroupGrantsSection({
  groupId,
  groupName,
}: {
  groupId: string;
  groupName: string;
}) {
  const { grants, error, load, grant, revoke } = useGroupGrants(groupId);
  const [resourceType, setResourceType] =
    useState<GrantResourceType>("knowledge");
  const [resourceId, setResourceId] = useState("");
  const [access, setAccess] = useState<GrantAccessLevel>("read");

  useEffect(() => {
    void load();
  }, [load]);

  async function handleGrant(e: React.FormEvent) {
    e.preventDefault();
    const id = resourceId.trim();
    if (!id) return;
    await grant(resourceType, id, access);
    setResourceId("");
  }

  return (
    <div className="mt-3 border-t border-border pt-2.5">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">
        접근 권한
      </div>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {grants.length === 0 ? (
          <span className="text-xs text-fg-subtle">부여된 권한 없음</span>
        ) : (
          grants.map((gr) => (
            <span
              key={`${gr.resourceType}-${gr.resourceId}-${gr.access}`}
              data-testid={`group-grant-${gr.resourceType}-${gr.resourceId}-${gr.access}`}
              className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[11px] text-fg"
            >
              <span className="text-fg-muted">{gr.resourceType}</span>
              <span>{gr.resourceId}</span>
              <span className="text-fg-muted">· {gr.access}</span>
              <button
                type="button"
                aria-label={`권한 회수 (${gr.resourceType}:${gr.resourceId}, ${gr.access})`}
                onClick={() =>
                  void revoke(gr.resourceType, gr.resourceId, gr.access)
                }
                className={`text-fg-subtle hover:text-accent ${FOCUS_RING}`}
              >
                ×
              </button>
            </span>
          ))
        )}
      </div>

      {error && <p className="mt-1.5 text-xs text-accent">{error}</p>}

      <form
        onSubmit={(e) => void handleGrant(e)}
        className="mt-2 flex flex-wrap items-center gap-1.5"
      >
        <select
          aria-label={`리소스 종류 (${groupName})`}
          value={resourceType}
          onChange={(e) => setResourceType(e.target.value as GrantResourceType)}
          className={`h-7 rounded-md border border-border bg-bg px-1.5 text-xs text-fg ${FOCUS_RING}`}
        >
          {GRANT_RESOURCE_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <input
          aria-label={`리소스 ID (${groupName})`}
          value={resourceId}
          onChange={(e) => setResourceId(e.target.value)}
          placeholder="resourceId"
          className={`h-7 flex-1 rounded-md border border-border bg-bg px-2 text-xs text-fg ${FOCUS_RING}`}
        />
        <select
          aria-label={`접근 레벨 (${groupName})`}
          value={access}
          onChange={(e) => setAccess(e.target.value as GrantAccessLevel)}
          className={`h-7 rounded-md border border-border bg-bg px-1.5 text-xs text-fg ${FOCUS_RING}`}
        >
          {GRANT_ACCESS_LEVELS.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
        <button
          type="submit"
          aria-label={`권한 부여 (${groupName})`}
          disabled={!resourceId.trim()}
          className={`h-7 shrink-0 rounded-md border border-border px-2.5 text-xs font-semibold text-fg disabled:opacity-60 ${FOCUS_RING}`}
        >
          부여
        </button>
      </form>
    </div>
  );
}

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

              <GroupGrantsSection groupId={g.id} groupName={g.name} />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
