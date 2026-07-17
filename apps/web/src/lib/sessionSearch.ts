// lib/sessionSearch.ts — 세션 내용검색 클라이언트 헬퍼(P19-T1-06 GET /sessions/search?q= 소비).
//   snippet 은 서버가 아직 계산해 내려주지 않아 optional(tolerant 파싱) — 없으면 UI 가 폴백
//   문구를 표시한다. generated 클라이언트 밖 확장이라 sessionTags.ts 와 동일하게 hand-written fetch.
import { apiFetch } from "./fetch-with-refresh";

export interface SessionSearchResultDto {
  id: string;
  title: string | null;
  lastMessageAt: string | null;
  snippet?: string;
}

export async function searchSessions(
  query: string,
  signal?: AbortSignal,
): Promise<SessionSearchResultDto[] | null> {
  const q = query.trim();
  if (!q) return [];
  const res = await apiFetch(
    `/api/v1/sessions/search?q=${encodeURIComponent(q)}`,
    { credentials: "include", ...(signal ? { signal } : {}) },
  );
  if (!res.ok) return null;
  const body = (await res.json()) as { data: SessionSearchResultDto[] };
  return body.data;
}
