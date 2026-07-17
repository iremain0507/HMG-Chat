// lib/sessionFolders.ts — 세션 폴더 클라이언트 헬퍼(P19-T1-03 /api/v1/folders 소비).
//   폴더 타입은 16-API-CONTRACT/14-INTERFACES 밖 확장(generated 클라 미포함)이라 pinnedSessions.ts
//   와 동일하게 hand-written fetch + local 타입으로 둔다.
import { apiFetch } from "./fetch-with-refresh";

export interface SessionFolder {
  id: string;
  name: string;
  // P20-T1-03 — 폴더 스코프 시스템 프롬프트(Open WebUI Folder System Prompt 참고).
  // 미설정 폴더는 null.
  systemPrompt: string | null;
  createdAt: string;
}

export async function listFolders(): Promise<SessionFolder[] | null> {
  const res = await apiFetch("/api/v1/folders", { credentials: "include" });
  if (!res.ok) return null;
  const body = (await res.json()) as { data: SessionFolder[] };
  return body.data;
}

export async function createFolder(
  name: string,
): Promise<SessionFolder | null> {
  const res = await apiFetch("/api/v1/folders", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) return null;
  const body = (await res.json()) as { data: SessionFolder };
  return body.data;
}

export async function renameFolder(
  id: string,
  name: string,
): Promise<SessionFolder | null> {
  const res = await apiFetch(`/api/v1/folders/${id}`, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) return null;
  const body = (await res.json()) as { data: SessionFolder };
  return body.data;
}

export async function updateFolderSystemPrompt(
  id: string,
  systemPrompt: string | null,
): Promise<SessionFolder | null> {
  const res = await apiFetch(`/api/v1/folders/${id}`, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ systemPrompt }),
  });
  if (!res.ok) return null;
  const body = (await res.json()) as { data: SessionFolder };
  return body.data;
}

export async function deleteFolder(id: string): Promise<boolean> {
  const res = await apiFetch(`/api/v1/folders/${id}`, {
    method: "DELETE",
    credentials: "include",
  });
  return res.ok || res.status === 204;
}

export async function assignSessionFolder(
  sessionId: string,
  folderId: string | null,
): Promise<string | null | undefined> {
  const res = await apiFetch(`/api/v1/sessions/${sessionId}`, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ folderId }),
  });
  if (!res.ok) return undefined;
  return folderId;
}
