// db/org-settings-data-access.ts — org_settings(0017) 의 pg 구현체.
// 저장 모델 단일 출처: rebuild_plan/21-LOOP-LESSONS.md, lib/org-settings-schema.ts(검증/기본값).
// packages/interfaces·shared 미사용(frozen 회피) — 이 phase 전용 로컬 타입.
// dev/test DATABASE_URL role 은 superuser 라 RLS(0017)를 우회한다(auth-data-access.ts 와 동일 사유).
import { pgPool } from "./client.js";

export interface OrgSettingsRecord {
  orgId: string;
  settings: Record<string, unknown>;
  updatedBy: string | null;
  updatedAt: Date;
}

export interface OrgSettingsDataAccess {
  getByOrgId(orgId: string): Promise<OrgSettingsRecord | null>;
  upsert(
    orgId: string,
    patch: Record<string, unknown>,
    updatedBy: string | null,
  ): Promise<OrgSettingsRecord>;
}

function toOrgSettingsRecord(row: Record<string, unknown>): OrgSettingsRecord {
  return {
    orgId: row.org_id as string,
    settings: row.settings as Record<string, unknown>,
    updatedBy: (row.updated_by as string | null) ?? null,
    updatedAt: row.updated_at as Date,
  };
}

export function createPgOrgSettingsDataAccess(): OrgSettingsDataAccess {
  return {
    async getByOrgId(orgId) {
      const res = await pgPool.query(
        "SELECT * FROM org_settings WHERE org_id = $1",
        [orgId],
      );
      return res.rows[0] ? toOrgSettingsRecord(res.rows[0]) : null;
    },
    async upsert(orgId, patch, updatedBy) {
      const res = await pgPool.query(
        `INSERT INTO org_settings (org_id, settings, updated_by)
         VALUES ($1, $2::jsonb, $3)
         ON CONFLICT (org_id) DO UPDATE SET
           settings = org_settings.settings || EXCLUDED.settings,
           updated_by = EXCLUDED.updated_by
         RETURNING *`,
        [orgId, JSON.stringify(patch), updatedBy],
      );
      return toOrgSettingsRecord(res.rows[0]);
    },
  };
}
