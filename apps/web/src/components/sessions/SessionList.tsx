"use client";

// components/sessions/SessionList.tsx — 19-UIUX-UPGRADE.md § P10-T6-02
// 세션 히스토리 사이드바: 검색 + 날짜그룹(오늘/어제/이전 7일/이전) + 새 대화 + 이름변경/삭제.
import React, { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useSessions, type SessionListItemDto } from "../../hooks/useSessions";
import { SessionCard } from "./SessionCard";

const DAY_MS = 24 * 60 * 60 * 1000;

interface DateGroup {
  label: string;
  sessions: SessionListItemDto[];
}

export function groupSessionsByDate(
  sessions: SessionListItemDto[],
  now: Date,
): DateGroup[] {
  const startOfToday = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );

  const buckets: Record<string, SessionListItemDto[]> = {
    오늘: [],
    어제: [],
    "이전 7일": [],
    이전: [],
  };

  for (const session of sessions) {
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

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sessions;
    return sessions.filter((s) => (s.title ?? "").toLowerCase().includes(q));
  }, [sessions, query]);

  const groups = useMemo(
    () => groupSessionsByDate(filtered, now ?? new Date()),
    [filtered, now],
  );

  async function handleNewSession() {
    const created = await createSession();
    if (created) router.push(`/chat/${created.id}`);
  }

  return (
    <div className="flex h-full flex-col">
      <div className="p-2">
        <button
          type="button"
          onClick={() => void handleNewSession()}
          className="w-full rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-fg transition hover:opacity-90"
        >
          ＋ 새 대화
        </button>
      </div>
      <div className="px-2 pb-2">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="세션 검색"
          aria-label="세션 검색"
          className="w-full rounded-md border border-border bg-bg px-2 py-1.5 text-sm text-fg outline-none placeholder:text-fg-muted"
        />
      </div>
      <nav className="flex-1 overflow-y-auto px-2 pb-4">
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
                  onOpen={(id) => router.push(`/chat/${id}`)}
                  onRename={(id, title) => void renameSession(id, title)}
                  onDelete={(id) => void deleteSession(id)}
                />
              ))}
            </div>
          ))
        )}
      </nav>
    </div>
  );
}
