// orchestrator/followups.ts — P19-T2-04 후속질문 제안. 마지막 턴(직전 user+assistant) 맥락으로
// LLM 에게 후속질문 3개를 JSON 배열로 요청한다. dev-stub echo 등으로 파싱이 실패하거나
// provider.chat 이 throw 해도 조용히 빈 배열을 반환하지 않고(21-LOOP-LESSONS.md L5), 마지막
// 턴 텍스트에서 결정적으로 파생한 3개 질문으로 폴백한다(memory-extractor.ts 의 "파싱 실패 시
// 빈 배열"과 달리, 이 기능은 "제안이 아예 없음"이 UX 상 실패로 보이므로 파생 폴백을 항상 유지).
import type { LLMMessage, LLMProvider } from "@wchat/interfaces";
import { DEFAULT_ORG_SETTINGS } from "../lib/org-settings-schema.js";

const FOLLOWUP_COUNT = 3;

const FOLLOWUP_SYSTEM_PROMPT = `다음은 사용자와 어시스턴트의 마지막 대화 턴이다. 사용자가 이어서
물어볼 만한 자연스러운 후속 질문을 정확히 3개 생성하라. 각 질문은 한국어 한 문장.
JSON 배열로만 응답하고 다른 텍스트는 출력하지 마: ["질문1", "질문2", "질문3"]`;

function parseFollowups(text: string): string[] | null {
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;

  const questions = parsed
    .filter((q): q is string => typeof q === "string" && q.trim().length > 0)
    .map((q) => q.trim());

  return questions.length >= FOLLOWUP_COUNT
    ? questions.slice(0, FOLLOWUP_COUNT)
    : null;
}

// LLM 이 비활성/파싱 불가일 때도 항상 3개를 결정적으로 반환하는 폴백(L2/L5) — 마지막
// assistant 텍스트(없으면 user 텍스트, 둘 다 없으면 일반 주제어)에서 앞 30자를 뽑아 정형
// 질문 템플릿에 채운다. 무작위 요소가 없어 동일 입력엔 항상 동일 출력을 낸다.
function deriveFollowups(
  lastUserText: string,
  lastAssistantText: string,
): string[] {
  const topicSource = lastAssistantText.trim() || lastUserText.trim();
  const topic = topicSource.length > 0 ? topicSource.slice(0, 30) : "이 주제";
  return [
    `${topic}에 대해 더 자세히 설명해줘`,
    `${topic}와 관련된 예시를 보여줘`,
    `${topic}에서 주의해야 할 점은 뭐야?`,
  ];
}

export interface GenerateFollowupsInput {
  provider: LLMProvider;
  model: string;
  lastUserText: string;
  lastAssistantText: string;
  signal: AbortSignal;
  // P14-T2-02 와 동일 패턴 — org-scoped 값을 넘기지 않으면 DEFAULT_ORG_SETTINGS 로 fail-soft.
  maxTokens?: number;
}

export async function generateFollowups(
  input: GenerateFollowupsInput,
): Promise<string[]> {
  const messages: LLMMessage[] = [
    { role: "user", content: input.lastUserText || "(대화 없음)" },
    { role: "assistant", content: input.lastAssistantText || "(대화 없음)" },
  ];

  let text = "";
  try {
    for await (const event of input.provider.chat(
      {
        model: input.model,
        systemBlocks: [{ tier: "system", content: FOLLOWUP_SYSTEM_PROMPT }],
        messages,
        maxTokens:
          input.maxTokens ?? DEFAULT_ORG_SETTINGS.toolMaxTokens ?? 4096,
      },
      input.signal,
    )) {
      if (event.type === "text_delta") text += event.text;
    }
  } catch {
    text = "";
  }

  return (
    parseFollowups(text) ??
    deriveFollowups(input.lastUserText, input.lastAssistantText)
  );
}
