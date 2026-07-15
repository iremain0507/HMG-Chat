// orchestrator/memory-extractor.ts — 17-PROMPT-ASSETS.md § 17.5 메모리 추출 알고리즘.
// 세션 종료 시 메시지 >= 4 이면 LLM 에게 4 카테고리(user/feedback/project/reference) 추출을 요청하고
// 응답 JSON 을 파싱한다. dedup/PII reject 등 후처리는 별도 태스크(P7-T2-02/DB 계층) 범위.
import type { LLMMessage, LLMProvider, UserMemory } from "@wchat/interfaces";

export type ExtractedMemory = Pick<UserMemory, "category" | "content">;

const MEMORY_CATEGORIES: readonly UserMemory["category"][] = [
  "user",
  "feedback",
  "project",
  "reference",
];

const MIN_MESSAGES_FOR_EXTRACTION = 4;
export const MEMORY_EXTRACTION_MODEL = "claude-sonnet-4-6";

const EXTRACTION_SYSTEM_PROMPT = `다음 대화에서 사용자에 대해 "영구히 기억할 만한" 정보를 추출하라.
카테고리: user (직무/선호) / feedback (응답 평가) / project (작업 컨텍스트) / reference (참고 링크).
각 항목 1-2문장. 일회성/시간 의존 정보는 제외.
JSON 배열로만 응답: [{"category": "...", "content": "..."}]`;

function isMemoryCategory(value: unknown): value is UserMemory["category"] {
  return (
    typeof value === "string" &&
    (MEMORY_CATEGORIES as readonly string[]).includes(value)
  );
}

function parseExtractionResponse(text: string): ExtractedMemory[] {
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const results: ExtractedMemory[] = [];
  for (const item of parsed) {
    if (typeof item !== "object" || item === null) continue;
    const { category, content } = item as Record<string, unknown>;
    if (!isMemoryCategory(category)) continue;
    if (typeof content !== "string") continue;
    const trimmed = content.trim();
    if (trimmed.length === 0) continue;
    results.push({ category, content: trimmed });
  }
  return results;
}

export async function extractMemories(
  llm: LLMProvider,
  messages: LLMMessage[],
  signal: AbortSignal,
): Promise<ExtractedMemory[]> {
  if (messages.length < MIN_MESSAGES_FOR_EXTRACTION) return [];

  let text = "";
  for await (const event of llm.chat(
    {
      model: MEMORY_EXTRACTION_MODEL,
      systemBlocks: [{ tier: "system", content: EXTRACTION_SYSTEM_PROMPT }],
      messages,
      maxTokens: 1024,
    },
    signal,
  )) {
    if (event.type === "text_delta") text += event.text;
  }

  return parseExtractionResponse(text);
}
