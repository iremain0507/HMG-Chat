// org-settings-schema.ts — org_settings.settings(JSONB) 검증/기본값 단일 출처.
//   rebuild_plan/21-LOOP-LESSONS.md L2: 손상/부재 시 반드시 이 DEFAULT 로 fail-soft(throw·1024 폴백 금지).
//   packages/interfaces·shared 미사용(frozen 회피) — 이 phase 전용 LOCAL Zod.
//   allowedModels·allowedTools·defaultTokenBudgetMicros 는 기존 organizations 컬럼을 재사용하므로 여기 없음.

import { z } from "zod";

export const OrgSettingsSchema = z.object({
  // Models & Generation
  maxTokens: z.number().int().min(1).max(128_000).optional(),
  temperature: z.number().min(0).max(1).optional(),
  topP: z.number().min(0).max(1).optional(), // 런타임 미배선(ISOLATE) — 저장/UI 만 in-scope
  defaultModel: z.string().min(1).max(200).optional(),
  systemPrompt: z.string().max(20_000).optional(),
  toolMaxTokens: z.number().int().min(1).max(128_000).optional(),

  // Knowledge/RAG
  ragTopK: z.number().int().min(1).max(100).optional(),
  ragRrfK: z.number().int().min(1).max(1000).optional(),
  ragChunkSizeTokens: z.number().int().min(50).max(8000).optional(),
  ragChunkOverlapTokens: z.number().int().min(0).max(4000).optional(),
  ragHybridEnabled: z.boolean().optional(),
  ragRelevanceThreshold: z.number().min(0).max(1).optional(),

  // Web Search
  webSearchEnabled: z.boolean().optional(),
  webSearchResultCount: z.number().int().min(1).max(20).optional(),

  // Connectors/MCP
  enableDirectConnections: z.boolean().optional(),

  // General/Branding
  instanceName: z.string().min(1).max(120).optional(),
  banner: z.string().max(2000).optional(),
  responseWatermark: z.string().max(200).optional(),

  // Users & Permissions (런타임 미배선 — env/ALLOWED_DOMAINS 결합, ISOLATE)
  defaultUserRole: z.enum(["member", "admin", "owner"]).optional(),
  enableSignup: z.boolean().optional(),

  // Quota/Limits
  maxUploadSizeMb: z.number().int().min(1).max(1000).optional(),
  maxUploadCount: z.number().int().min(1).max(100).optional(),
});

export type OrgSettingsPatch = z.infer<typeof OrgSettingsSchema>;
export type ResolvedOrgSettings = Required<OrgSettingsPatch>;

export const DEFAULT_ORG_SETTINGS: ResolvedOrgSettings = {
  maxTokens: 4096,
  temperature: 0.7,
  topP: 0.9,
  defaultModel: "claude-sonnet-5",
  systemPrompt: "",
  toolMaxTokens: 4096,

  ragTopK: 10,
  ragRrfK: 60,
  ragChunkSizeTokens: 800,
  ragChunkOverlapTokens: 100,
  ragHybridEnabled: true,
  ragRelevanceThreshold: 0.0,

  webSearchEnabled: false,
  webSearchResultCount: 3,

  enableDirectConnections: false,

  instanceName: "WChat",
  banner: "",
  responseWatermark: "",

  defaultUserRole: "member",
  enableSignup: false,

  maxUploadSizeMb: 25,
  maxUploadCount: 10,
};
