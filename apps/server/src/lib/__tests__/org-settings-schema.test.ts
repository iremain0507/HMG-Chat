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
    expect(settings.webSearchProvider).toBe("dev-stub");
    expect(settings.webSearchEndpoint).toBe("");
    expect(settings.webSearchApiKeyRef).toBe("");
    expect(settings.enableDirectConnections).toBe(false);
    expect(settings.instanceName).toBe("WChat");
    expect(settings.banner).toEqual([]);
    expect(settings.responseWatermark).toBe("");
    expect(settings.defaultUserRole).toBe("member");
    // P15-T1-01: 현행 "허용 도메인이면 가입 가능" 동작을 미조정 org 에서 보존하기 위해 true.
    expect(settings.enableSignup).toBe(true);
    expect(settings.maxUploadSizeMb).toBe(25);
    expect(settings.maxUploadCount).toBe(10);
    expect(settings.allowedUploadExtensions).toEqual(
      expect.arrayContaining(["pdf", "txt", "png"]),
    );
  });

  it("allowedUploadExtensions 는 문자열 배열만 허용한다", () => {
    const valid = OrgSettingsSchema.safeParse({
      allowedUploadExtensions: ["pdf", "txt"],
    });
    expect(valid.success).toBe(true);
    if (valid.success) {
      expect(valid.data.allowedUploadExtensions).toEqual(["pdf", "txt"]);
    }

    const invalid = OrgSettingsSchema.safeParse({
      allowedUploadExtensions: [123],
    });
    expect(invalid.success).toBe(false);
  });

  it("webSearchProvider 는 dev-stub/tavily 만 허용하고 그 외 값은 거부한다", () => {
    const valid = OrgSettingsSchema.safeParse({
      webSearchProvider: "tavily",
      webSearchEndpoint: "https://tavily.internal",
      webSearchApiKeyRef: "TAVILY_API_KEY",
    });
    expect(valid.success).toBe(true);
    if (valid.success) {
      expect(valid.data.webSearchProvider).toBe("tavily");
      expect(valid.data.webSearchEndpoint).toBe("https://tavily.internal");
      expect(valid.data.webSearchApiKeyRef).toBe("TAVILY_API_KEY");
    }

    const invalid = OrgSettingsSchema.safeParse({
      webSearchProvider: "google",
    });
    expect(invalid.success).toBe(false);
  });

  it("DEFAULT_ORG_SETTINGS 는 OrgSettingsSchema 검증을 통과한다", () => {
    const result = OrgSettingsSchema.safeParse(DEFAULT_ORG_SETTINGS);
    expect(result.success).toBe(true);
  });

  describe("banner (typed)", () => {
    it("typed 배너 목록을 파싱한다(type/title/content/dismissible)", () => {
      const result = OrgSettingsSchema.safeParse({
        banner: [
          {
            type: "warning",
            title: "점검 안내",
            content: "오늘 밤 시스템 점검이 있습니다.",
            dismissible: false,
          },
        ],
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.banner).toEqual([
          {
            type: "warning",
            title: "점검 안내",
            content: "오늘 밤 시스템 점검이 있습니다.",
            dismissible: false,
          },
        ]);
      }
    });

    it("불량 배너(잘못된 type, content 누락)는 거부한다", () => {
      const badType = OrgSettingsSchema.safeParse({
        banner: [{ type: "danger", content: "x" }],
      });
      expect(badType.success).toBe(false);

      const missingContent = OrgSettingsSchema.safeParse({
        banner: [{ type: "info" }],
      });
      expect(missingContent.success).toBe(false);
    });

    it("배너 title/dismissible 은 optional 이며 기본값이 채워진다", () => {
      const result = OrgSettingsSchema.safeParse({
        banner: [{ type: "info", content: "안내문" }],
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.banner).toEqual([
          { type: "info", content: "안내문", dismissible: true },
        ]);
      }
    });

    it("기존 문자열 banner 값은 typed 배너 1건으로 폴백 변환한다(L2 하위호환)", () => {
      const result = OrgSettingsSchema.safeParse({
        banner: "레거시 공지 문자열",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.banner).toEqual([
          { type: "info", content: "레거시 공지 문자열", dismissible: true },
        ]);
      }
    });

    it("기존 빈 문자열 banner 값은 빈 배열로 폴백 변환한다", () => {
      const result = OrgSettingsSchema.safeParse({ banner: "" });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.banner).toEqual([]);
      }
    });

    it("DEFAULT_ORG_SETTINGS.banner 는 빈 배열이다", () => {
      expect(DEFAULT_ORG_SETTINGS.banner).toEqual([]);
    });
  });
});
