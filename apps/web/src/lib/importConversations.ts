// lib/importConversations.ts — P22-T6-13(계약배치 C9) 대화 가져오기 클라이언트 헬퍼.
//   내보내기(export-conversation.ts)의 반대편. 사용자가 고른 JSON 파일을 브라우저에서 읽어
//   포맷만 판별하고 POST /api/v1/sessions/import 로 넘긴다 — 실제 파싱/세션 생성의 단일 출처는
//   서버(apps/server/src/lib/import-conversations.ts)다(클라 판별은 UX 용 힌트일 뿐).
//   타입은 16-API-CONTRACT/14-INTERFACES 밖 확장(generated 클라 미포함)이라 sessionTags.ts 와
//   동일하게 hand-written fetch + local 타입으로 둔다.
import { apiFetch } from "./fetch-with-refresh";

export type ImportFormat = "native" | "chatgpt";

/** 가져오기 성공 후 세션 목록을 다시 읽게 하는 앱레벨 이벤트(SessionList 가 구독). */
export const SESSIONS_CHANGED_EVENT = "wchat:sessions-changed";

export interface ImportResult {
  ok: boolean;
  createdSessionIds: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * JSON 구조로 포맷을 판별한다.
 *   native  = {title?, messages: []}            (우리 내보내기 conversationToJson 출력)
 *   chatgpt = {title?, mapping: {...}}          (ChatGPT conversations.json)
 * 둘 다 단건/배열 모두 허용. 판별 불가면 null.
 */
export function detectImportFormat(value: unknown): ImportFormat | null {
  const first = Array.isArray(value) ? value[0] : value;
  if (!isRecord(first)) return null;
  if (Array.isArray(first.messages)) return "native";
  if (isRecord(first.mapping)) return "chatgpt";
  return null;
}

/**
 * 파일 내용을 텍스트로 읽는다. Blob.text() 는 실브라우저에는 있지만 테스트 환경(jsdom)에는
 * 없어서, 있으면 그대로 쓰고 없으면 FileReader 로 폴백한다. 폴백이 없으면 성공 경로가
 * 테스트에서 조용히 실패해 "실패를 기대하는" 케이스만 통과하는 false-positive 가 생긴다.
 */
function readFileAsText(file: File): Promise<string> {
  if (typeof file.text === "function") return file.text();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.readAsText(file);
  });
}

/**
 * 파일을 읽어 서버로 가져오기를 요청한다. 파싱 실패/포맷 미상이면 요청 자체를 보내지 않는다
 * (불필요한 400 왕복 방지).
 */
export async function importConversationsFromFile(
  file: File,
): Promise<ImportResult> {
  let payload: unknown;
  try {
    payload = JSON.parse(await readFileAsText(file));
  } catch {
    return { ok: false, createdSessionIds: [] };
  }
  const format = detectImportFormat(payload);
  if (!format) return { ok: false, createdSessionIds: [] };

  const res = await apiFetch("/api/v1/sessions/import", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ format, payload }),
  });
  if (!res.ok) return { ok: false, createdSessionIds: [] };
  const json = (await res.json()) as {
    data?: { createdSessionIds?: string[] };
  };
  return { ok: true, createdSessionIds: json.data?.createdSessionIds ?? [] };
}
