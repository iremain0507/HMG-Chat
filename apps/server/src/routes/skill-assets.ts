// routes/skill-assets.ts — 16-API-CONTRACT.md § 11 GET /skill-assets/:skillId/:filename.
// skill_assets_read_anyone RLS(0009) 는 공개 읽기 — 인증된 사용자면 소유/scope 무관하게 조회
// 가능(실제 노출 제어는 SkillRegistry scope 필터가 이미 목록 단계에서 수행, mcp-servers.ts 와
// 달리 소유자 기반 existence-leak 방지 로직 불필요).
import { Hono } from "hono";
import type { DataAccess } from "@wchat/interfaces";
import type { AuthedVariables } from "../middleware/auth-middleware.js";
import type { ObjectStore } from "../lib/object-store.js";

function errorJson(code: string, message: string) {
  return {
    error: { code, category: "http" as const, message, retryable: false },
  };
}

export function createSkillAssetRoutes(deps: {
  da: Pick<DataAccess, "skillAssets">;
  objectStore: ObjectStore;
}): Hono<{ Variables: AuthedVariables }> {
  const app = new Hono<{ Variables: AuthedVariables }>();

  app.get("/:skillId/:filename", async (c) => {
    const asset = await deps.da.skillAssets.byKey(
      c.req.param("skillId"),
      c.req.param("filename"),
    );
    if (!asset) {
      return c.json(errorJson("NOT_FOUND", "asset을 찾을 수 없습니다."), 404);
    }
    const data = await deps.objectStore.get(asset.s3Key);
    return c.body(new Uint8Array(data), 200, {
      "Content-Type": asset.contentType ?? "application/octet-stream",
    });
  });

  return app;
}
