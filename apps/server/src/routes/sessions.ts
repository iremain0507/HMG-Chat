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
import {
  createPgSessionFolderDataAccess,
  type SessionFolderDataAccess,
} from "../db/session-folder-data-access.js";
import {
  createPgSessionTagDataAccess,
  type SessionTagDataAccess,
} from "../db/session-tag-data-access.js";
import {
  createPgMessageFeedbackDataAccess,
  type MessageFeedbackDataAccess,
} from "../db/message-feedback-data-access.js";
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
    // P19-T1-04 — tag 필터(GET /?tag=).
    // P19-T1-05 — archived 필터(GET /?archived=true — 미지정 시 기본값대로 아카이브 제외).
    filter: { userId: string; tag?: string; archived?: boolean },
    pagination?: { cursor?: string; limit?: number },
  ): Promise<{ items: SessionWithPin[]; nextCursor?: string }>;
  byId(id: string): Promise<SessionWithPin | null>;
  // P22-T1-04 — 명시적 세션 생성(POST /sessions). userId 는 auth 파생만 신뢰(body 미신뢰).
  create(data: {
    userId: string;
    title?: string | null;
    projectId?: string | null;
  }): Promise<SessionWithPin>;
  // P17-T1-03(TS-09) — ownership 이 쿼리 조건에 직접 포함(WHERE id=.. AND user_id=..)돼 있어
  // 별도 조회 없이 원자적으로 cross-org/타 사용자 변경을 차단한다.
  updateForOwner(
    userId: string,
    id: string,
    data: {
      title?: string | null;
      archived?: boolean;
      folderId?: string | null;
    },
  ): Promise<SessionWithPin | null>;
  deleteForOwner(userId: string, id: string): Promise<boolean>;
  // P19-T1-02 — 핀 토글(같은 ownership-in-query 원자성 패턴).
  togglePinForOwner(userId: string, id: string): Promise<SessionWithPin | null>;
  // P19-T1-05 — 아카이브 토글(togglePinForOwner 와 동일 패턴).
  toggleArchiveForOwner(
    userId: string,
    id: string,
  ): Promise<SessionWithPin | null>;
  // P19-T1-06 — 제목+메시지 내용 검색(GET /search?q=).
  search(
    userId: string,
    query: string,
    limit?: number,
  ): Promise<SessionWithPin[]>;
}

export interface SessionMessagesPort {
  list(
    filter: { sessionId: string },
    pagination?: { cursor?: string; limit?: number },
  ): Promise<{ items: Message[]; nextCursor?: string }>;
  // P19-T1-07 — 메시지 평가 전 ownership 검증(message.sessionId === 요청 sessionId)에 사용.
  byId(id: string): Promise<Message | null>;
  // P20-T1-05 — 개별 메시지(및 하위 서브트리) 삭제. createPgMessageDataAccess()(MessageRepo,
  // 14-INTERFACES Repo<T,F> 상속)가 이미 delete(id) 를 구현하고 있어 포트만 넓힌다.
  delete(id: string): Promise<void>;
  // P22-T6-01 — 대화 복제(POST /:id/clone) 시 원본 메시지를 새 세션에 재삽입. MessageRepo.insert
  // (Partial<Message>)가 이미 존재하므로 포트만 넓힌다(부모→자식 순으로 1건씩 insert 하며
  // 반환된 new id 로 parentMessageId 를 재매핑하기 위해 bulkInsert 대신 단건 insert 를 쓴다).
  insert(data: Partial<Message>): Promise<Message>;
}

export interface SessionRoutesDeps {
  artifactDa?: ArtifactDataAccess;
  sessions?: SessionsPort;
  sessionMessages?: SessionMessagesPort;
  // P19-T1-03 — folder_id 할당(PATCH /:id) 전 ownership 검증에 필요(cross-org/타 사용자 폴더를
  // 세션에 붙이는 것을 차단, session_folders 테이블은 sessions 와 FK 만 있고 org 체크가 없어
  // application 레벨에서 검증해야 함).
  folders?: SessionFolderDataAccess;
  // P19-T1-04 — 태그 추가/제거(POST/DELETE /:id/tags).
  tags?: SessionTagDataAccess;
  // P19-T1-07 — 메시지 평가(POST/GET /:id/messages/:messageId/feedback).
  feedback?: MessageFeedbackDataAccess;
}

export function createSessionRoutes(
  deps: SessionRoutesDeps = {},
): Hono<{ Variables: AuthedVariables }> {
  const artifactDa = deps.artifactDa ?? createPgArtifactDataAccess();
  const sessions = deps.sessions ?? createPgSessionDataAccess();
  const sessionMessages = deps.sessionMessages ?? createPgMessageDataAccess();
  const folders = deps.folders ?? createPgSessionFolderDataAccess();
  const tags = deps.tags ?? createPgSessionTagDataAccess();
  const feedback = deps.feedback ?? createPgMessageFeedbackDataAccess();
  const app = new Hono<{ Variables: AuthedVariables }>();

  // P17-T1-02(TS-08/10) — 내 세션 목록(최신순). userId 는 auth 에서만 파생(body/query 미수신
  // → cross-org/타 사용자 열람 원천 차단, projects.ts actorOf 와 동일 패턴).
  // P19-T1-04 — ?tag= 로 태그 필터(해당 태그가 붙은 세션만).
  // P19-T1-05 — ?archived=true 로 아카이브된 세션만 조회(미지정 시 기본값대로 제외).
  app.get("/", async (c) => {
    const auth = c.get("auth");
    const cursor = c.req.query("cursor");
    const limit = parseLimit(c.req.query("limit"), 20, 100);
    const tag = c.req.query("tag");
    const archived = c.req.query("archived") === "true";
    const page = await sessions.list(
      {
        userId: auth.sub,
        ...(tag ? { tag } : {}),
        ...(archived ? { archived } : {}),
      },
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
        folderId: s.folderId,
        tags: s.tags,
      })),
      meta: {
        requestId: randomUUID(),
        ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
      },
    });
  });

  // P22-T1-04 — 명시적 세션 생성(16-API-CONTRACT §418). id 는 서버생성(lazy ensureSession 의
  // client UUID upsert 와 달리 계약대로 서버가 부여). userId 는 auth 에서만 파생(body 미신뢰 →
  // cross-user 생성 불가, GET / 목록과 동일 정책). title/projectId 는 optional body.
  app.post("/", async (c) => {
    const auth = c.get("auth");
    const body = await c.req
      .json<{ title?: string; projectId?: string }>()
      .catch(() => ({}) as { title?: string; projectId?: string });
    const created = await sessions.create({
      userId: auth.sub,
      title: body.title ?? null,
      projectId: body.projectId ?? null,
    });
    return c.json(
      {
        data: {
          id: created.id,
          title: created.title,
          projectId: created.projectId,
          createdAt: created.createdAt.toISOString(),
        },
        meta: { requestId: randomUUID() },
      },
      201,
    );
  });

  // P19-T1-06 — 제목+메시지 내용 검색. userId 는 auth 에서만 파생(body/query 미수신 →
  // cross-org/타 사용자 세션 노출 불가, GET / 목록과 동일 정책). 정적 경로라 "/:id/..." 계열보다
  // 먼저 매칭돼도/나중에 매칭돼도 충돌 없음(단일 세그먼트 GET /:id 라우트 자체가 없음).
  app.get("/search", async (c) => {
    const auth = c.get("auth");
    const q = c.req.query("q")?.trim();
    if (!q) {
      return c.json(errorJson("INVALID_INPUT", "q 가 필요합니다."), 400);
    }
    const limit = parseLimit(c.req.query("limit"), 20, 100);
    const results = await sessions.search(auth.sub, q, limit);
    return c.json({
      data: results.map((s) => ({
        id: s.id,
        title: s.title,
        lastMessageAt: s.lastMessageAt ? s.lastMessageAt.toISOString() : null,
        projectId: s.projectId,
        archived: s.archivedAt !== null,
        pinned: s.pinnedAt !== null,
        folderId: s.folderId,
        tags: s.tags,
      })),
      meta: { requestId: randomUUID() },
    });
  });

  // P19-T1-04 — 태그 추가. 세션 ownership 은 byId 로 먼저 검증(existence-leak 방지, 타 사용자
  // 세션은 404). org_id 는 auth 에서만 파생(body/query 미수신 → cross-org 불가).
  app.post("/:id/tags", async (c) => {
    const auth = c.get("auth");
    const sessionId = c.req.param("id");
    const session = await sessions.byId(sessionId);
    if (!session || session.userId !== auth.sub) {
      return c.json(errorJson("NOT_FOUND", "세션을 찾을 수 없습니다."), 404);
    }
    const body = await c.req
      .json<{ tag?: string }>()
      .catch(() => ({}) as { tag?: string });
    const tag = body.tag?.trim();
    if (!tag) {
      return c.json(errorJson("INVALID_INPUT", "tag 가 필요합니다."), 400);
    }
    const created = await tags.add(auth.org, sessionId, tag);
    return c.json(
      {
        data: { sessionId: created.sessionId, tag: created.tag },
        meta: { requestId: randomUUID() },
      },
      201,
    );
  });

  // P19-T1-04 — 태그 제거. 세션 ownership 은 POST 와 동일하게 먼저 검증.
  app.delete("/:id/tags/:tag", async (c) => {
    const auth = c.get("auth");
    const sessionId = c.req.param("id");
    const session = await sessions.byId(sessionId);
    if (!session || session.userId !== auth.sub) {
      return c.json(errorJson("NOT_FOUND", "세션을 찾을 수 없습니다."), 404);
    }
    const tag = c.req.param("tag");
    const deleted = await tags.remove(auth.org, sessionId, tag);
    if (!deleted) {
      return c.json(errorJson("NOT_FOUND", "태그를 찾을 수 없습니다."), 404);
    }
    return c.body(null, 204);
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

  // P19-T1-05 — 아카이브 토글. ownership 은 toggleArchiveForOwner 쿼리에 내장(핀 토글과 동일
  // 원자성 패턴) — 타 사용자/조직 세션은 404(existence-leak 방지). 제목/폴더 변경 없이 아카이브만
  // 전환하고 싶은 UI 흐름(세션 리스트 컨텍스트 메뉴)을 위해 범용 PATCH /:id 와 별도로 제공한다.
  app.patch("/:id/archive", async (c) => {
    const auth = c.get("auth");
    const sessionId = c.req.param("id");
    const updated = await sessions.toggleArchiveForOwner(auth.sub, sessionId);
    if (!updated) {
      return c.json(errorJson("NOT_FOUND", "세션을 찾을 수 없습니다."), 404);
    }
    return c.json({
      data: { id: updated.id, archived: updated.archivedAt !== null },
      meta: { requestId: randomUUID() },
    });
  });

  // P22-T6-01 — 대화 복제(POST /:id/clone). Open WebUI 의 conversation duplicate 대응.
  // 소유자 검증(byId + auth.sub, 타 사용자/조직 세션은 404 existence-leak 방지) 후 POST /sessions
  // 와 동일 생성 경로로 title/projectId 를 복사한 새 세션을 만들고, 원본 메시지 트리를
  // created_at ASC(부모가 자식보다 먼저 오는 순서)로 읽어 1건씩 삽입하며 old→new id 매핑으로
  // parentMessageId 를 재매핑한다(트리 관계 보존). pin/archive/active-run 상태는 복사하지 않고
  // 원본 세션은 변경하지 않는다(읽기만). 새 세션 DTO 는 POST / 와 동일 shape 로 201 반환.
  app.post("/:id/clone", async (c) => {
    const auth = c.get("auth");
    const sourceId = c.req.param("id");
    const source = await sessions.byId(sourceId);
    if (!source || source.userId !== auth.sub) {
      return c.json(errorJson("NOT_FOUND", "세션을 찾을 수 없습니다."), 404);
    }
    const cloned = await sessions.create({
      userId: auth.sub,
      title: source.title,
      projectId: source.projectId,
    });
    const page = await sessionMessages.list(
      { sessionId: sourceId },
      { limit: 1000 },
    );
    const idMap = new Map<string, string>();
    for (const m of page.items) {
      const remappedParent =
        m.parentMessageId != null
          ? (idMap.get(m.parentMessageId) ?? null)
          : null;
      const inserted = await sessionMessages.insert({
        sessionId: cloned.id,
        role: m.role,
        content: m.content,
        toolCallIds: m.toolCallIds,
        parentMessageId: remappedParent,
        tokensIn: m.tokensIn,
        tokensOut: m.tokensOut,
        costMicros: m.costMicros,
      });
      idMap.set(m.id, inserted.id);
    }
    return c.json(
      {
        data: {
          id: cloned.id,
          title: cloned.title,
          projectId: cloned.projectId,
          createdAt: cloned.createdAt.toISOString(),
        },
        meta: { requestId: randomUUID() },
      },
      201,
    );
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

  // P19-T1-07 — 메시지 평가 ownership 검증 헬퍼: 세션 소유자 확인 + 메시지가 해당 세션 소속인지
  // 확인(existence-leak 방지, 태그/폴더와 동일 패턴 — 타 사용자/조직 메시지는 404).
  async function verifyOwnedMessage(
    userId: string,
    sessionId: string,
    messageId: string,
  ): Promise<boolean> {
    const session = await sessions.byId(sessionId);
    if (!session || session.userId !== userId) return false;
    const message = await sessionMessages.byId(messageId);
    if (!message || message.sessionId !== sessionId) return false;
    return true;
  }

  // P19-T1-07 — 평가 upsert/토글 취소. 같은 rating 을 다시 보내면 취소(삭제)한다(👍/👎 클릭 토글 UX).
  app.post("/:id/messages/:messageId/feedback", async (c) => {
    const auth = c.get("auth");
    const sessionId = c.req.param("id");
    const messageId = c.req.param("messageId");
    const owned = await verifyOwnedMessage(auth.sub, sessionId, messageId);
    if (!owned) {
      return c.json(errorJson("NOT_FOUND", "메시지를 찾을 수 없습니다."), 404);
    }
    const body = await c.req
      .json<{ rating?: number }>()
      .catch(() => ({}) as { rating?: number });
    if (body.rating !== 1 && body.rating !== -1) {
      return c.json(
        errorJson("INVALID_INPUT", "rating 은 1 또는 -1 이어야 합니다."),
        400,
      );
    }
    const existing = await feedback.get(auth.org, messageId, auth.sub);
    if (existing && existing.rating === body.rating) {
      await feedback.remove(auth.org, messageId, auth.sub);
      return c.json({
        data: { messageId, rating: null },
        meta: { requestId: randomUUID() },
      });
    }
    const saved = await feedback.upsert(
      auth.org,
      messageId,
      auth.sub,
      body.rating,
    );
    return c.json({
      data: { messageId, rating: saved.rating },
      meta: { requestId: randomUUID() },
    });
  });

  // P19-T1-07 — 현재 사용자의 평가 조회(미평가 시 rating:null).
  app.get("/:id/messages/:messageId/feedback", async (c) => {
    const auth = c.get("auth");
    const sessionId = c.req.param("id");
    const messageId = c.req.param("messageId");
    const owned = await verifyOwnedMessage(auth.sub, sessionId, messageId);
    if (!owned) {
      return c.json(errorJson("NOT_FOUND", "메시지를 찾을 수 없습니다."), 404);
    }
    const existing = await feedback.get(auth.org, messageId, auth.sub);
    return c.json({
      data: { messageId, rating: existing?.rating ?? null },
      meta: { requestId: randomUUID() },
    });
  });

  // P20-T1-05 — 개별 메시지 삭제(하위 서브트리 prune). 자식이 있는 노드를 지우면 하위 전부를
  // 하드 삭제(parent_message_id 는 0002 마이그레이션상 ON DELETE SET NULL 이라 DB 레벨 cascade
  // 로는 트리가 끊어지지 않고 고아 노드로 남으므로, application 레벨에서 명시적으로 prune 한다).
  app.delete("/:id/messages/:messageId", async (c) => {
    const auth = c.get("auth");
    const sessionId = c.req.param("id");
    const messageId = c.req.param("messageId");
    const owned = await verifyOwnedMessage(auth.sub, sessionId, messageId);
    if (!owned) {
      return c.json(errorJson("NOT_FOUND", "메시지를 찾을 수 없습니다."), 404);
    }
    const page = await sessionMessages.list({ sessionId }, { limit: 1000 });
    const childrenByParent = new Map<string, string[]>();
    for (const m of page.items) {
      if (m.parentMessageId) {
        const siblings = childrenByParent.get(m.parentMessageId) ?? [];
        siblings.push(m.id);
        childrenByParent.set(m.parentMessageId, siblings);
      }
    }
    const toDelete: string[] = [];
    const stack = [messageId];
    while (stack.length > 0) {
      const id = stack.pop();
      if (id === undefined) break;
      toDelete.push(id);
      stack.push(...(childrenByParent.get(id) ?? []));
    }
    for (const id of toDelete) {
      await sessionMessages.delete(id);
    }
    return c.body(null, 204);
  });

  // P22-T1-05 — 단일 세션 조회(16-API-CONTRACT §432). userId 는 auth 에서만 파생(body/query
  // 미수신) — 타 사용자/조직 세션·부재 세션 모두 동일한 404 로 응답해 존재 누출(existence-leak)을
  // 막는다(/:id/tags·/:id/messages 와 동일 ownership 패턴). Hono 는 세그먼트 수로 라우트를
  // 구분하므로 이 단일 세그먼트 /:id 는 /:id/messages·/:id/artifacts 를 가리지 않고, 정적
  // /search 는 param 보다 우선 매칭돼 충돌하지 않는다.
  app.get("/:id", async (c) => {
    const auth = c.get("auth");
    const sessionId = c.req.param("id");
    const session = await sessions.byId(sessionId);
    if (!session || session.userId !== auth.sub) {
      return c.json(errorJson("NOT_FOUND", "세션을 찾을 수 없습니다."), 404);
    }
    return c.json({
      data: {
        id: session.id,
        title: session.title,
        projectId: session.projectId,
        createdAt: session.createdAt.toISOString(),
        archivedAt: session.archivedAt
          ? session.archivedAt.toISOString()
          : null,
      },
      meta: { requestId: randomUUID() },
    });
  });

  // P17-T1-03(TS-09) — rename(title)/archived. pin 토글은 별도 PATCH /:id/pin(P19-T1-02) 참조
  // (기존 lib/pinnedSessions.ts localStorage-only 를 서버 영속으로 승격).
  // P19-T1-03 — folderId 할당/해제(null). 폴더는 이 사용자(created_by) 소유여야 하므로
  // byIdForOwner 로 먼저 검증 — 타 사용자/조직 폴더 id 를 붙이려 하면 400(존재 자체는 숨기지
  // 않아도 되는 입력 검증 성격이라 404 대신 400, 폴더 CRUD 자체의 existence-leak 은 routes/folders.ts 가 담당).
  app.patch("/:id", async (c) => {
    const auth = c.get("auth");
    const sessionId = c.req.param("id");
    const body = await c.req
      .json<{ title?: string; archived?: boolean; folderId?: string | null }>()
      .catch(
        () =>
          ({}) as {
            title?: string;
            archived?: boolean;
            folderId?: string | null;
          },
      );
    if (
      body.title === undefined &&
      body.archived === undefined &&
      body.folderId === undefined
    ) {
      return c.json(
        errorJson(
          "INVALID_INPUT",
          "title, archived 또는 folderId 가 필요합니다.",
        ),
        400,
      );
    }
    if (body.folderId !== undefined && body.folderId !== null) {
      const owned = await folders.byIdForOwner(
        auth.org,
        auth.sub,
        body.folderId,
      );
      if (!owned) {
        return c.json(
          errorJson("INVALID_INPUT", "존재하지 않는 folderId 입니다."),
          400,
        );
      }
    }
    const updated = await sessions.updateForOwner(auth.sub, sessionId, {
      ...(body.title !== undefined ? { title: body.title } : {}),
      ...(body.archived !== undefined ? { archived: body.archived } : {}),
      ...(body.folderId !== undefined ? { folderId: body.folderId } : {}),
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
        folderId: updated.folderId,
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

  app.delete("/:id/active-run", async (c) => {
    const sessionId = c.req.param("id");
    // P22-T2-03 — 다른 인스턴스가 들고 있는 run 도 RuntimeBus 팬아웃으로 취소된다.
    const cancelled = await abortRun(sessionId);
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

    const result = await resolveHitl(sessionId, body.toolCallId, {
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

  app.get("/:id/hitl/pending", async (c) => {
    const sessionId = c.req.param("id");
    return c.json({
      data: await listPendingHitl(sessionId),
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
