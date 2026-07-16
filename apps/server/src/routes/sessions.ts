// routes/sessions.ts — 16-API-CONTRACT.md § Sessions(GET /, GET/PATCH/DELETE /:id,
// GET /:id/messages) + DELETE /sessions/:id/active-run, POST /sessions/:id/messages/hitl,
// GET /sessions/:id/hitl/pending 단일 출처.
import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import type { Message } from "@wchat/interfaces";
import { abortRun } from "../orchestrator/run-registry.js";
import { resolveHitl, listPendingHitl } from "../tools/hitl-manager.js";
import { createPgArtifactDataAccess } from "../db/artifact-data-access.js";
import type { ArtifactDataAccess } from "../db/artifact-service.js";
import {
  createPgSessionDataAccess,
  type SessionWithPin,
} from "../db/session-data-access.js";
import { createPgMessageDataAccess } from "../db/message-data-access.js";
import type { AuthedVariables } from "../middleware/auth-middleware.js";

function errorJson(code: string, message: string) {
  return {
    error: { code, category: "http" as const, message, retryable: false },
  };
}

function parseLimit(
  raw: string | undefined,
  fallback: number,
  max: number,
): number {
  const n = raw ? Number(raw) : NaN;
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(n, max);
}

// P17-T1-02 — GET /(세션 목록), GET /:id/messages(히스토리) 가 실제 쓰는 부분만 좁힌 포트
// (routes/messages.ts MessagesPort 와 동일 패턴). SessionRepo/MessageRepo(14-INTERFACES)
// 전체 구현(lock 등 미사용 메서드)까지 강제하지 않는다.
export interface SessionsPort {
  list(
    filter: { userId: string },
    pagination?: { cursor?: string; limit?: number },
  ): Promise<{ items: SessionWithPin[]; nextCursor?: string }>;
  byId(id: string): Promise<SessionWithPin | null>;
  // P17-T1-03(TS-09) — ownership 이 쿼리 조건에 직접 포함(WHERE id=.. AND user_id=..)돼 있어
  // 별도 조회 없이 원자적으로 cross-org/타 사용자 변경을 차단한다.
  updateForOwner(
    userId: string,
    id: string,
    data: { title?: string | null; archived?: boolean },
  ): Promise<SessionWithPin | null>;
  deleteForOwner(userId: string, id: string): Promise<boolean>;
  // P19-T1-02 — 핀 토글(같은 ownership-in-query 원자성 패턴).
  togglePinForOwner(userId: string, id: string): Promise<SessionWithPin | null>;
}

export interface SessionMessagesPort {
  list(
    filter: { sessionId: string },
    pagination?: { cursor?: string; limit?: number },
  ): Promise<{ items: Message[]; nextCursor?: string }>;
}

export interface SessionRoutesDeps {
  artifactDa?: ArtifactDataAccess;
  sessions?: SessionsPort;
  sessionMessages?: SessionMessagesPort;
}

export function createSessionRoutes(
  deps: SessionRoutesDeps = {},
): Hono<{ Variables: AuthedVariables }> {
  const artifactDa = deps.artifactDa ?? createPgArtifactDataAccess();
  const sessions = deps.sessions ?? createPgSessionDataAccess();
  const sessionMessages = deps.sessionMessages ?? createPgMessageDataAccess();
  const app = new Hono<{ Variables: AuthedVariables }>();

  // P17-T1-02(TS-08/10) — 내 세션 목록(최신순). userId 는 auth 에서만 파생(body/query 미수신
  // → cross-org/타 사용자 열람 원천 차단, projects.ts actorOf 와 동일 패턴).
  app.get("/", async (c) => {
    const auth = c.get("auth");
    const cursor = c.req.query("cursor");
    const limit = parseLimit(c.req.query("limit"), 20, 100);
    const page = await sessions.list(
      { userId: auth.sub },
      { ...(cursor ? { cursor } : {}), limit },
    );
    return c.json({
      data: page.items.map((s) => ({
        id: s.id,
        title: s.title,
        lastMessageAt: s.lastMessageAt ? s.lastMessageAt.toISOString() : null,
        projectId: s.projectId,
        archived: s.archivedAt !== null,
        pinned: s.pinnedAt !== null,
      })),
      meta: {
        requestId: randomUUID(),
        ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
      },
    });
  });

  // P19-T1-02 — 핀 토글. ownership 은 togglePinForOwner 쿼리에 내장(TS-09 원자성 패턴,
  // updateForOwner/deleteForOwner 와 동일) — 타 사용자/조직 세션은 404(existence-leak 방지).
  app.patch("/:id/pin", async (c) => {
    const auth = c.get("auth");
    const sessionId = c.req.param("id");
    const updated = await sessions.togglePinForOwner(auth.sub, sessionId);
    if (!updated) {
      return c.json(errorJson("NOT_FOUND", "세션을 찾을 수 없습니다."), 404);
    }
    return c.json({
      data: { id: updated.id, pinned: updated.pinnedAt !== null },
      meta: { requestId: randomUUID() },
    });
  });

  // P17-T1-02(TS-08/10) — 세션 히스토리. 타 사용자 세션은 404(existence-leak 방지,
  // 16-API-CONTRACT § GET /sessions/:id 와 동일 정책).
  app.get("/:id/messages", async (c) => {
    const auth = c.get("auth");
    const sessionId = c.req.param("id");
    const session = await sessions.byId(sessionId);
    if (!session || session.userId !== auth.sub) {
      return c.json(errorJson("NOT_FOUND", "세션을 찾을 수 없습니다."), 404);
    }
    const cursor = c.req.query("cursor");
    const limit = parseLimit(c.req.query("limit"), 50, 100);
    const page = await sessionMessages.list(
      { sessionId },
      { ...(cursor ? { cursor } : {}), limit },
    );
    return c.json({
      data: page.items.map((m) => ({
        id: m.id,
        sessionId: m.sessionId,
        role: m.role,
        content: m.content,
        parentMessageId: m.parentMessageId,
        createdAt: m.createdAt.toISOString(),
        tokensIn: m.tokensIn,
        tokensOut: m.tokensOut,
        costMicros: m.costMicros,
      })),
      meta: {
        requestId: randomUUID(),
        ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
      },
    });
  });

  // P17-T1-03(TS-09) — rename(title)/archived. pin 토글은 별도 PATCH /:id/pin(P19-T1-02) 참조
  // (기존 lib/pinnedSessions.ts localStorage-only 를 서버 영속으로 승격).
  app.patch("/:id", async (c) => {
    const auth = c.get("auth");
    const sessionId = c.req.param("id");
    const body = await c.req
      .json<{ title?: string; archived?: boolean }>()
      .catch(() => ({}) as { title?: string; archived?: boolean });
    if (body.title === undefined && body.archived === undefined) {
      return c.json(
        errorJson("INVALID_INPUT", "title 또는 archived 가 필요합니다."),
        400,
      );
    }
    const updated = await sessions.updateForOwner(auth.sub, sessionId, {
      ...(body.title !== undefined ? { title: body.title } : {}),
      ...(body.archived !== undefined ? { archived: body.archived } : {}),
    });
    if (!updated) {
      return c.json(errorJson("NOT_FOUND", "세션을 찾을 수 없습니다."), 404);
    }
    return c.json({
      data: {
        id: updated.id,
        title: updated.title,
        lastMessageAt: updated.lastMessageAt
          ? updated.lastMessageAt.toISOString()
          : null,
        projectId: updated.projectId,
        archived: updated.archivedAt !== null,
      },
      meta: { requestId: randomUUID() },
    });
  });

  // P17-T1-03(TS-09) — delete. messages/sessions_active_runs 는 FK ON DELETE CASCADE
  // (0002/0003 migrations), artifacts.session_id 는 ON DELETE SET NULL(보존) — DB 레벨에서
  // 이미 처리되므로 sessions row 삭제만으로 계약의 cascade 부수효과가 성립한다.
  app.delete("/:id", async (c) => {
    const auth = c.get("auth");
    const sessionId = c.req.param("id");
    const deleted = await sessions.deleteForOwner(auth.sub, sessionId);
    if (!deleted) {
      return c.json(errorJson("NOT_FOUND", "세션을 찾을 수 없습니다."), 404);
    }
    return c.body(null, 204);
  });

  app.delete("/:id/active-run", (c) => {
    const sessionId = c.req.param("id");
    const cancelled = abortRun(sessionId);
    return c.json({ data: { cancelled }, meta: { requestId: randomUUID() } });
  });

  // 14-INTERFACES.md § 9 HitlBridge — client 가 hitl_request 에 대한 사용자 응답을 전달.
  app.post("/:id/messages/hitl", async (c) => {
    const sessionId = c.req.param("id");
    const body = await c.req
      .json<{
        toolCallId?: string;
        decision?: "approved" | "denied";
        modifiedArgs?: Record<string, unknown>;
        reason?: string;
      }>()
      .catch(() => ({}) as { toolCallId?: string; decision?: never });
    if (
      !body.toolCallId ||
      (body.decision !== "approved" && body.decision !== "denied")
    ) {
      return c.json(
        errorJson("INVALID_INPUT", "toolCallId/decision 이 필요합니다."),
        400,
      );
    }

    const result = resolveHitl(sessionId, body.toolCallId, {
      decision: body.decision,
      ...(body.modifiedArgs ? { modifiedArgs: body.modifiedArgs } : {}),
      ...(body.reason ? { reason: body.reason } : {}),
    });

    if (result === "not_found") {
      return c.json(
        errorJson("NOT_FOUND", "해당 toolCallId 의 HITL 요청이 없습니다."),
        404,
      );
    }
    if (result === "gone") {
      return c.json(errorJson("GONE", "이미 처리된 HITL 요청입니다."), 410);
    }
    return c.json({
      data: { delivered: true },
      meta: { requestId: randomUUID() },
    });
  });

  app.get("/:id/hitl/pending", (c) => {
    const sessionId = c.req.param("id");
    return c.json({
      data: listPendingHitl(sessionId),
      meta: { requestId: randomUUID() },
    });
  });

  // P10-T2-04 — artifact-create 툴이 emit 한 artifact_created 가 세션에 실제 반영됐는지
  // 클라이언트가 확인/재조회할 수 있는 목록 엔드포인트.
  app.get("/:id/artifacts", async (c) => {
    const sessionId = c.req.param("id");
    const page = await artifactDa.artifacts.list({ sessionId }, { limit: 50 });
    return c.json({
      data: page.items.map((artifact) => ({
        id: artifact.id,
        sessionId: artifact.sessionId,
        type: artifact.type,
        filename: artifact.filename,
        sizeBytes: artifact.sizeBytes,
        storageKind: artifact.storageKind,
        createdAt: artifact.createdAt.toISOString(),
      })),
      meta: { requestId: randomUUID() },
    });
  });

  return app;
}
