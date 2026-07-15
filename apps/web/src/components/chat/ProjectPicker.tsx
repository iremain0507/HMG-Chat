"use client";

// components/chat/ProjectPicker.tsx — P10-T6-14 채팅 헤더 [Project ▾] 스코프 전환 드롭다운.
//   projects(useProjects) + 현재 세션 projectId(useSessionProject) 를 받아 렌더,
//   선택 시 onSelect(id|null) 호출 — 실제 PATCH /sessions/:id 는 호출부(ChatView)가 담당.
import React, { useState } from "react";
import type { ProjectDto } from "../../hooks/useProject";

const NONE_LABEL = "프로젝트 없음";

export function ProjectPicker({
  projects,
  projectId,
  onSelect,
}: {
  projects: ProjectDto[];
  projectId: string | null;
  onSelect: (projectId: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const current = projects.find((p) => p.id === projectId) ?? null;
  const label = current ? current.name : NONE_LABEL;

  function select(next: string | null) {
    onSelect(next);
    setOpen(false);
  }

  return (
    <div className="relative">
      <button
        type="button"
        data-testid="project-picker-trigger"
        onClick={() => setOpen((prev) => !prev)}
        className="flex items-center gap-1 rounded-lg px-2 py-1 text-sm text-fg-muted hover:text-fg"
      >
        <span className="max-w-[10rem] truncate">{label}</span>
        <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <ul
          role="listbox"
          aria-label="프로젝트 선택"
          data-testid="project-picker-menu"
          className="absolute left-0 top-full z-10 mt-1 max-h-64 w-56 overflow-auto rounded-xl border border-border bg-surface p-1 shadow-lg"
        >
          <li
            role="option"
            aria-selected={projectId === null}
            data-testid="project-picker-item-none"
          >
            <button
              type="button"
              onClick={() => select(null)}
              className={`w-full rounded-lg px-2.5 py-1.5 text-left text-sm ${
                projectId === null
                  ? "bg-primary/10 text-fg"
                  : "text-fg-muted hover:bg-bg"
              }`}
            >
              {NONE_LABEL}
            </button>
          </li>
          {projects.map((p) => (
            <li
              key={p.id}
              role="option"
              aria-selected={projectId === p.id}
              data-testid={`project-picker-item-${p.id}`}
            >
              <button
                type="button"
                onClick={() => select(p.id)}
                className={`w-full truncate rounded-lg px-2.5 py-1.5 text-left text-sm ${
                  projectId === p.id
                    ? "bg-primary/10 text-fg"
                    : "text-fg-muted hover:bg-bg"
                }`}
              >
                {p.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
