"use client";

// components/agents/AgentGallery.tsx — P22-T6-10 워크스페이스 에이전트 갤러리.
//   Open WebUI 의 Workspace › Models 흐름(카드 그리드 + 만들기/편집/삭제)을 WIA CI 로 옮긴
//   화면. 실제 CRUD 는 useAgents(/api/v1/agents)로 위임하고, 편집은 AgentEditor
//   슬라이드오버가 담당한다. 트리거 ref 를 편집기에 넘겨 닫힐 때 포커스가 정확히
//   "＋ 에이전트 만들기"/해당 카드의 편집 버튼으로 복귀하도록 한다.
import React, { useRef, useState } from "react";
import {
  useAgents,
  type AgentDto,
  type AgentInput,
} from "../../hooks/useAgents";
import { AgentEditor } from "./AgentEditor";

const FOCUS_RING =
  "outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--focus-ring)] focus-visible:outline-offset-2";

type EditorState = { mode: "create" } | { mode: "edit"; agent: AgentDto };

export function AgentGallery() {
  const { agents, loading, error, create, update, remove } = useAgents();
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [removingIds, setRemovingIds] = useState<Set<string>>(new Set());
  const triggerRef = useRef<HTMLElement | null>(null);

  function openCreate(e: React.MouseEvent<HTMLButtonElement>) {
    triggerRef.current = e.currentTarget;
    setEditor({ mode: "create" });
  }

  function openEdit(e: React.MouseEvent<HTMLButtonElement>, agent: AgentDto) {
    triggerRef.current = e.currentTarget;
    setEditor({ mode: "edit", agent });
  }

  async function handleSave(input: AgentInput) {
    if (editor?.mode === "edit") {
      await update(editor.agent.id, input);
      return;
    }
    await create(input);
  }

  async function handleRemove(id: string) {
    if (removingIds.has(id)) return;
    setRemovingIds((prev) => new Set(prev).add(id));
    try {
      await remove(id);
    } finally {
      setRemovingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }

  return (
    <section>
      <div className="flex flex-wrap items-center gap-2.5">
        <h2 className="text-xl font-bold text-fg">에이전트</h2>
        <span className="font-mono text-[11px] text-fg-subtle">
          /settings/agents
        </span>
        <button
          type="button"
          onClick={openCreate}
          className={`ml-auto h-[34px] rounded-md bg-primary px-3.5 text-[13px] font-semibold text-primary-fg ${FOCUS_RING}`}
        >
          ＋ 에이전트 만들기
        </button>
      </div>
      <p className="mt-1.5 text-[12.5px] text-fg-muted">
        기본 모델에 시스템 프롬프트·도구·스킬·프로젝트를 묶어 조직 전용
        에이전트를 만듭니다.
      </p>

      {error && <p className="mt-2 text-sm text-accent">{error}</p>}

      {loading ? (
        <p className="mt-4 text-sm text-fg-muted">불러오는 중…</p>
      ) : agents.length === 0 ? (
        <p className="mt-4 text-sm text-fg-muted">
          등록된 에이전트가 없습니다.
        </p>
      ) : (
        <div className="mt-5 grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
          {agents.map((a) => (
            <div
              key={a.id}
              data-testid={`agent-card-${a.id}`}
              className="flex flex-col rounded-[10px] border border-border bg-bg p-4"
            >
              <div className="flex items-start gap-2">
                <span className="text-[14.5px] font-semibold text-fg">
                  {a.name}
                </span>
                <span className="ml-auto flex-none rounded-full border border-border bg-surface px-2 py-0.5 text-[11px] text-fg-muted">
                  {a.visibility === "org" ? "조직" : "비공개"}
                </span>
              </div>

              <p className="mt-1.5 line-clamp-2 min-h-[32px] text-[12.5px] leading-relaxed text-fg-muted">
                {a.description ?? "설명 없음"}
              </p>

              <div className="mt-2 flex flex-wrap gap-1.5">
                <span className="rounded-full bg-primary-50 px-2 py-0.5 font-mono text-[11px] text-primary">
                  {a.baseModel}
                </span>
                {a.toolIds.length > 0 && (
                  <span className="rounded-full border border-border px-2 py-0.5 text-[11px] text-fg-muted">
                    도구 {a.toolIds.length}
                  </span>
                )}
                {a.skillIds.length > 0 && (
                  <span className="rounded-full border border-border px-2 py-0.5 text-[11px] text-fg-muted">
                    스킬 {a.skillIds.length}
                  </span>
                )}
              </div>

              <div className="mt-3 flex gap-1.5">
                <button
                  type="button"
                  aria-label={`${a.name} 편집`}
                  onClick={(e) => openEdit(e, a)}
                  className={`h-7 rounded-md border border-border px-2.5 text-xs text-fg ${FOCUS_RING}`}
                >
                  편집
                </button>
                <button
                  type="button"
                  aria-label={`${a.name} 삭제`}
                  onClick={() => void handleRemove(a.id)}
                  disabled={removingIds.has(a.id)}
                  className={`h-7 rounded-md px-2.5 text-xs text-fg-muted disabled:opacity-50 ${FOCUS_RING}`}
                >
                  삭제
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {editor && (
        <AgentEditor
          key={editor.mode === "edit" ? editor.agent.id : "new"}
          agent={editor.mode === "edit" ? editor.agent : null}
          onClose={() => setEditor(null)}
          onSave={handleSave}
          restoreFocusRef={triggerRef}
        />
      )}
    </section>
  );
}
