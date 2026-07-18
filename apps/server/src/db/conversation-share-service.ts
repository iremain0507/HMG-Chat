// db/conversation-share-service.ts — P20-T1-08: 대화 스냅샷 공유 링크(불변).
// 기존 ArtifactShareRecord(14-INTERFACES)와 달리 frozen 인터페이스에 정의가 없어(신규 P20 기능)
// org-settings-schema.ts 컨벤션대로 LOCAL 타입으로 둔다. 발급 시점에 세션 제목 + 전체 메시지를
// snapshot JSONB 로 그대로 굳혀 저장 — 이후 원본 세션/메시지가 수정/삭제돼도 공개 링크는
// 발급 시점 스냅샷을 그대로 보여준다(불변). 발급자 격리(다른 유저 세션 공유 불가, existence-leak
// 방지)와 public 조회 시 revoke/expire 판정(410 GONE)을 여기서 강제한다.
export interface ConversationSnapshotMessage {
  id: string;
  role: string;
  content: unknown;
  createdAt: string;
}

export interface ConversationSnapshot {
  sessionId: string;
  title: string | null;
  capturedAt: string;
  messages: ConversationSnapshotMessage[];
}

export interface ConversationShareRecord {
  id: string;
  orgId: string;
  sessionId: string;
  createdBy: string;
  snapshot: ConversationSnapshot;
  token: string;
  expiresAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
}

export interface ConversationSharesDataAccess {
  conversationShares: {
    insert(data: {
      orgId: string;
      sessionId: string;
      createdBy: string;
      snapshot: ConversationSnapshot;
      expiresAt: Date | null;
    }): Promise<ConversationShareRecord>;
    byId(id: string): Promise<ConversationShareRecord | null>;
    byToken(token: string): Promise<ConversationShareRecord | null>;
    revoke(id: string): Promise<void>;
  };
}

// routes/conversation-share.ts 가 실제 쓰는 부분만 좁힌 로컬 포트(routes/sessions.ts SessionsPort
// 와 동일 패턴) — SessionsDataAccess/MessageRepo 전체 구현을 강제하지 않는다.
export interface ConversationShareSessionsPort {
  byId(id: string): Promise<{ userId: string; title: string | null } | null>;
}

export interface ConversationShareMessagesPort {
  list(
    filter: { sessionId: string },
    pagination?: { limit?: number },
  ): Promise<{
    items: Array<{
      id: string;
      role: string;
      content: unknown;
      createdAt: Date;
    }>;
  }>;
}

export interface ConversationShareActor {
  userId: string;
  orgId: string;
}

export class ConversationShareServiceError extends Error {
  code: "NOT_FOUND" | "GONE";
  // GONE 세분화: 만료(expired) 와 취소(revoked) 를 공개 응답에서 구분(P22-T4-02).
  reason?: "expired" | "revoked";

  constructor(
    code: ConversationShareServiceError["code"],
    message: string,
    reason?: ConversationShareServiceError["reason"],
  ) {
    super(message);
    this.code = code;
    // exactOptionalPropertyTypes: 미지정(undefined) 이면 속성 자체를 부여하지 않는다.
    if (reason !== undefined) this.reason = reason;
  }
}

const SNAPSHOT_MESSAGE_LIMIT = 1000;

export function createConversationShareService(deps: {
  da: ConversationSharesDataAccess;
  sessions: ConversationShareSessionsPort;
  messages: ConversationShareMessagesPort;
}) {
  async function issueShare(
    actor: ConversationShareActor,
    sessionId: string,
  ): Promise<ConversationShareRecord> {
    const session = await deps.sessions.byId(sessionId);
    if (!session || session.userId !== actor.userId) {
      throw new ConversationShareServiceError(
        "NOT_FOUND",
        "세션을 찾을 수 없습니다.",
      );
    }
    const { items } = await deps.messages.list(
      { sessionId },
      { limit: SNAPSHOT_MESSAGE_LIMIT },
    );
    const snapshot: ConversationSnapshot = {
      sessionId,
      title: session.title,
      capturedAt: new Date().toISOString(),
      messages: items.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        createdAt: m.createdAt.toISOString(),
      })),
    };
    return deps.da.conversationShares.insert({
      orgId: actor.orgId,
      sessionId,
      createdBy: actor.userId,
      snapshot,
      expiresAt: null,
    });
  }

  async function getShareForActor(
    actor: ConversationShareActor,
    id: string,
  ): Promise<ConversationShareRecord | null> {
    const found = await deps.da.conversationShares.byId(id);
    if (!found || found.createdBy !== actor.userId) return null;
    return found;
  }

  async function revokeShare(
    actor: ConversationShareActor,
    id: string,
  ): Promise<void> {
    const found = await getShareForActor(actor, id);
    if (!found) {
      throw new ConversationShareServiceError(
        "NOT_FOUND",
        "share 를 찾을 수 없습니다.",
      );
    }
    await deps.da.conversationShares.revoke(id);
  }

  async function resolvePublicShare(
    token: string,
  ): Promise<ConversationShareRecord> {
    const found = await deps.da.conversationShares.byToken(token);
    if (!found) {
      throw new ConversationShareServiceError(
        "NOT_FOUND",
        "share 를 찾을 수 없습니다.",
      );
    }
    if (
      found.revokedAt ||
      (found.expiresAt && found.expiresAt.getTime() <= Date.now())
    ) {
      // revoke 가 만료보다 우선(둘 다 성립 시 revoked 로 안내).
      throw new ConversationShareServiceError(
        "GONE",
        "share 가 만료되었거나 revoke 되었습니다.",
        found.revokedAt ? "revoked" : "expired",
      );
    }
    return found;
  }

  return {
    issueShare,
    getShareForActor,
    revokeShare,
    resolvePublicShare,
  };
}
