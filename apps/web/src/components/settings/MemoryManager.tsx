"use client";

// components/settings/MemoryManager.tsx — design-reference F13(메모리 설정) 핸드오프
// 정렬(P13-T6-12): 카테고리 pill 탭 + 카드 그리드(출처·날짜 메타 + 편집/삭제) + 추가 폼.
// 기존 동작(카테고리 필터·생성·편집·핀·삭제)은 useMemories 그대로, 외형만 프레임에 맞춘다.
import React, { useState } from "react";
import { Info, Pin } from "lucide-react";
import { useMemories, type UserMemoryDto } from "../../hooks/useMemories";

const CATEGORIES = ["user", "feedback", "project", "reference"] as const;

const CATEGORY_LABEL: Record<UserMemoryDto["category"], string> = {
  user: "사용자",
  feedback: "피드백",
  project: "프로젝트",
  reference: "참조",
};

const SOURCE_LABEL: Record<UserMemoryDto["source"], string> = {
  "auto-extract": "자동 추출",
  manual: "수동 입력",
};

const FOCUS_RING =
  "outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--focus-ring)] focus-visible:outline-offset-2";

export function MemoryManager() {
  const [category, setCategory] = useState<
    UserMemoryDto["category"] | undefined
  >(undefined);
  const { memories, loading, error, create, update, remove } =
    useMemories(category);
  const [newCategory, setNewCategory] =
    useState<UserMemoryDto["category"]>("user");
  const [newContent, setNewContent] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const [creating, setCreating] = useState(false);
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());

  function markPending(id: string) {
    setPendingIds((prev) => new Set(prev).add(id));
  }

  function clearPending(id: string) {
    setPendingIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (creating) return;
    const content = newContent.trim();
    if (!content) return;
    setCreating(true);
    try {
      await create({ category: newCategory, content });
      setNewContent("");
    } finally {
      setCreating(false);
    }
  }

  function startEdit(memory: UserMemoryDto) {
    setEditingId(memory.id);
    setEditContent(memory.content);
  }

  async function handleEditSave(id: string) {
    if (pendingIds.has(id)) return;
    markPending(id);
    try {
      await update(id, { content: editContent });
      setEditingId(null);
    } finally {
      clearPending(id);
    }
  }

  async function handlePinToggle(memory: UserMemoryDto) {
    if (pendingIds.has(memory.id)) return;
    markPending(memory.id);
    try {
      await update(memory.id, { pinned: !memory.pinned });
    } finally {
      clearPending(memory.id);
    }
  }

  async function handleDelete(id: string) {
    if (pendingIds.has(id)) return;
    markPending(id);
    try {
      await remove(id);
    } finally {
      clearPending(id);
    }
  }

  return (
    <section>
      <div className="flex items-center gap-2.5">
        <h2 className="text-xl font-bold text-fg">메모리</h2>
        <span className="font-mono text-[11px] text-fg-subtle">
          /settings/memories
        </span>
      </div>

      <div className="mt-3.5 flex items-center gap-2 rounded-[10px] border border-primary-200 bg-primary-50 px-3.5 py-2.5 text-[13px] text-primary">
        <Info aria-hidden="true" className="h-3.5 w-3.5 flex-none" />
        저장된 메모리는 모든 대화에 자동 적용됩니다 — 채팅 헤더의 메모리
        아이콘에서 적용 현황을 확인할 수 있습니다
      </div>

      <div
        role="tablist"
        aria-label="메모리 카테고리"
        className="mt-4 flex flex-wrap gap-1.5"
      >
        <button
          type="button"
          aria-pressed={category === undefined}
          onClick={() => setCategory(undefined)}
          className={`rounded-full px-3 py-1 text-xs font-medium ${FOCUS_RING} ${
            category === undefined
              ? "bg-primary text-primary-fg"
              : "border border-border text-fg-muted"
          }`}
        >
          전체
        </button>
        {CATEGORIES.map((c) => (
          <button
            key={c}
            type="button"
            aria-pressed={category === c}
            onClick={() => setCategory(c)}
            className={`rounded-full px-3 py-1 text-xs font-medium ${FOCUS_RING} ${
              category === c
                ? "bg-primary text-primary-fg"
                : "border border-border text-fg-muted"
            }`}
          >
            {CATEGORY_LABEL[c]}
          </button>
        ))}
      </div>

      <form
        onSubmit={handleCreate}
        className="mt-4 flex flex-wrap items-start gap-2"
      >
        <select
          aria-label="새 메모리 카테고리"
          value={newCategory}
          onChange={(e) =>
            setNewCategory(e.target.value as UserMemoryDto["category"])
          }
          className={`h-8 rounded-md border border-border px-2.5 text-[13px] text-fg ${FOCUS_RING}`}
        >
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {CATEGORY_LABEL[c]}
            </option>
          ))}
        </select>
        <textarea
          aria-label="새 메모리 내용"
          value={newContent}
          onChange={(e) => setNewContent(e.target.value)}
          className={`h-8 min-w-[240px] flex-1 rounded-md border border-border px-2.5 py-1.5 text-[13px] text-fg ${FOCUS_RING}`}
        />
        <button
          type="submit"
          disabled={creating}
          className={`h-8 rounded-md bg-primary px-3 text-[12.5px] font-semibold text-primary-fg disabled:opacity-60 ${FOCUS_RING}`}
        >
          + 추가
        </button>
      </form>

      {error && <p className="mt-2 text-sm text-accent">{error}</p>}

      {loading ? (
        <p className="mt-4 text-sm text-fg-muted">불러오는 중…</p>
      ) : memories.length === 0 ? (
        <p className="mt-4 text-sm text-fg-muted">저장된 메모리가 없습니다.</p>
      ) : (
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {memories.map((m) => {
            const isPending = pendingIds.has(m.id);
            return (
              <div
                key={m.id}
                className="rounded-[10px] border border-border bg-bg p-3.5"
              >
                <div className="flex items-center gap-1.5">
                  {m.pinned ? (
                    <>
                      <Pin
                        aria-hidden="true"
                        className="h-3 w-3 flex-none text-primary"
                      />
                      <span className="text-[11px] font-semibold text-primary">
                        고정됨
                      </span>
                    </>
                  ) : (
                    <span className="text-[11px] text-placeholder">일반</span>
                  )}
                  <span className="ml-auto rounded-full border border-border bg-surface px-2 py-0.5 text-[11px] text-fg-muted">
                    {CATEGORY_LABEL[m.category]}
                  </span>
                </div>

                {editingId === m.id ? (
                  <>
                    <textarea
                      aria-label={`${m.id} 편집 내용`}
                      value={editContent}
                      onChange={(e) => setEditContent(e.target.value)}
                      className={`mt-2 w-full rounded-md border border-border p-2 text-[13.5px] leading-relaxed text-fg ${FOCUS_RING}`}
                    />
                    <div className="mt-2 flex gap-1.5">
                      <button
                        type="button"
                        disabled={isPending}
                        onClick={() => handleEditSave(m.id)}
                        className={`h-[26px] rounded-md bg-primary px-2.5 text-xs font-semibold text-primary-fg disabled:opacity-60 ${FOCUS_RING}`}
                      >
                        저장
                      </button>
                      <button
                        type="button"
                        disabled={isPending}
                        onClick={() => setEditingId(null)}
                        className={`h-[26px] rounded-md border border-border px-2.5 text-xs text-fg disabled:opacity-60 ${FOCUS_RING}`}
                      >
                        취소
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <p className="mt-2 text-[13.5px] leading-relaxed text-fg">
                      {m.content}
                    </p>
                    <div className="mt-2 text-[11.5px] text-placeholder">
                      {SOURCE_LABEL[m.source]} ·{" "}
                      <span className="font-mono">
                        {m.createdAt.slice(0, 10)}
                      </span>
                    </div>
                    <div className="mt-2.5 flex gap-1.5">
                      <button
                        type="button"
                        disabled={isPending}
                        onClick={() => handlePinToggle(m)}
                        className={`h-[26px] rounded-md border border-border px-2.5 text-xs text-fg disabled:opacity-60 ${FOCUS_RING}`}
                      >
                        {m.pinned ? "핀 해제" : "고정"}
                      </button>
                      <button
                        type="button"
                        disabled={isPending}
                        onClick={() => startEdit(m)}
                        className={`h-[26px] rounded-md border border-border px-2.5 text-xs text-fg disabled:opacity-60 ${FOCUS_RING}`}
                      >
                        편집
                      </button>
                      <button
                        type="button"
                        disabled={isPending}
                        onClick={() => handleDelete(m.id)}
                        className={`h-[26px] rounded-md px-2.5 text-xs text-accent disabled:opacity-60 ${FOCUS_RING}`}
                      >
                        삭제
                      </button>
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
