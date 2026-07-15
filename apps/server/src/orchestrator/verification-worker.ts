// verification-worker.ts — MAST 검증 worker(20-MULTI-AGENT-TOOL.md §20.6/P12-T2-06,
//   검증부재 21.3% 가드). 멀티에이전트 종합(synthesis) 직전 후보 결과를 무툴(tools 미지정)
//   runTurn 으로 재검증한다 — evaluator-optimizer.ts(P12-T2-05) 의 evaluator 와 동일한
//   "첫 줄 판정 토큰 + 이후 근거" 패턴이나, 저 파일은 생성기-평가기 반복개선 루프이고
//   이 함수는 (재)생성 없이 단발 검증만 하는 별도 관심사 — dag-planner/orchestrator-worker
//   가 서브태스크 결과를 부모에 합류시키기 전 호출하는 게이트로 쓰인다.
import type { LLMMessage, LLMProvider } from "@wchat/interfaces";
import { runTurn } from "./orchestrator.js";
import { consumeUntilAbort } from "./consume-until-abort.js";

export interface VerificationWorkerOptions {
  provider: LLMProvider;
  model: string;
  maxTokens: number;
  systemPrompt?: string;
}

export interface VerificationVerdict {
  verified: boolean;
  feedback: string;
}

const DEFAULT_SYSTEM_PROMPT =
  '다음 결과가 주어진 작업을 실제로 완수했는지 검증하라. 응답 첫 줄에 정확히 "VERIFIED" 또는 "REJECTED" 만 쓰고, 다음 줄부터 근거를 작성하라.';

function parseVerdict(text: string): VerificationVerdict {
  const lines = text.trim().split("\n");
  const first = (lines[0] ?? "").trim().toUpperCase();
  const feedback = lines.slice(1).join("\n").trim();
  return { verified: first.startsWith("VERIFIED"), feedback };
}

export async function verifyBeforeSynthesis(
  task: string,
  candidateText: string,
  options: VerificationWorkerOptions,
  signal: AbortSignal,
): Promise<VerificationVerdict> {
  const messages: LLMMessage[] = [
    { role: "user", content: `작업: ${task}\n\n결과:\n${candidateText}` },
  ];
  let text = "";
  const events = runTurn({
    provider: options.provider,
    model: options.model,
    systemBlocks: [
      {
        tier: "system",
        content: options.systemPrompt ?? DEFAULT_SYSTEM_PROMPT,
      },
    ],
    messages,
    maxTokens: options.maxTokens,
    signal,
  });
  await consumeUntilAbort(events, signal, (event) => {
    if (event.type === "text_delta") text += event.text;
  });
  return parseVerdict(text);
}
