// orchestrator/session-title-tags.ts — P19-T2-06 첫 턴(최초 user+assistant) 완료 후 세션
// 제목·태그를 LLM 에게 요청한다. dev-stub echo 등으로 파싱이 실패하거나 provider.chat 이
// throw 해도 조용히 실패하지 않고(21-LOOP-LESSONS.md L5), deriveSessionTitle(기존 파생 제목
// 함수)과 첫 턴 텍스트에서 결정적으로 파생한 태그 1개로 폴백한다(followups.ts 와 동일 패턴).
import type { LLMMessage, LLMProvider } from "@wchat/interfaces";
import { DEFAULT_ORG_SETTINGS } from "../lib/org-settings-schema.js";
import { deriveSessionTitle } from "../lib/session-title.js";

const TITLE_TAGS_SYSTEM_PROMPT = `다음은 사용자와 어시스턴트의 첫 대화 턴이다. 이 대화를
대표하는 짧은 세션 제목(한국어, 40자 이내)과 태그 1~3개(한국어 명사구, 각 15자 이내)를
생성하라. JSON 객체로만 응답하고 다른 텍스트는 출력하지 마:
{"title":"...", "tags":["...","..."]}`;

function parseTitleTags(
  text: string,
): { title: string; tags: string[] } | null {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const obj = parsed as Record<string, unknown>;

  const title = typeof obj.title === "string" ? obj.title.trim() : "";
  if (!title) return null;

  const rawTags = Array.isArray(obj.tags) ? obj.tags : [];
  const tags = rawTags
    .filter((t): t is string => typeof t === "string" && t.trim().length > 0)
    .map((t) => t.trim().slice(0, 15))
    .slice(0, 3);

  return { title: title.slice(0, 40), tags };
}

// LLM 이 비활성/파싱 불가일 때도 결정적으로 태그 1개를 반환하는 폴백(L2/L5) — 사용자 텍스트
// (없으면 assistant 텍스트)의 앞 15자를 그대로 태그로 쓴다. 무작위 요소가 없어 동일 입력엔
// 항상 동일 출력을 낸다.
function deriveTags(userText: string, assistantText: string): string[] {
  const topicSource = userText.trim() || assistantText.trim();
  if (!topicSource) return [];
  const topic = topicSource.replace(/\s+/g, " ").slice(0, 15);
  return [topic];
}

export interface GenerateSessionTitleTagsInput {
  provider: LLMProvider;
  model: string;
  userText: string;
  assistantText: string;
  signal: AbortSignal;
  // P14-T2-02 와 동일 패턴 — org-scoped 값을 넘기지 않으면 DEFAULT_ORG_SETTINGS 로 fail-soft.
  maxTokens?: number;
}

export interface SessionTitleTagsResult {
  title: string | null;
  tags: string[];
}

export async function generateSessionTitleAndTags(
  input: GenerateSessionTitleTagsInput,
): Promise<SessionTitleTagsResult> {
  const messages: LLMMessage[] = [
    { role: "user", content: input.userText || "(대화 없음)" },
    { role: "assistant", content: input.assistantText || "(대화 없음)" },
  ];

  let text = "";
  try {
    for await (const event of input.provider.chat(
      {
        model: input.model,
        systemBlocks: [{ tier: "system", content: TITLE_TAGS_SYSTEM_PROMPT }],
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

  const parsed = parseTitleTags(text);
  if (parsed) return parsed;

  return {
    title: deriveSessionTitle(input.userText),
    tags: deriveTags(input.userText, input.assistantText),
  };
}
