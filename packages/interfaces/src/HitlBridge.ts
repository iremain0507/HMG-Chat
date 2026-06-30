// packages/interfaces/src/HitlBridge.ts
// § 9 — 보조 인터페이스 (ToolContext 안에서 사용). HitlDecision 동봉.
// apps/server/src/tools/hitl-manager.ts 가 구현.
// 본 파일은 types.ts/errors.ts 를 import 하지 않음 (자기-완결 타입만 사용).

export interface HitlBridge {
  // 도구 호출 직전에 사용자 승인 요청.
  // toolCallId 는 호출자가 미리 생성 (uuid v4) — Redis key + API path 모두 사용.
  // 동일 sessionId + toolCallId 호출은 idempotent (재시도 안전).
  askApproval(
    input: {
      sessionId: string; // bridge 가 Redis key 와 user routing 에 사용
      toolCallId: string; // 외부 식별자 — 16 § /sessions/:id/messages/hitl 가 요구
      toolName: string;
      args: Record<string, unknown>;
      rationale: string; // 모델이 작성한 "왜 이걸 호출하는지"
      timeoutMs?: number; // default 300_000 (5분)
    },
    signal: AbortSignal,
  ): Promise<HitlDecision>;
}

export type HitlDecision =
  | { kind: "approved"; modifiedArgs?: Record<string, unknown> }
  | { kind: "denied"; reason?: string }
  | { kind: "timeout" };
