import { describe, it, expect } from "vitest";
import { WChatError } from "@wchat/interfaces";
import { selectModel, ROLE_DEFAULT_MODEL } from "../model-router.js";

const standardOrg = {
  plan: "standard",
  allowedModels: ["claude-opus-4-7", "claude-sonnet-4-6", "gemini-2.5-pro"],
};

const proOrg = {
  plan: "pro",
  allowedModels: ["claude-opus-4-7", "claude-sonnet-4-6", "gemini-2.5-pro"],
};

describe("selectModel", () => {
  it("role='orchestrator' 기본값 = 상위 모델(claude-opus-4-7), plan 이 premium 허용 시 그대로", () => {
    expect(selectModel({ role: "orchestrator", org: proOrg })).toBe(
      ROLE_DEFAULT_MODEL.orchestrator,
    );
    expect(ROLE_DEFAULT_MODEL.orchestrator).toBe("claude-opus-4-7");
  });

  it("role='memory'/'titling' 기본값 = 경량 모델(claude-sonnet-4-6)", () => {
    expect(selectModel({ role: "memory", org: standardOrg })).toBe(
      "claude-sonnet-4-6",
    );
    expect(selectModel({ role: "titling", org: standardOrg })).toBe(
      "claude-sonnet-4-6",
    );
  });

  it("org.plan 이 premium 모델을 허용하지 않으면 orchestrator 기본값을 경량 모델로 다운그레이드", () => {
    expect(selectModel({ role: "orchestrator", org: standardOrg })).toBe(
      "claude-sonnet-4-6",
    );
  });

  it("requestedModel 이 org.allowedModels 에 없으면 MODEL_NOT_ALLOWED", () => {
    expect(() =>
      selectModel({
        role: "orchestrator",
        org: standardOrg,
        requestedModel: "gpt-5.1",
      }),
    ).toThrow(WChatError);
    try {
      selectModel({
        role: "orchestrator",
        org: standardOrg,
        requestedModel: "gpt-5.1",
      });
    } catch (err) {
      expect((err as WChatError).code).toBe("MODEL_NOT_ALLOWED");
    }
  });

  it("requestedModel 이 org.allowedModels 엔 있지만 plan 상한(premium)을 초과하면 MODEL_PLAN_CAP_EXCEEDED", () => {
    try {
      selectModel({
        role: "orchestrator",
        org: standardOrg,
        requestedModel: "claude-opus-4-7",
      });
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(WChatError);
      expect((err as WChatError).code).toBe("MODEL_PLAN_CAP_EXCEEDED");
    }
  });

  it("pro plan 은 premium requestedModel 허용", () => {
    expect(
      selectModel({
        role: "orchestrator",
        org: proOrg,
        requestedModel: "claude-opus-4-7",
      }),
    ).toBe("claude-opus-4-7");
  });
});
