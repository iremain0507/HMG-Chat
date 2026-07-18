"use client";

// components/notes/NotesWorkspace.tsx — P22-T6-17 노트 워크스페이스(계약 승인 C7).
//   Open WebUI 의 Notes 파리티: 좌측 노트 목록 + 우측 마크다운 에디터, AI 개선(enhance),
//   그리고 노트를 채팅 컨텍스트로 주입하는 액션. 시각 디자인은 DESIGN.md 시맨틱 토큰.
//
//   저장 모델: 명시적 저장(디바운스 자동저장 아님). 자동저장은 enhance 와 경합해
//   "AI 가 고친 본문을 낡은 draft 가 덮어쓰는" 사고를 만든다 — 사용자가 누른 시점에만 PATCH.
//   저장 안 된 변경은 dirty 배지로 드러내고, 다른 노트로 옮길 때 확인을 받는다.
//
//   컨텍스트 주입: 홈(app/(app)/page.tsx)의 startWithPrompt 와 같은 방식 —
//   새 세션 id 를 만들고 그 세션의 draft(sessionStorage)에 노트 본문을 심은 뒤 /chat 으로
//   이동한다. 사용자가 전송하면 그 본문이 실제 턴으로 들어가 에이전트 도구가 읽는다.
//   (별도 서버측 주입 채널을 새로 만들지 않는다 — 기존 draft 계약 재사용.)
import React, { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useNotes, type NoteDto } from "../../hooks/useNotes";
import { randomUUID } from "../../lib/uuid";
import { draftKey } from "../chat/ChatInput";
import { showToast } from "../../lib/toast";

const FOCUS_RING =
  "outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--focus-ring)] focus-visible:outline-offset-2";

function previewOf(content: string): string {
  const line = content
    .split("\n")
    .map((l) => l.replace(/^#+\s*/, "").trim())
    .find((l) => l !== "");
  return line ? line.slice(0, 80) : "빈 노트";
}

export function NotesWorkspace() {
  const router = useRouter();
  const { notes, loading, error, create, update, remove, enhance } = useNotes();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [enhancing, setEnhancing] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const contentRef = useRef<HTMLTextAreaElement>(null);

  const selected = notes.find((n) => n.id === selectedId) ?? null;

  // 목록이 처음 로드되면 첫 노트를 자동 선택한다(빈 화면보다 바로 읽을거리를 준다).
  useEffect(() => {
    if (selectedId === null && notes.length > 0) {
      const first = notes[0] as NoteDto;
      setSelectedId(first.id);
      setTitle(first.title);
      setContent(first.content);
      setDirty(false);
    }
  }, [notes, selectedId]);

  const openNote = useCallback(
    (note: NoteDto) => {
      if (note.id === selectedId) return;
      if (
        dirty &&
        !window.confirm("저장하지 않은 변경이 있습니다. 버리고 이동할까요?")
      ) {
        return;
      }
      setSelectedId(note.id);
      setTitle(note.title);
      setContent(note.content);
      setDirty(false);
    },
    [dirty, selectedId],
  );

  async function handleCreate() {
    await create({ title: "" }); // 서버가 "제목 없는 노트" 기본값을 넣는다.
    setSelectedId(null); // 재조회 후 첫 항목(최신)이 자동 선택된다.
    setDirty(false);
  }

  async function handleSave() {
    if (!selected) return;
    setSaving(true);
    try {
      await update(selected.id, { title, content });
      setDirty(false);
      showToast("success", "노트를 저장했습니다.");
    } finally {
      setSaving(false);
    }
  }

  async function handleEnhance() {
    if (!selected) return;
    setEnhancing(true);
    try {
      // 서버는 *저장된* 본문을 다듬는다 — 저장 안 된 편집이 있으면 먼저 저장해야
      // 사용자가 화면에서 보는 내용이 개선 대상이 된다.
      if (dirty) await update(selected.id, { title, content });
      const improved = await enhance(selected.id);
      if (improved === null) return; // error 는 훅이 노출한다.
      setContent(improved);
      setDirty(false);
      showToast("success", "AI 가 노트를 다듬었습니다.");
    } finally {
      setEnhancing(false);
    }
  }

  async function handleDelete(id: string) {
    await remove(id);
    setConfirmDeleteId(null);
    if (id === selectedId) {
      setSelectedId(null);
      setTitle("");
      setContent("");
      setDirty(false);
    }
  }

  // 채팅 컨텍스트 주입 — 새 세션 draft 에 본문을 심고 이동.
  function handleSendToChat() {
    if (!selected) return;
    const id = randomUUID();
    const injected = `다음 노트를 참고해 줘.\n\n## ${title}\n\n${content}`;
    try {
      window.sessionStorage.setItem(draftKey(id), injected);
    } catch {
      // sessionStorage 접근 불가(프라이빗 모드 등) — 주입은 best-effort.
    }
    router.push(`/chat/${id}`);
  }

  return (
    <div className="flex h-full min-h-0 gap-4" data-testid="notes-workspace">
      {/* 좌측 — 노트 목록 */}
      <aside className="flex w-64 shrink-0 flex-col gap-2 border-r border-border pr-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-fg">노트</h2>
          <button
            type="button"
            onClick={handleCreate}
            data-testid="note-create"
            className={`rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-fg hover:opacity-90 ${FOCUS_RING}`}
          >
            새 노트
          </button>
        </div>

        {loading ? (
          <p className="text-sm text-fg-muted">불러오는 중…</p>
        ) : notes.length === 0 ? (
          <p className="text-sm text-fg-muted">
            아직 노트가 없습니다. “새 노트”로 시작하세요.
          </p>
        ) : (
          <ul className="flex flex-col gap-1 overflow-y-auto">
            {notes.map((note) => (
              <li key={note.id}>
                <button
                  type="button"
                  onClick={() => openNote(note)}
                  aria-current={note.id === selectedId ? "true" : undefined}
                  className={`w-full rounded-md px-2 py-1.5 text-left ${FOCUS_RING} ${
                    note.id === selectedId
                      ? "bg-primary/10 text-fg"
                      : "text-fg-muted hover:bg-surface hover:text-fg"
                  }`}
                >
                  <span className="block truncate text-sm font-medium">
                    {note.title}
                  </span>
                  <span className="block truncate text-xs text-fg-muted">
                    {previewOf(note.content)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </aside>

      {/* 우측 — 에디터 */}
      <section className="flex min-w-0 flex-1 flex-col gap-3">
        {error ? (
          <p role="alert" className="text-sm text-accent">
            {error}
          </p>
        ) : null}

        {!selected ? (
          <p className="text-sm text-fg-muted">
            편집할 노트를 선택하거나 새로 만드세요.
          </p>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <label htmlFor="note-title" className="sr-only">
                노트 제목
              </label>
              <input
                id="note-title"
                value={title}
                onChange={(e) => {
                  setTitle(e.target.value);
                  setDirty(true);
                }}
                className={`min-w-0 flex-1 rounded-md border border-border bg-surface px-3 py-2 text-base font-semibold text-fg ${FOCUS_RING}`}
              />
              {dirty ? (
                <span
                  data-testid="note-dirty"
                  className="rounded-full bg-surface px-2 py-0.5 text-xs text-fg-muted"
                >
                  저장 안 됨
                </span>
              ) : null}
            </div>

            <label htmlFor="note-content" className="sr-only">
              노트 본문(마크다운)
            </label>
            <textarea
              id="note-content"
              ref={contentRef}
              value={content}
              onChange={(e) => {
                setContent(e.target.value);
                setDirty(true);
              }}
              spellCheck={false}
              placeholder="마크다운으로 작성하세요…"
              className={`min-h-64 flex-1 resize-none rounded-md border border-border bg-surface px-3 py-2 font-mono text-sm leading-relaxed text-fg ${FOCUS_RING}`}
            />

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleSave}
                disabled={saving || !dirty}
                data-testid="note-save"
                className={`rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-fg hover:opacity-90 disabled:opacity-50 ${FOCUS_RING}`}
              >
                {saving ? "저장 중…" : "저장"}
              </button>
              <button
                type="button"
                onClick={handleEnhance}
                disabled={enhancing}
                data-testid="note-enhance"
                className={`rounded-md border border-border px-3 py-1.5 text-sm text-fg hover:border-primary disabled:opacity-50 ${FOCUS_RING}`}
              >
                {enhancing ? "다듬는 중…" : "AI 개선"}
              </button>
              <button
                type="button"
                onClick={handleSendToChat}
                data-testid="note-send-to-chat"
                className={`rounded-md border border-border px-3 py-1.5 text-sm text-fg hover:border-primary ${FOCUS_RING}`}
              >
                채팅에 주입
              </button>
              <button
                type="button"
                onClick={() => setConfirmDeleteId(selected.id)}
                data-testid="note-delete"
                className={`ml-auto rounded-md border border-border px-3 py-1.5 text-sm text-accent hover:border-accent ${FOCUS_RING}`}
              >
                삭제
              </button>
            </div>

            {confirmDeleteId === selected.id ? (
              <div
                role="alertdialog"
                aria-label="노트 삭제 확인"
                className="flex items-center gap-3 rounded-md border border-accent/40 bg-accent/5 px-3 py-2"
              >
                <p className="text-sm text-fg">
                  “{selected.title}” 노트를 삭제할까요? 되돌릴 수 없습니다.
                </p>
                <button
                  type="button"
                  onClick={() => void handleDelete(selected.id)}
                  data-testid="note-delete-confirm"
                  className={`ml-auto rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 ${FOCUS_RING}`}
                >
                  삭제
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmDeleteId(null)}
                  className={`rounded-md border border-border px-3 py-1.5 text-sm text-fg-muted ${FOCUS_RING}`}
                >
                  취소
                </button>
              </div>
            ) : null}
          </>
        )}
      </section>
    </div>
  );
}
