"use client";

// components/sessions/CommandPalette.tsx — P20-T6-02 전역 검색 커맨드 팔레트(⌘K/Ctrl+K).
// AppShell 헤더 검색 버튼/⌘K 단축키가 여는 오버레이. ShortcutSheet 와 동일한
// backdrop/dialog/Escape/배경클릭 패턴을 따른다. lib/sessionSearch.searchSessions 를
// SessionList 사이드바 검색과 동일하게 200ms debounce 로 호출한다.
import React, { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  searchSessions,
  type SessionSearchResultDto,
} from "../../lib/sessionSearch";

// P20-T1-07 — 검색 접두어(tag:/folder:/pinned:/archived:) 힌트칩. 클릭하면 입력창에 접두어를
// 삽입한다(자유텍스트 결합은 db/session-data-access.ts#search 가 서버측에서 파싱).
const SEARCH_PREFIX_HINTS = [
  { key: "tag", value: "tag:" },
  { key: "folder", value: "folder:" },
  { key: "pinned", value: "pinned:true" },
  { key: "archived", value: "archived:true" },
] as const;

export function CommandPalette({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SessionSearchResultDto[] | null>(null);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setResults(null);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    if (!q) {
      setResults(null);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void searchSessions(q, controller.signal).then((res) => {
        if (res) setResults(res);
      });
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, open]);

  if (!open) return null;

  function handleSelect(id: string) {
    router.push(`/chat/${id}`);
    onClose();
  }

  return (
    <div
      data-testid="command-palette-backdrop"
      className="fixed inset-0 z-[var(--z-modal)] grid place-items-start bg-fg/40 px-4 pt-24"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="검색"
        data-testid="command-palette"
        onClick={(e) => e.stopPropagation()}
        className="mx-auto w-full max-w-lg rounded-xl border border-border bg-surface p-4 shadow-lg"
      >
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="세션 검색"
          aria-label="세션 검색"
          data-testid="command-palette-input"
          className="h-9 w-full rounded-md border border-border bg-bg px-2.5 text-sm text-fg outline-none placeholder:text-fg-muted"
        />
        <div
          data-testid="command-palette-hint"
          className="mt-1.5 flex flex-wrap gap-1 px-0.5"
        >
          {SEARCH_PREFIX_HINTS.map((hint) => (
            <button
              key={hint.key}
              type="button"
              data-testid={`command-palette-hint-${hint.key}`}
              onClick={() => {
                setQuery((q) =>
                  q.trim() ? `${q.trim()} ${hint.value}` : hint.value,
                );
                inputRef.current?.focus();
              }}
              className="rounded-full border border-border px-2 py-0.5 text-xs text-fg-muted hover:bg-bg hover:text-fg"
            >
              {hint.value}
            </button>
          ))}
        </div>
        <div className="mt-2 max-h-80 overflow-y-auto">
          {results !== null && results.length === 0 ? (
            <p
              data-testid="command-palette-empty"
              className="px-2 py-2 text-sm text-fg-muted"
            >
              결과 없음
            </p>
          ) : (
            results?.map((r) => (
              <button
                key={r.id}
                type="button"
                data-testid={`command-palette-result-${r.id}`}
                onClick={() => handleSelect(r.id)}
                className="flex w-full flex-col items-start gap-0.5 rounded-md px-2 py-1.5 text-left hover:bg-bg"
              >
                <span className="w-full truncate text-sm text-fg">
                  {r.title ?? "제목 없음"}
                </span>
                {r.snippet && (
                  <span className="w-full truncate text-xs text-fg-muted">
                    {r.snippet}
                  </span>
                )}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
