// lib/prompts.ts — P19-T6-13: /api/v1/prompts(P19-T1-08) hand-written fetch 클라이언트.
//   generated 클라이언트 밖 확장이라 sessionSearch.ts/sessionTags.ts 와 동일 컨벤션.
import { apiFetch } from "./fetch-with-refresh";

export type PromptAccess = "private" | "org";

export interface PromptDto {
  id: string;
  command: string;
  title: string;
  content: string;
  access: PromptAccess;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
}

export interface PromptInput {
  command: string;
  title: string;
  content: string;
  access?: PromptAccess;
}

export async function listPrompts(): Promise<PromptDto[]> {
  const res = await apiFetch("/api/v1/prompts", { credentials: "include" });
  if (!res.ok) return [];
  const body = (await res.json()) as { data: PromptDto[] };
  return body.data;
}

export async function createPrompt(
  input: PromptInput,
): Promise<PromptDto | null> {
  const res = await apiFetch("/api/v1/prompts", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) return null;
  const body = (await res.json()) as { data: PromptDto };
  return body.data;
}

export async function updatePrompt(
  id: string,
  input: Partial<PromptInput>,
): Promise<PromptDto | null> {
  const res = await apiFetch(`/api/v1/prompts/${id}`, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) return null;
  const body = (await res.json()) as { data: PromptDto };
  return body.data;
}

export async function deletePrompt(id: string): Promise<boolean> {
  const res = await apiFetch(`/api/v1/prompts/${id}`, {
    method: "DELETE",
    credentials: "include",
  });
  return res.ok;
}
