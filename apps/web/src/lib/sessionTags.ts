// lib/sessionTags.ts — 세션 태그 클라이언트 헬퍼(P19-T1-04 /api/v1/sessions/:id/tags 소비).
//   태그 타입은 16-API-CONTRACT/14-INTERFACES 밖 확장(generated 클라 미포함)이라 sessionFolders.ts
//   와 동일하게 hand-written fetch + local 타입으로 둔다.
import { apiFetch } from "./fetch-with-refresh";

export async function addSessionTag(
  sessionId: string,
  tag: string,
): Promise<string | undefined> {
  const res = await apiFetch(`/api/v1/sessions/${sessionId}/tags`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tag }),
  });
  if (!res.ok) return undefined;
  return tag;
}

export async function removeSessionTag(
  sessionId: string,
  tag: string,
): Promise<boolean> {
  const res = await apiFetch(
    `/api/v1/sessions/${sessionId}/tags/${encodeURIComponent(tag)}`,
    { method: "DELETE", credentials: "include" },
  );
  return res.ok || res.status === 204;
}
