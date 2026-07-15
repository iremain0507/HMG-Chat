"use client";

// components/settings/MemoryManager.tsx — 18-FRONTEND-WIREFRAMES § 18.5.4 /settings/memories
// 의 최소 구현: 4 카테고리 탭 + 추가 폼 + 목록(핀/편집/삭제). 정렬 드롭다운/커서 페이지네이션은
// acceptance("dev 에서 memory 추가/수정/pin/삭제 동작") 범위 밖.
import React, { useState } from "react";
import { useMemories, type UserMemoryDto } from "../../hooks/useMemories";

const CATEGORIES = ["user", "feedback", "project", "reference"] as const;

const CATEGORY_LABEL: Record<UserMemoryDto["category"], string> = {
  user: "👤 user",
  feedback: "💬 feedback",
  project: "📁 project",
  reference: "🔗 reference",
};

const SOURCE_LABEL: Record<UserMemoryDto["source"], string> = {
  "auto-extract": "자동 추출",
  manual: "수동",
};

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

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    const content = newContent.trim();
    if (!content) return;
    await create({ category: newCategory, content });
    setNewContent("");
  }

  function startEdit(memory: UserMemoryDto) {
    setEditingId(memory.id);
    setEditContent(memory.content);
  }

  async function handleEditSave(id: string) {
    await update(id, { content: editContent });
    setEditingId(null);
  }

  return (
    <section>
      <p className="text-fg-muted">
        ⓘ 저장된 메모리는 모든 대화에 자동 적용됩니다.
      </p>

      <div role="tablist" aria-label="메모리 카테고리">
        <button
          type="button"
          aria-pressed={category === undefined}
          onClick={() => setCategory(undefined)}
        >
          전체
        </button>
        {CATEGORIES.map((c) => (
          <button
            key={c}
            type="button"
            aria-pressed={category === c}
            onClick={() => setCategory(c)}
          >
            {CATEGORY_LABEL[c]}
          </button>
        ))}
      </div>

      <form onSubmit={handleCreate}>
        <select
          aria-label="새 메모리 카테고리"
          value={newCategory}
          onChange={(e) =>
            setNewCategory(e.target.value as UserMemoryDto["category"])
          }
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
        />
        <button type="submit" className="text-primary">
          + 추가
        </button>
      </form>

      {error && <p className="text-accent">{error}</p>}

      {loading ? (
        <p>불러오는 중…</p>
      ) : memories.length === 0 ? (
        <p className="text-fg-muted">저장된 메모리가 없습니다.</p>
      ) : (
        <ul>
          {memories.map((m) => (
            <li key={m.id}>
              <span>
                {m.pinned ? "📌 " : ""}
                {CATEGORY_LABEL[m.category]}
              </span>
              {editingId === m.id ? (
                <>
                  <textarea
                    aria-label={`${m.id} 편집 내용`}
                    value={editContent}
                    onChange={(e) => setEditContent(e.target.value)}
                  />
                  <button type="button" onClick={() => handleEditSave(m.id)}>
                    저장
                  </button>
                  <button type="button" onClick={() => setEditingId(null)}>
                    취소
                  </button>
                </>
              ) : (
                <>
                  <p className="text-fg">{m.content}</p>
                  <span className="text-fg-muted">
                    {SOURCE_LABEL[m.source]} · {m.createdAt.slice(0, 10)}
                  </span>
                  <button
                    type="button"
                    onClick={() => update(m.id, { pinned: !m.pinned })}
                  >
                    {m.pinned ? "핀 해제" : "📌 핀"}
                  </button>
                  <button type="button" onClick={() => startEdit(m)}>
                    편집
                  </button>
                  <button
                    type="button"
                    className="text-accent"
                    onClick={() => remove(m.id)}
                  >
                    삭제
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
