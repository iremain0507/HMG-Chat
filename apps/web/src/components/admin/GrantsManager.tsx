"use client";

// components/admin/GrantsManager.tsx — P20-T6-11: /api/v1/admin/grants(P20-T1-04) 소비.
//   리소스(model/knowledge/tool/prompt) 선택→해당 리소스의 grants 목록(GET)→ user/group 에
//   read/write 부여(POST)·회수(DELETE). GroupsManager.tsx 와 동일한 카드형 레이아웃/토큰 컨벤션.
import React, { useState } from "react";
import {
  useGrants,
  type GrantAccessLevel,
  type GrantResourceType,
  type GrantSubjectType,
} from "../../hooks/useGrants";
import { AdminSubNav } from "./AdminSubNav";

const FOCUS_RING =
  "outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--focus-ring)] focus-visible:outline-offset-2";

const RESOURCE_TYPES: GrantResourceType[] = [
  "model",
  "knowledge",
  "tool",
  "prompt",
];
const SUBJECT_TYPES: GrantSubjectType[] = ["user", "group"];
const ACCESS_LEVELS: GrantAccessLevel[] = ["read", "write"];

export function GrantsManager() {
  const { grants, loading, error, loadGrants, createGrant, revokeGrant } =
    useGrants();

  const [resourceType, setResourceType] =
    useState<GrantResourceType>("knowledge");
  const [resourceId, setResourceId] = useState("");
  const [queried, setQueried] = useState<{
    resourceType: GrantResourceType;
    resourceId: string;
  } | null>(null);

  const [subjectType, setSubjectType] = useState<GrantSubjectType>("user");
  const [subjectId, setSubjectId] = useState("");
  const [access, setAccess] = useState<GrantAccessLevel>("read");

  function handleQuery(e: React.FormEvent) {
    e.preventDefault();
    const id = resourceId.trim();
    if (!id) return;
    setQueried({ resourceType, resourceId: id });
    void loadGrants(resourceType, id);
  }

  function handleGrant(e: React.FormEvent) {
    e.preventDefault();
    if (!queried) return;
    const id = subjectId.trim();
    if (!id) return;
    void createGrant(
      queried.resourceType,
      queried.resourceId,
      subjectType,
      id,
      access,
    );
    setSubjectId("");
  }

  function handleRevoke(
    subjectType: GrantSubjectType,
    subjectId: string,
    access: GrantAccessLevel,
  ) {
    if (!queried) return;
    void revokeGrant(
      queried.resourceType,
      queried.resourceId,
      subjectType,
      subjectId,
      access,
    );
  }

  return (
    <section>
      <div className="flex items-center gap-2.5">
        <h2 className="text-xl font-bold text-fg">접근 권한 관리</h2>
        <span className="font-mono text-[11px] text-fg-subtle">
          /admin/grants
        </span>
      </div>

      <AdminSubNav />

      <form
        onSubmit={handleQuery}
        className="mt-4 flex flex-wrap items-end gap-2"
      >
        <label className="flex flex-col gap-1 text-xs text-fg-muted">
          리소스 종류
          <select
            aria-label="리소스 종류"
            value={resourceType}
            onChange={(e) =>
              setResourceType(e.target.value as GrantResourceType)
            }
            className={`h-8 rounded-md border border-border bg-bg px-2 text-[13px] text-fg ${FOCUS_RING}`}
          >
            {RESOURCE_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-fg-muted">
          리소스 ID
          <input
            aria-label="리소스 ID"
            value={resourceId}
            onChange={(e) => setResourceId(e.target.value)}
            placeholder="resourceId"
            className={`h-8 rounded-md border border-border bg-bg px-2.5 text-[13px] text-fg ${FOCUS_RING}`}
          />
        </label>
        <button
          type="submit"
          disabled={!resourceId.trim()}
          className={`h-8 shrink-0 rounded-md bg-primary px-3.5 text-[12.5px] font-semibold text-primary-fg disabled:opacity-60 ${FOCUS_RING}`}
        >
          조회
        </button>
      </form>

      {error && <p className="mt-3 text-sm text-accent">{error}</p>}

      {queried && (
        <>
          {loading ? (
            <p className="mt-4 text-sm text-fg-muted">불러오는 중…</p>
          ) : grants.length === 0 ? (
            <p className="mt-4 text-sm text-fg-muted">권한이 없습니다.</p>
          ) : (
            <ul className="mt-4 flex flex-col gap-2">
              {grants.map((g) => (
                <li
                  key={`${g.subjectType}-${g.subjectId}-${g.access}`}
                  data-testid={`grant-${g.subjectType}-${g.subjectId}-${g.access}`}
                  className="flex items-center justify-between gap-2 rounded-[10px] border border-border bg-bg px-3.5 py-2.5"
                >
                  <span className="text-[13px] text-fg">
                    <span className="text-fg-muted">{g.subjectType}</span>
                    {" · "}
                    <span>{g.subjectId}</span>
                    {" · "}
                    <span className="text-fg-muted">{g.access}</span>
                  </span>
                  <button
                    type="button"
                    aria-label={`회수 (${g.subjectId}, ${g.access})`}
                    onClick={() =>
                      handleRevoke(g.subjectType, g.subjectId, g.access)
                    }
                    className={`text-xs text-accent ${FOCUS_RING}`}
                  >
                    회수
                  </button>
                </li>
              ))}
            </ul>
          )}

          <form
            onSubmit={handleGrant}
            className="mt-4 flex flex-wrap items-end gap-2"
          >
            <label className="flex flex-col gap-1 text-xs text-fg-muted">
              대상 종류
              <select
                aria-label="대상 종류"
                value={subjectType}
                onChange={(e) =>
                  setSubjectType(e.target.value as GrantSubjectType)
                }
                className={`h-8 rounded-md border border-border bg-bg px-2 text-[13px] text-fg ${FOCUS_RING}`}
              >
                {SUBJECT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-fg-muted">
              대상 ID
              <input
                aria-label="대상 ID"
                value={subjectId}
                onChange={(e) => setSubjectId(e.target.value)}
                placeholder="userId 또는 groupId"
                className={`h-8 rounded-md border border-border bg-bg px-2.5 text-[13px] text-fg ${FOCUS_RING}`}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-fg-muted">
              접근 레벨
              <select
                aria-label="접근 레벨"
                value={access}
                onChange={(e) => setAccess(e.target.value as GrantAccessLevel)}
                className={`h-8 rounded-md border border-border bg-bg px-2 text-[13px] text-fg ${FOCUS_RING}`}
              >
                {ACCESS_LEVELS.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="submit"
              disabled={!subjectId.trim()}
              className={`h-8 shrink-0 rounded-md border border-border px-3.5 text-[12.5px] font-semibold text-fg disabled:opacity-60 ${FOCUS_RING}`}
            >
              부여
            </button>
          </form>
        </>
      )}
    </section>
  );
}
