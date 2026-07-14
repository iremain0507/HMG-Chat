// orchestrator/llm-failover.ts — P11-T2-08
//
// LLMProvider 를 감싸 candidate 목록(primary + fallback) 사이를 전환하는 게이트웨이.
// 전환 규칙(20-MULTI-AGENT-TOOL.md §20.4 원칙 5): failover 는 **첫 text_delta/tool_use
// 이전**에만 허용한다 — message_start 등 콘텐츠 이전 이벤트는 버퍼링했다가 그 candidate 가
// 성공(콘텐츠 발생 또는 오류 없이 스트림 종료)하면 flush, 첫 콘텐츠 전에 오류가 나면 버리고
// 다음 candidate 로 넘어간다. 콘텐츠가 이미 방출된 뒤의 오류는 무음전환 없이 그대로 표면화한다.
//
// context-window fallback 은 candidate.model 로 표현한다 — 별도 오류 분류 없이, 컨텍스트 초과를
// 포함한 모든 첫토큰-이전 실패가 동일한 candidate 전환 경로를 타며, fallback candidate 에
// 더 큰 컨텍스트 모델을 지정해두면 그 모델로 재시도된다.
//
// backoff: candidate 전환마다 delay(backoffMs(attempt)) 로 지연. cooldown: candidate 가
// maxConsecutiveFailures 회 연속으로 첫토큰-이전 실패하면 cooldownMs 동안 이후 chat() 호출에서
// 건너뛴다(단, 전부 cooldown 중이면 best-effort 로 원래 순서를 그대로 시도).
import type { ChatEvent, ChatInput, LLMProvider } from "@wchat/interfaces";

export interface LLMFailoverCandidate {
  provider: LLMProvider;
  model?: string;
}

export interface CreateLLMFailoverDeps {
  candidates: LLMFailoverCandidate[];
  cooldownMs?: number;
  maxConsecutiveFailures?: number;
  backoffMs?: (attempt: number) => number;
  now?: () => number;
  delay?: (ms: number) => Promise<void>;
}

type ErrorEvent = Extract<ChatEvent, { type: "error" }>;

const DEFAULT_COOLDOWN_MS = 30_000;
const DEFAULT_MAX_CONSECUTIVE_FAILURES = 2;
const defaultBackoffMs = (attempt: number): number =>
  Math.min(100 * 2 ** attempt, 2_000);
const defaultDelay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

function toErrorEvent(err: unknown): ErrorEvent {
  return {
    type: "error",
    error: {
      code: "LLM_FAILOVER_STREAM_ERROR",
      category: "external-api",
      message: err instanceof Error ? err.message : String(err),
      retryable: false,
    },
  };
}

export function createLLMFailoverProvider(
  deps: CreateLLMFailoverDeps,
): LLMProvider {
  const { candidates } = deps;
  if (candidates.length === 0) {
    throw new Error("createLLMFailoverProvider: candidates 최소 1개 필요");
  }
  const cooldownMs = deps.cooldownMs ?? DEFAULT_COOLDOWN_MS;
  const maxConsecutiveFailures =
    deps.maxConsecutiveFailures ?? DEFAULT_MAX_CONSECUTIVE_FAILURES;
  const backoffMs = deps.backoffMs ?? defaultBackoffMs;
  const now = deps.now ?? (() => Date.now());
  const delay = deps.delay ?? defaultDelay;

  const failureState = new Map<
    number,
    { failures: number; cooldownUntil: number }
  >();
  const models = [...new Set(candidates.flatMap((c) => c.provider.models))];

  return {
    name: "failover",
    models,
    async *chat(
      input: ChatInput,
      signal: AbortSignal,
    ): AsyncIterable<ChatEvent> {
      const available = candidates
        .map((candidate, index) => ({ candidate, index }))
        .filter(({ index }) => {
          const state = failureState.get(index);
          return !state || state.cooldownUntil <= now();
        });
      const attemptOrder =
        available.length > 0
          ? available
          : candidates.map((candidate, index) => ({ candidate, index }));

      let lastPreTokenError: ErrorEvent | undefined;

      for (let attempt = 0; attempt < attemptOrder.length; attempt++) {
        if (signal.aborted) {
          yield {
            type: "stop",
            reason: "aborted",
            usage: { inputTokens: 0, outputTokens: 0 },
          };
          return;
        }
        if (attempt > 0) {
          await delay(backoffMs(attempt - 1));
        }

        const { candidate, index } = attemptOrder[attempt] as {
          candidate: LLMFailoverCandidate;
          index: number;
        };
        const candidateInput: ChatInput = candidate.model
          ? { ...input, model: candidate.model }
          : input;

        let started = false;
        let buffer: ChatEvent[] = [];
        let failedBeforeFirstToken = false;
        let terminalError: ErrorEvent | undefined;

        try {
          for await (const event of candidate.provider.chat(
            candidateInput,
            signal,
          )) {
            if (event.type === "text_delta" || event.type === "tool_use") {
              started = true;
              for (const buffered of buffer) yield buffered;
              buffer = [];
              yield event;
              continue;
            }
            if (event.type === "error") {
              if (started) {
                terminalError = event;
              } else {
                failedBeforeFirstToken = true;
                lastPreTokenError = event;
              }
              break;
            }
            if (started) {
              yield event;
            } else {
              buffer.push(event);
            }
          }
        } catch (err) {
          if (started) {
            terminalError = toErrorEvent(err);
          } else {
            failedBeforeFirstToken = true;
            lastPreTokenError = toErrorEvent(err);
          }
        }

        if (terminalError) {
          // 첫 토큰 이후 오류 = 무음전환 금지, 그대로 표면화하고 종료.
          yield terminalError;
          return;
        }

        if (failedBeforeFirstToken) {
          const state = failureState.get(index) ?? {
            failures: 0,
            cooldownUntil: 0,
          };
          state.failures += 1;
          if (state.failures >= maxConsecutiveFailures) {
            state.cooldownUntil = now() + cooldownMs;
          }
          failureState.set(index, state);
          continue;
        }

        // 성공(콘텐츠 발생 또는 오류 없이 정상 종료) — 연속 실패 카운터 리셋.
        failureState.set(index, { failures: 0, cooldownUntil: 0 });
        for (const buffered of buffer) yield buffered;
        return;
      }

      if (lastPreTokenError) {
        yield lastPreTokenError;
      }
    },
  };
}
