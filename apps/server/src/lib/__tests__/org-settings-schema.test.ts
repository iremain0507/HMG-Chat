import { describe, it, expect } from "vitest";
import {
  OrgSettingsSchema,
  DEFAULT_ORG_SETTINGS,
  type ResolvedOrgSettings,
} from "../org-settings-schema.js";

describe("OrgSettingsSchema", () => {
  it("유효한 partial patch 를 파싱한다", () => {
    const result = OrgSettingsSchema.safeParse({
      maxTokens: 8192,
      temperature: 0.5,
      instanceName: "WIA Chat",
      ragTopK: 12,
      webSearchEnabled: true,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.maxTokens).toBe(8192);
      expect(result.data.instanceName).toBe("WIA Chat");
    }
  });

  it("빈 객체(모든 키 optional)도 유효하다", () => {
    const result = OrgSettingsSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("범위 밖 maxTokens 는 issues 로 거부한다", () => {
    const tooLow = OrgSettingsSchema.safeParse({ maxTokens: 0 });
    expect(tooLow.success).toBe(false);
    if (!tooLow.success) {
      expect(tooLow.error.issues.some((i) => i.path[0] === "maxTokens")).toBe(
        true,
      );
    }

    const tooHigh = OrgSettingsSchema.safeParse({ maxTokens: 999_999 });
    expect(tooHigh.success).toBe(false);
  });

  it("범위 밖 temperature 는 issues 로 거부한다", () => {
    const negative = OrgSettingsSchema.safeParse({ temperature: -0.1 });
    expect(negative.success).toBe(false);
    if (!negative.success) {
      expect(
        negative.error.issues.some((i) => i.path[0] === "temperature"),
      ).toBe(true);
    }

    const tooHigh = OrgSettingsSchema.safeParse({ temperature: 1.5 });
    expect(tooHigh.success).toBe(false);
  });

  it("알 수 없는 키가 섞이면 파싱은 성공하되 정의된 키만 결과에 반영한다", () => {
    const result = OrgSettingsSchema.safeParse({
      maxTokens: 2048,
      unknownKey: "ignored",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect((result.data as Record<string, unknown>).unknownKey).toBe(
        undefined,
      );
    }
  });

  it("DEFAULT_ORG_SETTINGS 는 모든 필드를 채운 ResolvedOrgSettings 값이다", () => {
    const settings: ResolvedOrgSettings = DEFAULT_ORG_SETTINGS;
    expect(settings.maxTokens).toBe(4096);
    expect(settings.temperature).toBe(0.7);
    expect(settings.topP).toBe(0.9);
    expect(settings.defaultModel).toEqual(expect.any(String));
    expect(settings.systemPrompt).toBe("");
    expect(settings.toolMaxTokens).toBe(4096);
    expect(settings.ragTopK).toBe(10);
    expect(settings.ragRrfK).toBe(60);
    expect(settings.ragChunkSizeTokens).toBe(800);
    expect(settings.ragChunkOverlapTokens).toBe(100);
    expect(settings.ragHybridEnabled).toBe(true);
    expect(settings.ragRelevanceThreshold).toBe(0.0);
    expect(settings.webSearchEnabled).toBe(false);
    expect(settings.webSearchResultCount).toBe(3);
    expect(settings.enableDirectConnections).toBe(false);
    expect(settings.instanceName).toBe("WChat");
    expect(settings.banner).toBe("");
    expect(settings.responseWatermark).toBe("");
    expect(settings.defaultUserRole).toBe("member");
    expect(settings.enableSignup).toBe(false);
    expect(settings.maxUploadSizeMb).toBe(25);
    expect(settings.maxUploadCount).toBe(10);
  });

  it("DEFAULT_ORG_SETTINGS 는 OrgSettingsSchema 검증을 통과한다", () => {
    const result = OrgSettingsSchema.safeParse(DEFAULT_ORG_SETTINGS);
    expect(result.success).toBe(true);
  });
});
