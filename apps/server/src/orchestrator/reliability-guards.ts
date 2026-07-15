// reliability-guards.ts — MAST 신뢰성 가드(20-MULTI-AGENT-TOOL.md §20.6/P12-T2-06):
//   runTurn 의 tool-execution 루프에 옵트인(`RunTurnInput.reliabilityGuards`)으로 주입되는
//   저비용 순수 판정 함수. MAST(arXiv:2503.13657) 실패 taxonomy 중 스텝반복(17.1%)·
//   종료조건 부재(9.8%)·추론-행동 불일치(14%) 를 프롬프트/LLM 판정 없이 런타임에 차단한다.
//   `reliabilityGuards` 미설정 시 orchestrator.ts 의 runTurn 은 이 모듈을 전혀 참조하지
//   않으므로 기존 동작·테스트에 영향이 없다.
import type { ChatEvent } from "@wchat/interfaces";

export const DEFAULT_MAX_STEPS = 25;
export const DEFAULT_STEP_REPETITION_THRESHOLD = 3;

export interface ReliabilityGuardOptions {
  // 이 라운드 수를 초과하면 명시적 종료조건(MAST 종료조건 부재 9.8%)으로 중단. 기본 25.
  maxSteps?: number;
  // 동일 tool_use 세트가 이 횟수만큼 연속 반복되면 스텝반복(MAST 17.1%)으로 차단. 기본 3.
  stepRepetitionThreshold?: number;
  // true 면 tool_use 직전 추론 텍스트가 공백뿐일 때 추론-행동 불일치(MAST 14%)로 차단.
  // 정상적으로 첫 턴부터 곧장 tool_use 하는 흐름이 흔해 기본은 off(opt-in).
  checkReasoningActionConsistency?: boolean;
}

export type ToolCallSignature = string;

// name+args 를 안정적인 문자열 시그니처로 — 라운드 간 동일 tool_use 비교에 사용.
export function toolCallSignature(
  name: string,
  args: unknown,
): ToolCallSignature {
  return `${name}:${JSON.stringify(args) ?? "undefined"}`;
}

// 직전 라운드와 이번 라운드의 tool_use 세트(이름+args)가 순서 무관 완전히 동일하면
// true — 진행 없이 같은 행동을 반복하는 MAST 스텝반복 패턴.
export function detectStepRepetition(
  previousRoundSignatures: ToolCallSignature[],
  currentRoundSignatures: ToolCallSignature[],
): boolean {
  if (currentRoundSignatures.length === 0) return false;
  if (previousRoundSignatures.length !== currentRoundSignatures.length) {
    return false;
  }
  const prevSorted = [...previousRoundSignatures].sort();
  const curSorted = [...currentRoundSignatures].sort();
  return prevSorted.every((sig, i) => sig === curSorted[i]);
}

// tool_use 가 하나 이상 있는데 그 직전까지 누적된 assistant 텍스트(추론)가 공백뿐이면
// "왜" 이 행동을 하는지 근거 없이 호출한 것으로 보고 불일치 판정.
export function checkReasoningActionConsistency(
  reasoningText: string,
  toolUseCount: number,
): boolean {
  if (toolUseCount === 0) return true;
  return reasoningText.trim().length > 0;
}

export function reliabilityError(
  code: string,
  message: string,
): Extract<ChatEvent, { type: "error" }> {
  return {
    type: "error",
    error: { code, category: "orchestrator", message, retryable: false },
  };
}
