// lib/settings-service.ts — org_settings 조회를 저장 partial + DEFAULT_ORG_SETTINGS deep-merge 로
//   resolve 하고 per-org TTL 캐시(기본 30s)를 두는 단일 출처.
//   rebuild_plan/21-LOOP-LESSONS.md L2/L5: 행 없음/JSON 손상/DB 오류는 절대 throw 하지 않고
//   logger.warn + DEFAULT_ORG_SETTINGS 로 fail-soft 한다(1024 등 구 하드코딩 폴백 금지).
import type { Logger } from "@wchat/interfaces";
import type { OrgSettingsDataAccess } from "../db/org-settings-data-access.js";
import {
  OrgSettingsSchema,
  DEFAULT_ORG_SETTINGS,
  type ResolvedOrgSettings,
} from "./org-settings-schema.js";

const DEFAULT_TTL_MS = 30_000;

export interface CreateSettingsServiceOptions {
  da: Pick<OrgSettingsDataAccess, "getByOrgId">;
  logger?: Logger;
  ttlMs?: number;
}

export interface SettingsService {
  resolve(orgId: string): Promise<ResolvedOrgSettings>;
  invalidate(orgId: string): void;
}

interface CacheEntry {
  value: ResolvedOrgSettings;
  expiresAt: number;
}

export function createSettingsService(
  options: CreateSettingsServiceOptions,
): SettingsService {
  const { da, logger, ttlMs = DEFAULT_TTL_MS } = options;
  const cache = new Map<string, CacheEntry>();

  async function fetchResolved(orgId: string): Promise<ResolvedOrgSettings> {
    let record;
    try {
      record = await da.getByOrgId(orgId);
    } catch (error) {
      logger?.warn({
        category: "db",
        msg: "org_settings 조회 실패 — DEFAULT_ORG_SETTINGS 로 폴백",
        orgId,
        context: { error: String(error) },
      });
      return DEFAULT_ORG_SETTINGS;
    }
    if (!record) return DEFAULT_ORG_SETTINGS;

    const parsed = OrgSettingsSchema.safeParse(record.settings);
    if (!parsed.success) {
      logger?.warn({
        category: "db",
        msg: "org_settings.settings 검증 실패(손상) — DEFAULT_ORG_SETTINGS 로 폴백",
        orgId,
        context: { issues: parsed.error.issues },
      });
      return DEFAULT_ORG_SETTINGS;
    }
    // parsed.data 의 optional 필드는 값 타입에도 `| undefined` 가 섞여 있어(zod .optional())
    // 스프레드 결과 타입에 undefined 가 새어나오지만, JSON(JSONB)엔 literal undefined 값이
    // 존재할 수 없으므로(키가 없거나 실값) 런타임엔 DEFAULT_ORG_SETTINGS 로 항상 채워진다.
    return { ...DEFAULT_ORG_SETTINGS, ...parsed.data } as ResolvedOrgSettings;
  }

  async function resolve(orgId: string): Promise<ResolvedOrgSettings> {
    const cached = cache.get(orgId);
    if (cached && cached.expiresAt > Date.now()) return cached.value;

    const value = await fetchResolved(orgId);
    cache.set(orgId, { value, expiresAt: Date.now() + ttlMs });
    return value;
  }

  function invalidate(orgId: string): void {
    cache.delete(orgId);
  }

  return { resolve, invalidate };
}
