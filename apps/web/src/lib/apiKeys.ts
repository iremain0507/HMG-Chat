// lib/apiKeys.ts — P19-T6-16: /api/v1/api-keys(P19-T1-11) hand-written fetch 클라이언트.
//   generated 클라이언트 밖 확장이라 prompts.ts/sessionTags.ts 와 동일 컨벤션.
import { apiFetch } from "./fetch-with-refresh";

export interface ApiKeyDto {
  id: string;
  name: string;
  keyPrefix: string;
  scopes: string[];
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

export interface CreatedApiKeyDto extends ApiKeyDto {
  key: string;
}

export async function listApiKeys(): Promise<ApiKeyDto[]> {
  const res = await apiFetch("/api/v1/api-keys", { credentials: "include" });
  if (!res.ok) return [];
  const body = (await res.json()) as { data: ApiKeyDto[] };
  return body.data;
}

export async function createApiKey(
  name: string,
): Promise<CreatedApiKeyDto | null> {
  const res = await apiFetch("/api/v1/api-keys", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) return null;
  const body = (await res.json()) as { data: CreatedApiKeyDto };
  return body.data;
}

export async function revokeApiKey(id: string): Promise<boolean> {
  const res = await apiFetch(`/api/v1/api-keys/${id}`, {
    method: "DELETE",
    credentials: "include",
  });
  return res.ok;
}
