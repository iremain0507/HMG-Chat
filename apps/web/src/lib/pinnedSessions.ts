// lib/pinnedSessions.ts — 세션 사이드바 "고정" 그룹(design-reference README §Screens/AppShell).
//   Session 인터페이스(14-INTERFACES.md)에 pinned 필드가 없어(백엔드 미정의) 브라우저 로컬
//   상태로만 관리한다 — 기기 간 동기화는 없음, 서버 계약 변경 없이 프레임 상호작용만 재현.
const STORAGE_KEY = "wchat-pinned-sessions";

function readAll(): Set<string> {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? new Set(parsed.filter((x) => typeof x === "string"))
      : new Set();
  } catch {
    return new Set();
  }
}

function writeAll(ids: Set<string>): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...ids]));
  } catch {
    // 프라이빗 브라우징 등 localStorage 미가용 — 세션 내 상태만 유지(호출부가 별도 관리).
  }
}

export function getPinnedSessionIds(): Set<string> {
  if (typeof window === "undefined") return new Set();
  return readAll();
}

export function toggleSessionPinned(id: string): Set<string> {
  const ids = readAll();
  if (ids.has(id)) ids.delete(id);
  else ids.add(id);
  writeAll(ids);
  return ids;
}
