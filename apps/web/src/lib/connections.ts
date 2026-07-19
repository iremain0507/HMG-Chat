// lib/connections.ts — P22-T6-14: /api/v1/connections(외부 OpenAI 호환 provider 연결)
//   hand-written fetch 클라이언트. generated 클라이언트 밖 확장이라 apiKeys.ts/prompts.ts 와
//   동일 컨벤션. 서버 계약상 응답에는 평문 API 키가 없고 keyPrefix 만 온다 —
//   DTO 에도 key 필드를 두지 않아 UI 가 실수로 렌더할 경로를 구조적으로 막는다.
import { apiFetch } from "./fetch-with-refresh";

export interface ProviderConnectionDto {
  id: string;
  orgId: string;
  name: string;
  kind: "openai-compatible";
  baseUrl: string;
  keyPrefix: string;
  enabled: boolean;
  verifiedAt: string | null;
  models: string[];
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateConnectionInput {
  name: string;
  baseUrl: string;
  apiKey: string;
}

export interface UpdateConnectionInput {
  name?: string;
  baseUrl?: string;
  apiKey?: string;
  enabled?: boolean;
  models?: string[];
}

export interface VerifyConnectionResult {
  verified: boolean;
  message?: string;
  connection: ProviderConnectionDto;
}

const BASE = "/api/v1/connections";

/** 서버 error envelope 에서 사용자에게 보여줄 메시지만 뽑는다. */
async function errorMessage(res: Response, fallback: string): Promise<string> {
  const body = (await res.json().catch(() => null)) as {
    error?: { message?: string };
  } | null;
  return body?.error?.message ?? fallback;
}

export async function listConnections(): Promise<ProviderConnectionDto[]> {
  const res = await apiFetch(BASE, { credentials: "include" });
  if (!res.ok) return [];
  const body = (await res.json()) as { data: ProviderConnectionDto[] };
  return body.data ?? [];
}

export async function createConnection(
  input: CreateConnectionInput,
): Promise<{ connection: ProviderConnectionDto } | { error: string }> {
  const res = await apiFetch(BASE, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    return { error: await errorMessage(res, "연결을 추가하지 못했습니다.") };
  }
  const body = (await res.json()) as { data: ProviderConnectionDto };
  return { connection: body.data };
}

export async function updateConnection(
  id: string,
  patch: UpdateConnectionInput,
): Promise<{ connection: ProviderConnectionDto } | { error: string }> {
  const res = await apiFetch(`${BASE}/${id}`, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    return { error: await errorMessage(res, "연결을 수정하지 못했습니다.") };
  }
  const body = (await res.json()) as { data: ProviderConnectionDto };
  return { connection: body.data };
}

export async function verifyConnection(
  id: string,
): Promise<VerifyConnectionResult | { error: string }> {
  const res = await apiFetch(`${BASE}/${id}/verify`, {
    method: "POST",
    credentials: "include",
  });
  if (!res.ok) {
    return { error: await errorMessage(res, "검증에 실패했습니다.") };
  }
  const body = (await res.json()) as { data: VerifyConnectionResult };
  return body.data;
}

export async function deleteConnection(id: string): Promise<boolean> {
  const res = await apiFetch(`${BASE}/${id}`, {
    method: "DELETE",
    credentials: "include",
  });
  return res.ok;
}
