"use client";

// components/chat/ProjectPicker.tsx — P10-T6-14 채팅 헤더 [Project ▾] 스코프 전환 드롭다운.
//   projects(useProjects) + 현재 세션 projectId(useSessionProject) 를 받아 렌더,
//   선택 시 onSelect(id|null) 호출 — 실제 PATCH /sessions/:id 는 호출부(ChatView)가 담당.
import React, { useEffect, useId, useRef, useState } from "react";
import type { ProjectDto } from "../../hooks/useProject";
import { useDismiss } from "../../hooks/useDismiss";
import { useExclusiveOverlay } from "../../hooks/useExclusiveOverlay";

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
  const menu = useExclusiveOverlay();
  const [activeIndex, setActiveIndex] = useState(0);
  const instanceId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listboxRef = useRef<HTMLUListElement>(null);

  const current = projects.find((p) => p.id === projectId) ?? null;
  const label = current ? current.name : NONE_LABEL;
  const options: { id: string | null; label: string }[] = [
    { id: null, label: NONE_LABEL },
    ...projects.map((p) => ({ id: p.id, label: p.name })),
  ];

  function optionDomId(index: number): string {
    return `${instanceId}-option-${index}`;
  }

  useDismiss(
    listboxRef,
    () => {
      menu.close();
      triggerRef.current?.focus();
    },
    { enabled: menu.isOpen, triggerRef },
  );

  useEffect(() => {
    if (menu.isOpen) listboxRef.current?.focus();
  }, [menu.isOpen]);

  function openMenu() {
    const idx = Math.max(
      0,
      options.findIndex((o) => o.id === projectId),
    );
    setActiveIndex(idx);
    menu.open();
  }

  function select(next: string | null) {
    onSelect(next);
    menu.close();
    triggerRef.current?.focus();
  }

  function handleTriggerKeyDown(e: React.KeyboardEvent) {
    if (menu.isOpen) return;
    if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openMenu();
    }
  }

  function handleListboxKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % options.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => (i - 1 + options.length) % options.length);
    } else if (e.key === "Home") {
      e.preventDefault();
      setActiveIndex(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setActiveIndex(options.length - 1);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      select(options[activeIndex]?.id ?? null);
    } else if (e.key === "Tab") {
      menu.close();
    }
  }

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        data-testid="project-picker-trigger"
        aria-haspopup="listbox"
        aria-expanded={menu.isOpen}
        onClick={() => (menu.isOpen ? menu.close() : openMenu())}
        onKeyDown={handleTriggerKeyDown}
        className="flex items-center gap-1 rounded-lg px-2 py-1 text-sm text-fg-muted hover:text-fg"
      >
        <span className="max-w-[10rem] truncate">{label}</span>
        <span aria-hidden="true">▾</span>
      </button>
      {menu.isOpen && (
        <ul
          ref={listboxRef}
          role="listbox"
          tabIndex={0}
          aria-label="프로젝트 선택"
          aria-activedescendant={optionDomId(activeIndex)}
          data-testid="project-picker-menu"
          onKeyDown={handleListboxKeyDown}
          className="absolute left-0 top-full z-10 mt-1 max-h-64 w-56 overflow-auto rounded-xl border border-border bg-surface p-1 shadow-lg outline-none"
        >
          {options.map((opt, index) => (
            <li
              key={opt.id ?? "none"}
              id={optionDomId(index)}
              role="option"
              aria-selected={projectId === opt.id}
              data-testid={
                opt.id === null
                  ? "project-picker-item-none"
                  : `project-picker-item-${opt.id}`
              }
            >
              <button
                type="button"
                tabIndex={-1}
                onClick={() => select(opt.id)}
                className={`w-full truncate rounded-lg px-2.5 py-1.5 text-left text-sm ${
                  index === activeIndex || projectId === opt.id
                    ? "bg-primary/10 text-fg"
                    : "text-fg-muted hover:bg-bg"
                }`}
              >
                {opt.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
