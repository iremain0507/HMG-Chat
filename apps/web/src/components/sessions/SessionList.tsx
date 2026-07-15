"use client";

// components/sessions/SessionList.tsx — design-reference README §Screens/AppShell.
// 세션 히스토리 사이드바: 새 세션(⌘N)+검색(⌘K)+고정→오늘→어제→이전 7일 날짜그룹+
// hover 이름변경/고정/삭제.
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useSessions, type SessionListItemDto } from "../../hooks/useSessions";
import {
  getPinnedSessionIds,
  toggleSessionPinned,
} from "../../lib/pinnedSessions";
import { SessionCard } from "./SessionCard";

const DAY_MS = 24 * 60 * 60 * 1000;
const CMDK_EVENT = "wchat:cmdk";

interface DateGroup {
  label: string;
  sessions: SessionListItemDto[];
}

export function groupSessionsByDate(
  sessions: SessionListItemDto[],
  now: Date,
  pinnedIds: Set<string> = new Set(),
): DateGroup[] {
  const startOfToday = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );

  const buckets: Record<string, SessionListItemDto[]> = {
    고정: [],
    오늘: [],
    어제: [],
    "이전 7일": [],
    이전: [],
  };

  for (const session of sessions) {
    if (pinnedIds.has(session.id)) {
      buckets["고정"]?.push(session);
      continue;
    }
    const at = session.lastMessageAt ? new Date(session.lastMessageAt) : now;
    const startOfAt = Date.UTC(
      at.getUTCFullYear(),
      at.getUTCMonth(),
      at.getUTCDate(),
    );
    const diffDays = Math.floor((startOfToday - startOfAt) / DAY_MS);
    if (diffDays <= 0) buckets["오늘"]?.push(session);
    else if (diffDays === 1) buckets["어제"]?.push(session);
    else if (diffDays <= 7) buckets["이전 7일"]?.push(session);
    else buckets["이전"]?.push(session);
  }

  return Object.entries(buckets)
    .filter(([, items]) => items.length > 0)
    .map(([label, items]) => ({ label, sessions: items }));
}

export function SessionList({ now }: { now?: Date } = {}) {
  const router = useRouter();
  const { sessions, loading, createSession, renameSession, deleteSession } =
    useSessions();
  const [query, setQuery] = useState("");
  const [pinnedIds, setPinnedIds] = useState<Set<string>>(new Set());
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setPinnedIds(getPinnedSessionIds());
  }, []);

  async function handleNewSession() {
    const created = await createSession();
    if (created) router.push(`/chat/${created.id}`);
  }

  useEffect(() => {
    function onCmdk() {
      searchRef.current?.focus();
    }
    function onKeyDown(e: KeyboardEvent) {
      const meta = e.metaKey || e.ctrlKey;
      if (!meta) return;
      if (e.key === "n" || e.key === "N") {
        e.preventDefault();
        void handleNewSession();
      }
    }
    window.addEventListener(CMDK_EVENT, onCmdk);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener(CMDK_EVENT, onCmdk);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [createSession, router]);

  function handleTogglePin(id: string) {
    setPinnedIds(new Set(toggleSessionPinned(id)));
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sessions;
    return sessions.filter((s) => (s.title ?? "").toLowerCase().includes(q));
  }, [sessions, query]);

  const groups = useMemo(
    () => groupSessionsByDate(filtered, now ?? new Date(), pinnedIds),
    [filtered, now, pinnedIds],
  );

  return (
    <div className="flex h-full flex-col p-2">
      <button
        type="button"
        onClick={() => void handleNewSession()}
        className="flex h-[34px] shrink-0 items-center justify-center gap-1.5 rounded-md bg-primary px-3 text-sm font-semibold text-primary-fg transition hover:opacity-90"
      >
        ＋ 새 대화
        <span
          aria-hidden="true"
          className="font-mono text-[10px] font-normal opacity-70"
        >
          ⌘N
        </span>
      </button>
      <input
        ref={searchRef}
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="세션 검색"
        aria-label="세션 검색"
        data-testid="session-search-input"
        className="mt-1 h-[30px] w-full shrink-0 rounded-md border border-border bg-bg px-2 text-sm text-fg outline-none placeholder:text-fg-muted"
      />
      <nav className="mt-1.5 flex-1 overflow-y-auto">
        {loading ? (
          <p className="px-2 py-1 text-sm text-fg-muted">불러오는 중…</p>
        ) : filtered.length === 0 ? (
          <p className="px-2 py-1 text-sm text-fg-muted">세션이 없습니다.</p>
        ) : (
          groups.map((group) => (
            <div key={group.label} className="mb-3">
              <h3 className="px-2 py-1 text-xs font-semibold text-fg-muted">
                {group.label}
              </h3>
              {group.sessions.map((session) => (
                <SessionCard
                  key={session.id}
                  session={session}
                  pinned={pinnedIds.has(session.id)}
                  onOpen={(id) => router.push(`/chat/${id}`)}
                  onRename={(id, title) => void renameSession(id, title)}
                  onDelete={(id) => void deleteSession(id)}
                  onTogglePin={handleTogglePin}
                />
              ))}
            </div>
          ))
        )}
      </nav>
    </div>
  );
}
