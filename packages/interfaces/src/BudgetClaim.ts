// packages/interfaces/src/BudgetClaim.ts
// § 10 — ToolContext 안. apps/server/src/db/quota-store.ts + Redis counter.
// 본 파일은 types.ts/errors.ts 를 import 하지 않음 (자기-완결 타입만 사용).

export interface BudgetClaim {
  // 도구 실행 전 예산 차감 (낙관적) — 부족 시 throw QUOTA_EXCEEDED
  claim(estimateMicros: number): Promise<void>;
  // 실행 후 실 사용량 확정 (음수 가능)
  settle(actualMicros: number): Promise<void>;
  // 도구 실패 시 환불
  refund(): Promise<void>;

  // 남은 예산 조회 (논블로킹)
  readonly remaining: number;
}
