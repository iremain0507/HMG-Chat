// routes/completions.ts — P22-T6-16 / 계약배치 C10: 입력 자동완성(ghost text) 백엔드.
//   POST /api/v1/completions { draft, context? } → { data: { completion } }
//   컴포저에서 사용자가 타이핑을 잠시 멈추면 프론트가 이 엔드포인트를 debounce 호출하고,
//   응답 조각을 커서 뒤 회색 ghost text 로 그린다(Tab 수락).
//
// 설계 결정:
//   - orchestrator/followups.ts(generateFollowups) 와 같은 "짧은 보조 LLM 호출" 패턴 재사용.
//     턴을 저장하지 않고, 도구도 쓰지 않으며, 스트리밍 없이 한 번에 조각만 만든다.
//   - org 게이트: org_settings.autocompleteEnabled(로컬 Zod, JSONB 라 migration 불필요) 가
//     false 면 403 FEATURE_DISABLED. settings 미주입(테스트 등)은 허용(api-keys.ts 패턴).
//   - 취소 전파: c.req.raw.signal 을 그대로 provider.chat 에 넘겨, 사용자가 계속 타이핑해
//     프론트가 fetch 를 abort 하면 LLM 호출도 즉시 끊긴다(C10 승인 조건).
//   - fail-soft(21-LOOP-LESSONS L2): provider 오류/파싱 불가는 500 이 아니라 completion:"" —
//     자동완성은 보조 기능이라 실패가 입력을 막아서는 안 된다.
import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import type { LLMMessage, LLMProvider } from "@wchat/interfaces";
import type { AuthedVariables } from "../middleware/auth-middleware.js";
import type { SettingsService } from "../lib/settings-service.js";
import {
  CompletionRequestSchema,
  MAX_COMPLETION_CHARS,
} from "../lib/completion-schema.js";

// 이어쓰기 조각은 짧아야 한다(한 문장 남짓) — 길면 ghost text 가 컴포저를 덮고 비용도 낭비.
const COMPLETION_MAX_TOKENS = 64;

const COMPLETION_SYSTEM_PROMPT = `너는 채팅 입력창의 자동완성 엔진이다. 사용자가 쓰다 만 초안을
자연스럽게 "이어서" 완성할 조각만 출력하라. 규칙:
- 초안을 다시 쓰지 말고, 초안 바로 뒤에 붙일 텍스트만 출력한다.
- 최대 한 문장. 설명·따옴표·머리말 없이 조각 자체만 출력한다.
- 이어쓸 내용이 마땅치 않으면 빈 문자열을 출력한다.`;

function errorJson(code: string, message: string) {
  return {
    error: { code, category: "http" as const, message, retryable: false },
  };
}

// 모델이 지시를 어기고 초안을 통째로 반복하거나 따옴표로 감싸는 경우를 정리한다.
// 프론트는 이 값을 draft 뒤에 그대로 이어 붙이므로, 여기서 정규화하지 않으면 중복이 보인다.
function normalizeCompletion(raw: string, draft: string): string {
  let text = raw.trim();
  if (text.startsWith(draft.trim()) && draft.trim().length > 0) {
    text = text.slice(draft.trim().length).trim();
  }
  const quoted = text.match(/^["'“”'](.*)["'“”']$/s);
  if (quoted?.[1] !== undefined) text = quoted[1].trim();
  // 개행 이후는 버린다 — 한 문장 조각만 ghost text 로 그린다.
  const firstLine = text.split("\n")[0] ?? "";
  return firstLine.slice(0, MAX_COMPLETION_CHARS).trim();
}

export interface CreateCompletionRoutesDeps {
  provider: LLMProvider;
  /** 빠른 task 모델(기본 모델과 동일해도 무방) */
  model: string;
  /** 미주입이면 org 게이트 없이 항상 허용(기존 라우트들과 동일한 fail-open 테스트 편의) */
  settings?: SettingsService;
}

export function createCompletionRoutes(
  deps: CreateCompletionRoutesDeps,
): Hono<{ Variables: AuthedVariables }> {
  const app = new Hono<{ Variables: AuthedVariables }>();

  app.post("/", async (c) => {
    const auth = c.get("auth");

    if (deps.settings) {
      const resolved = await deps.settings.resolve(auth.org);
      if (!resolved.autocompleteEnabled) {
        return c.json(
          errorJson(
            "FEATURE_DISABLED",
            "입력 자동완성이 조직 설정에서 비활성화돼 있습니다.",
          ),
          403,
        );
      }
    }

    const raw = await c.req.json().catch(() => null);
    const parsed = CompletionRequestSchema.safeParse(raw);
    if (!parsed.success) {
      return c.json(
        errorJson("INVALID_INPUT", "draft 가 필요합니다(1~4000자)."),
        400,
      );
    }
    const { draft, context } = parsed.data;

    const messages: LLMMessage[] = [
      ...(context
        ? [{ role: "user" as const, content: `직전 대화 맥락:\n${context}` }]
        : []),
      { role: "user" as const, content: `초안:\n${draft}` },
    ];

    let text = "";
    try {
      for await (const event of deps.provider.chat(
        {
          model: deps.model,
          systemBlocks: [{ tier: "system", content: COMPLETION_SYSTEM_PROMPT }],
          messages,
          maxTokens: COMPLETION_MAX_TOKENS,
        },
        c.req.raw.signal,
      )) {
        if (event.type === "text_delta") text += event.text;
      }
    } catch {
      // fail-soft — 자동완성 실패는 조용히 "제안 없음"이다(입력 흐름을 막지 않는다).
      text = "";
    }

    return c.json({
      data: { completion: normalizeCompletion(text, draft) },
      meta: { requestId: randomUUID() },
    });
  });

  return app;
}
