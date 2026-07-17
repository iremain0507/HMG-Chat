"use client";

// components/settings/PromptsManager.tsx — P19-T6-13: 프롬프트 라이브러리 CRUD 매니저.
//   /api/v1/prompts(P19-T1-08) 를 usePrompts 로 소비 — command(`/명령`)·title·content·
//   access(private/org) 를 편집. McpServersManager 와 동일한 카드형 레이아웃/토큰 컨벤션.
import React, { useState } from "react";
import { usePrompts } from "../../hooks/usePrompts";
import type { PromptAccess, PromptDto } from "../../lib/prompts";

const FOCUS_RING =
  "outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--focus-ring)] focus-visible:outline-offset-2";

interface FormState {
  command: string;
  title: string;
  content: string;
  access: PromptAccess;
}

const EMPTY_FORM: FormState = {
  command: "",
  title: "",
  content: "",
  access: "private",
};

export function PromptsManager() {
  const { prompts, loading, error, create, update, remove } = usePrompts();
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  function openCreate() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setShowModal(true);
  }

  function openEdit(prompt: PromptDto) {
    setEditingId(prompt.id);
    setForm({
      command: prompt.command,
      title: prompt.title,
      content: prompt.content,
      access: prompt.access,
    });
    setShowModal(true);
  }

  function closeModal() {
    setShowModal(false);
    setEditingId(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const ok = editingId ? await update(editingId, form) : await create(form);
      if (ok) closeModal();
    } finally {
      setSaving(false);
    }
  }

  return (
    <section>
      <div className="flex flex-wrap items-center gap-2.5">
        <h2 className="text-xl font-bold text-fg">프롬프트</h2>
        <span className="font-mono text-[11px] text-fg-subtle">
          /settings/prompts
        </span>
        <button
          type="button"
          onClick={openCreate}
          className={`ml-auto h-[34px] rounded-md bg-primary px-3.5 text-[13px] font-semibold text-primary-fg ${FOCUS_RING}`}
        >
          ＋ 프롬프트 추가
        </button>
      </div>

      {error && <p className="mt-2 text-sm text-accent">{error}</p>}

      {loading ? (
        <p className="mt-4 text-sm text-fg-muted">불러오는 중…</p>
      ) : prompts.length === 0 ? (
        <p className="mt-4 text-sm text-fg-muted">
          저장된 프롬프트가 없습니다.
        </p>
      ) : (
        <div className="mt-5 grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
          {prompts.map((p) => (
            <div
              key={p.id}
              data-testid={`prompt-card-${p.id}`}
              className="rounded-[10px] border border-border bg-bg p-4"
            >
              <div className="flex items-center gap-2">
                <span className="font-mono text-[12.5px] font-semibold text-primary">
                  {p.command}
                </span>
                <span className="ml-auto rounded-full border border-border bg-surface px-2 py-0.5 text-[11px] text-fg-muted">
                  {p.access === "org" ? "조직 공유" : "개인"}
                </span>
              </div>
              <div className="mt-1.5 text-[14px] font-semibold text-fg">
                {p.title}
              </div>
              <p className="mt-1 line-clamp-2 text-[12.5px] text-fg-muted">
                {p.content}
              </p>
              <div className="mt-3 flex gap-1.5">
                <button
                  type="button"
                  onClick={() => openEdit(p)}
                  className={`h-7 rounded-md border border-border px-2.5 text-xs text-fg ${FOCUS_RING}`}
                >
                  편집
                </button>
                <button
                  type="button"
                  onClick={() => void remove(p.id)}
                  className={`h-7 rounded-md px-2.5 text-xs text-fg-muted ${FOCUS_RING}`}
                >
                  삭제
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showModal && (
        <div
          className="fixed inset-0 z-[var(--z-modal)] grid place-items-center bg-fg/40 px-4"
          onClick={closeModal}
        >
          <div
            role="dialog"
            aria-label={editingId ? "프롬프트 편집" : "프롬프트 추가"}
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm rounded-[14px] border border-border bg-bg p-4 shadow-lg"
          >
            <form onSubmit={(e) => void handleSubmit(e)}>
              <label className="block text-xs text-fg-muted">
                명령(/command)
                <input
                  aria-label="명령"
                  value={form.command}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, command: e.target.value }))
                  }
                  className={`mt-1 h-8 w-full rounded-md border border-border px-2.5 font-mono text-[13px] text-fg ${FOCUS_RING}`}
                />
              </label>
              <label className="mt-2.5 block text-xs text-fg-muted">
                제목
                <input
                  aria-label="제목"
                  value={form.title}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, title: e.target.value }))
                  }
                  className={`mt-1 h-8 w-full rounded-md border border-border px-2.5 text-[13px] text-fg ${FOCUS_RING}`}
                />
              </label>
              <label className="mt-2.5 block text-xs text-fg-muted">
                내용 ({"{{today}}"}·{"{{user}}"}·{"{{clipboard}}"} 변수 지원)
                <textarea
                  aria-label="내용"
                  value={form.content}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, content: e.target.value }))
                  }
                  rows={4}
                  className={`mt-1 w-full rounded-md border border-border px-2.5 py-1.5 text-[13px] text-fg ${FOCUS_RING}`}
                />
              </label>
              <div className="mt-2.5 text-xs text-fg-muted">공개 범위</div>
              <div className="mt-1.5 flex gap-1.5">
                {(["private", "org"] as const).map((a) => (
                  <button
                    type="button"
                    key={a}
                    onClick={() => setForm((f) => ({ ...f, access: a }))}
                    className={`rounded-full px-2.5 py-1 text-xs ${FOCUS_RING} ${
                      form.access === a
                        ? "border border-primary/30 bg-primary-50 font-medium text-primary"
                        : "border border-border text-fg-muted"
                    }`}
                  >
                    {a === "private" ? "개인" : "조직 공유"}
                  </button>
                ))}
              </div>
              <button
                type="submit"
                disabled={saving}
                className={`mt-3.5 h-8 w-full rounded-md bg-primary text-[12.5px] font-semibold text-primary-fg disabled:opacity-60 ${FOCUS_RING}`}
              >
                {editingId ? "저장" : "추가"}
              </button>
              <button
                type="button"
                onClick={closeModal}
                className={`mt-1.5 h-8 w-full rounded-md text-xs text-fg-muted ${FOCUS_RING}`}
              >
                취소
              </button>
            </form>
          </div>
        </div>
      )}
    </section>
  );
}
