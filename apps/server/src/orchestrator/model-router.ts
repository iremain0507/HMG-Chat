// orchestrator/model-router.ts — P11-T2-07
//
// 정적 role→model 맵 + org.plan 상한. runTurn(orchestrator role) 과 memory-extractor/
// (향후) titling 호출부가 이 모듈의 selectModel()로 ChatInput.model 을 결정한다. 실제
// 라우팅 관측은 새 필드를 추가하지 않고 기존 ChatEvent message_start.meta{provider,model}
// 로 충분(14-INTERFACES.md § 6) — selectModel 이 고른 model 이 ChatInput.model 로 흘러가면
// provider.chat() 이 그대로 message_start.meta.model 에 반영한다.
import { WChatError } from "@wchat/interfaces";

export type ModelRole = "orchestrator" | "memory" | "titling";

// role 기본 모델 — orchestrator=상위(추론 품질 우선), memory/titling=경량(비용 우선).
// memory 는 memory-extractor.ts 의 기존 MEMORY_EXTRACTION_MODEL 상수와 동일 값 유지.
export const ROLE_DEFAULT_MODEL: Record<ModelRole, string> = {
  orchestrator: "claude-opus-4-7",
  memory: "claude-sonnet-4-6",
  titling: "claude-sonnet-4-6",
};

// org.plan 상한 — premium(상위) 모델은 plan 이 명시적으로 허용해야 사용 가능.
const PREMIUM_MODELS = new Set([
  "claude-opus-4-7",
  "gpt-5.1",
  "gemini-2.5-pro",
]);

const PLAN_ALLOWS_PREMIUM: Record<string, boolean> = {
  pro: true,
  enterprise: true,
};

function planAllowsModel(plan: string, model: string): boolean {
  if (!PREMIUM_MODELS.has(model)) return true;
  return PLAN_ALLOWS_PREMIUM[plan] === true;
}

export interface ModelRouterOrg {
  plan: string;
  allowedModels: string[];
}

export interface SelectModelParams {
  role: ModelRole;
  org: ModelRouterOrg;
  requestedModel?: string;
}

export function selectModel(params: SelectModelParams): string {
  const { role, org, requestedModel } = params;

  if (requestedModel !== undefined) {
    if (!org.allowedModels.includes(requestedModel)) {
      throw new WChatError(
        "MODEL_NOT_ALLOWED",
        "orchestrator",
        false,
        `허용되지 않은 모델입니다: ${requestedModel}`,
      );
    }
    if (!planAllowsModel(org.plan, requestedModel)) {
      throw new WChatError(
        "MODEL_PLAN_CAP_EXCEEDED",
        "orchestrator",
        false,
        `현재 plan(${org.plan})에서 사용할 수 없는 모델입니다: ${requestedModel}`,
      );
    }
    return requestedModel;
  }

  const roleDefault = ROLE_DEFAULT_MODEL[role];
  if (planAllowsModel(org.plan, roleDefault)) {
    return roleDefault;
  }
  // plan 상한 초과 시 role 기본값을 경량 모델로 다운그레이드(무음 실패 대신 항상 반환 가능한 값 유지).
  return ROLE_DEFAULT_MODEL.memory;
}
