// lib/archivedSessions.ts — 세션 아카이브 토글 클라이언트 헬퍼(P19-T1-05 PATCH /:id/archive 소비).
import { apiFetch } from "./fetch-with-refresh";

export async function toggleSessionArchive(
  id: string,
): Promise<boolean | null> {
  const res = await apiFetch(`/api/v1/sessions/${id}/archive`, {
    method: "PATCH",
    credentials: "include",
  });
  if (!res.ok) return null;
  const body = (await res.json()) as {
    data: { id: string; archived: boolean };
  };
  return body.data.archived;
}
