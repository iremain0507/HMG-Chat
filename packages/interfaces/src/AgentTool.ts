// packages/interfaces/src/AgentTool.ts
// § 1 — ToolContext (facade) + AgentToolInvocation + AgentTool.
//
// types.ts 에서 spec-only 타입 import. ToolContext 는 본 파일이 정의
// (Logger/HitlBridge/BudgetClaim 의존). AgentToolInvocation 은 ToolContext
// 의존이라 본 파일에 정의 (types.ts forward reference 차단). AgentTool
// interface 의 invoke 시그니처 final 형태도 본 파일.
//
// AgentTool.ts 의 import 그래프 (§ 파일 분할 규칙의 명시 예외):
//   AgentTool.ts → types.ts   (AgentToolSpec, AgentToolResult, AgentToolBase)
//                → Logger.ts   (Logger 타입)
//                → HitlBridge.ts (HitlBridge 타입)
//                → BudgetClaim.ts (BudgetClaim 타입)
// 위 3 facade 파일은 AgentTool.ts 가 직접 import — "interface 파일끼리 직접
// import 금지" 의 명시 예외 (ToolContext 가 facade 이기 때문).

import type { AgentToolBase, AgentToolResult, ToolProgress } from "./types.js";
import type { Logger } from "./Logger.js";
import type { HitlBridge } from "./HitlBridge.js";
import type { BudgetClaim } from "./BudgetClaim.js";

export interface ToolContext {
  requestId: string;
  userId: string;
  orgId: string;
  sessionId: string;
  projectId?: string;
  signal: AbortSignal; // 필수 (L06)
  logger: Logger;
  hitl: HitlBridge;
  budget: BudgetClaim;
  // 장시간 멀티스텝 툴(deep_research 등)이 실행 중 진행 상태를 부모 스트림으로 relay 하기
  //   위한 선택적 채널. orchestrator 가 주입하면 tool_progress ChatEvent 로 방출되고,
  //   미주입(대부분 툴/직접 호출) 시 no-op — 툴은 `ctx.emitProgress?.(…)` 로 안전 호출.
  emitProgress?(progress: ToolProgress): void;
}

// types.ts 의 AgentToolBase 를 extend 해 invoke 시그니처 추가 (입력형 ToolContext 의존).
export interface AgentToolInvocation {
  toolCallId: string;
  args: Record<string, unknown>;
  ctx: ToolContext;
}

export interface AgentTool extends AgentToolBase {
  invoke(input: AgentToolInvocation): Promise<AgentToolResult>;
}
