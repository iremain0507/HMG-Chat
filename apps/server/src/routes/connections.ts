// routes/connections.ts — 16-API-CONTRACT.md § Connections 단일 출처 (P22-T6-14, 계약 승인 C6).
// Open WebUI 의 Admin > Settings > Connections(외부 OpenAI 호환 엔드포인트 base URL + 키 등록,
// enable 토글, verify 버튼) 파리티.
//
// 보안 규약 3가지:
//  1) 평문 API 키는 요청 본문으로만 들어오고 응답에는 절대 나가지 않는다 — 표시는 keyPrefix 뿐.
//     (DTO 자체에 키 필드가 없으므로 실수로 흘릴 경로가 구조적으로 막혀 있다.)
//  2) base URL 은 등록 시점에 SSRF validator(mcp/url-validator.ts, 12-OPS-SECURITY 부록 B)를
//     통과해야 한다 — 사내망/메타데이터 엔드포인트로 키가 새어나가는 것을 막는다. verify 프로브
//     직전에도 재검증한다(등록 후 DNS 가 사설 IP 로 바뀌는 rebinding 방지, T1-12 와 동일 패턴).
//  3) org 경계는 이 라우트가 application 레벨에서 강제한다(RLS 는 superuser role 이 우회) —
//     남의 org 것은 403 이 아니라 404(existence-leak 방지, routes/agents.ts 미러).
import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import type { ProviderConnection } from "@wchat/interfaces";
import type { AuthedVariables } from "../middleware/auth-middleware.js";
import type { ProviderConnectionDataAccess } from "../db/provider-connection-data-access.js";
import {
  validateMcpUrl,
  type McpUrlValidatorOptions,
} from "../mcp/url-validator.js";

export interface ProviderProbeResult {
  ok: boolean;
  models?: string[];
  message?: string;
}

/** base URL 로의 경량 프로브(기본 구현은 GET {baseUrl}/models). */
export type ProviderProbe = (
  baseUrl: string,
  apiKey: string,
) => Promise<ProviderProbeResult>;

function errorJson(code: string, message: string) {
  return {
    error: { code, category: "http" as const, message, retryable: false },
  };
}

function toDto(conn: ProviderConnection) {
  return {
    id: conn.id,
    orgId: conn.orgId,
    name: conn.name,
    kind: conn.kind,
    baseUrl: conn.baseUrl,
    keyPrefix: conn.keyPrefix, // 마스킹된 앞자리만 — 평문 키는 계약상 응답 금지
    enabled: conn.enabled,
    verifiedAt: conn.verifiedAt ? conn.verifiedAt.toISOString() : null,
    models: conn.models,
    createdBy: conn.createdBy,
    createdAt: conn.createdAt.toISOString(),
    updatedAt: conn.updatedAt.toISOString(),
  };
}

function stringArray(v: unknown): string[] | undefined {
  if (v === undefined) return undefined;
  if (!Array.isArray(v) || v.some((x) => typeof x !== "string"))
    return undefined;
  return v as string[];
}

/**
 * 기본 프로브: OpenAI 호환 규약의 GET {baseUrl}/models 를 Bearer 로 호출한다.
 * 실패(네트워크/4xx/5xx)는 throw 가 아니라 ok:false 로 — verify 는 "검증 결과 보고"이지
 * 서버 오류가 아니기 때문(계약상 200 + verified:false).
 */
export function createDefaultProviderProbe(deps?: {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): ProviderProbe {
  const fetchImpl = deps?.fetchImpl ?? fetch;
  const timeoutMs = deps?.timeoutMs ?? 8000;
  return async (baseUrl, apiKey) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchImpl(`${baseUrl.replace(/\/+$/, "")}/models`, {
        headers: { authorization: `Bearer ${apiKey}` },
        signal: controller.signal,
      });
      if (!res.ok) {
        return { ok: false, message: `${res.status} ${res.statusText}` };
      }
      const body = (await res.json().catch(() => null)) as {
        data?: Array<{ id?: unknown }>;
      } | null;
      const models = (body?.data ?? [])
        .map((m) => m?.id)
        .filter((id): id is string => typeof id === "string");
      return { ok: true, models };
    } catch (err) {
      // 키가 메시지에 섞여 나갈 여지를 주지 않으려고 err.message 를 그대로 쓰지 않는다.
      return {
        ok: false,
        message:
          err instanceof Error && err.name === "AbortError"
            ? "프로브 시간 초과"
            : "엔드포인트에 연결할 수 없습니다.",
      };
    } finally {
      clearTimeout(timer);
    }
  };
}

export function createConnectionRoutes(deps: {
  da: ProviderConnectionDataAccess;
  probe: ProviderProbe;
  urlValidatorOptions?: McpUrlValidatorOptions;
}): Hono<{ Variables: AuthedVariables }> {
  const app = new Hono<{ Variables: AuthedVariables }>();

  function actorOf(c: { get(key: "auth"): AuthedVariables["auth"] }) {
    const auth = c.get("auth");
    return { userId: auth.sub, orgId: auth.org };
  }

  /** 같은 org 것만 실재로 취급 — 아니면 null(=404). */
  async function ownedByActor(
    actor: { orgId: string },
    id: string,
  ): Promise<ProviderConnection | null> {
    const found = await deps.da.providerConnections.byId(id);
    if (!found || found.orgId !== actor.orgId) return null;
    return found;
  }

  /** SSRF 검증 통과 시 null, 실패 시 사용자에게 보여줄 사유 문자열. */
  async function ssrfReject(baseUrl: string): Promise<string | null> {
    try {
      await validateMcpUrl(baseUrl, deps.urlValidatorOptions ?? {});
      return null;
    } catch (err) {
      return err instanceof Error
        ? err.message
        : "허용되지 않은 base URL 입니다.";
    }
  }

  app.post("/", async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body.name !== "string" || body.name.trim() === "") {
      return c.json(errorJson("INVALID_INPUT", "name 이 필요합니다."), 400);
    }
    if (typeof body.baseUrl !== "string" || body.baseUrl.trim() === "") {
      return c.json(errorJson("INVALID_INPUT", "baseUrl 이 필요합니다."), 400);
    }
    if (typeof body.apiKey !== "string" || body.apiKey.trim() === "") {
      return c.json(errorJson("INVALID_INPUT", "apiKey 가 필요합니다."), 400);
    }
    const models = stringArray(body.models);
    if (body.models !== undefined && models === undefined) {
      return c.json(
        errorJson("INVALID_INPUT", "models 는 문자열 배열이어야 합니다."),
        400,
      );
    }
    const baseUrl = body.baseUrl.trim();
    const rejected = await ssrfReject(baseUrl);
    if (rejected) {
      return c.json(errorJson("INVALID_INPUT", rejected), 400);
    }

    const actor = actorOf(c);
    const name = body.name.trim();
    // UNIQUE (org_id, name) 를 DB 오류(500) 대신 계약상 409 로 선제 매핑(agents.ts 미러).
    const existing = await deps.da.providerConnections.list({
      orgId: actor.orgId,
    });
    if (existing.items.some((row) => row.name === name)) {
      return c.json(
        errorJson("CONFLICT", "같은 이름의 연결이 이미 있습니다."),
        409,
      );
    }

    const created = await deps.da.providerConnections.insertWithSecret(
      {
        orgId: actor.orgId,
        name,
        kind: "openai-compatible",
        baseUrl,
        enabled: body.enabled === undefined ? true : body.enabled === true,
        models: models ?? [],
        createdBy: actor.userId,
      },
      body.apiKey,
    );
    return c.json(
      { data: toDto(created), meta: { requestId: randomUUID() } },
      201,
    );
  });

  app.get("/", async (c) => {
    const actor = actorOf(c);
    const page = await deps.da.providerConnections.list({ orgId: actor.orgId });
    return c.json({
      data: page.items.map(toDto),
      meta: { requestId: randomUUID() },
    });
  });

  app.get("/:id", async (c) => {
    const found = await ownedByActor(actorOf(c), c.req.param("id"));
    if (!found) {
      return c.json(errorJson("NOT_FOUND", "연결을 찾을 수 없습니다."), 404);
    }
    return c.json({ data: toDto(found), meta: { requestId: randomUUID() } });
  });

  app.patch("/:id", async (c) => {
    const actor = actorOf(c);
    const existing = await ownedByActor(actor, c.req.param("id"));
    if (!existing) {
      return c.json(errorJson("NOT_FOUND", "연결을 찾을 수 없습니다."), 404);
    }
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return c.json(errorJson("INVALID_INPUT", "본문이 필요합니다."), 400);
    }

    const patch: Partial<ProviderConnection> = {};
    if (typeof body.name === "string" && body.name.trim() !== "") {
      patch.name = body.name.trim();
    }
    if (typeof body.baseUrl === "string" && body.baseUrl.trim() !== "") {
      const rejected = await ssrfReject(body.baseUrl.trim());
      if (rejected) return c.json(errorJson("INVALID_INPUT", rejected), 400);
      patch.baseUrl = body.baseUrl.trim();
    }
    if (typeof body.enabled === "boolean") patch.enabled = body.enabled;
    const models = stringArray(body.models);
    if (body.models !== undefined && models === undefined) {
      return c.json(
        errorJson("INVALID_INPUT", "models 는 문자열 배열이어야 합니다."),
        400,
      );
    }
    if (models !== undefined) patch.models = models;

    if (patch.name !== undefined && patch.name !== existing.name) {
      const page = await deps.da.providerConnections.list({
        orgId: actor.orgId,
      });
      if (
        page.items.some((r) => r.id !== existing.id && r.name === patch.name)
      ) {
        return c.json(
          errorJson("CONFLICT", "같은 이름의 연결이 이미 있습니다."),
          409,
        );
      }
    }

    // 키 교체(rotation)는 별도 경로 — DTO 밖 비밀이라 update() 가 아니라 updateSecret().
    if (typeof body.apiKey === "string" && body.apiKey.trim() !== "") {
      await deps.da.providerConnections.updateSecret(existing.id, body.apiKey);
    }
    const updated = await deps.da.providerConnections.update(
      existing.id,
      patch,
    );
    return c.json({ data: toDto(updated), meta: { requestId: randomUUID() } });
  });

  app.post("/:id/verify", async (c) => {
    const actor = actorOf(c);
    const existing = await ownedByActor(actor, c.req.param("id"));
    if (!existing) {
      return c.json(errorJson("NOT_FOUND", "연결을 찾을 수 없습니다."), 404);
    }
    // 등록 후 DNS 가 사설 IP 로 바뀌었을 수 있으므로 프로브 직전에 재검증한다.
    const rejected = await ssrfReject(existing.baseUrl);
    if (rejected) {
      return c.json(errorJson("INVALID_INPUT", rejected), 400);
    }
    const apiKey = await deps.da.providerConnections.secretById(existing.id);
    if (apiKey === null) {
      return c.json(
        errorJson("NOT_FOUND", "연결의 API 키를 읽을 수 없습니다."),
        404,
      );
    }

    const result = await deps.probe(existing.baseUrl, apiKey);
    const verifiedAt = result.ok ? new Date() : null;
    await deps.da.providerConnections.markVerified(existing.id, verifiedAt);
    // 프로브가 모델 목록을 돌려주면 그대로 반영 — admin 이 손으로 적을 필요가 없다(OWUI 동작).
    if (result.ok && result.models && result.models.length > 0) {
      await deps.da.providerConnections.update(existing.id, {
        models: result.models,
      });
    }
    const fresh = await deps.da.providerConnections.byId(existing.id);
    return c.json({
      data: {
        verified: result.ok,
        // message 는 프로브가 만든 요약 문자열뿐 — 키를 포함하지 않는다.
        ...(result.message ? { message: result.message } : {}),
        connection: toDto(fresh ?? existing),
      },
      meta: { requestId: randomUUID() },
    });
  });

  app.delete("/:id", async (c) => {
    const existing = await ownedByActor(actorOf(c), c.req.param("id"));
    if (!existing) {
      return c.json(errorJson("NOT_FOUND", "연결을 찾을 수 없습니다."), 404);
    }
    await deps.da.providerConnections.delete(existing.id);
    return c.body(null, 204);
  });

  return app;
}
