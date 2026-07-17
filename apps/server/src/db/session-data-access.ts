// db/session-data-access.ts — routes/sessions.ts SessionsPort(GET /, GET /:id/messages —
// P17-T1-02, TS-08/10)의 pg 구현. dev/test DATABASE_URL role 은 superuser 라
// RLS(0002_sessions_messages.sql)를 우회한다 — user_id = $1 조건으로 application 레벨
// 격리를 강제한다(message-data-access.ts 와 동일 사유/패턴).
import type { Session } from "@wchat/interfaces";
import { pgPool } from "./client.js";

// P19-T1-02 — sessions.pinned_at(migration 0018)은 frozen Session(14-INTERFACES)에 없는 신규
// 컬럼이라, packages/interfaces 를 건드리지 않고 로컬 교집합 타입으로 확장한다(org-settings-schema.ts
// 의 "LOCAL 타입, frozen 회피" 컨벤션과 동일 사유 — 이 포트는 애초에 SessionRepo 전체가 아니라
// routes/sessions.ts 가 실제 쓰는 부분만 좁힌 로컬 포트, P17-T1-02 주석 참조).
// P19-T1-03 — sessions.folder_id(migration 0019)도 frozen Session 에 없는 신규 컬럼이라
// pinnedAt 과 동일 사유로 로컬 교집합 타입에 확장한다.
// P19-T1-04 — tags 는 session_tags(migration 0020) 조인 집계(컬럼 아님) — 동일 사유로
// 로컬 교집합 타입에 확장한다.
export type SessionWithPin = Session & {
  pinnedAt: Date | null;
  folderId: string | null;
  tags: string[];
};

function toSession(row: Record<string, unknown>): SessionWithPin {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    projectId: (row.project_id as string | null) ?? null,
    title: (row.title as string | null) ?? null,
    archivedAt: (row.archived_at as Date | null) ?? null,
    pinnedAt: (row.pinned_at as Date | null) ?? null,
    folderId: (row.folder_id as string | null) ?? null,
    tags: (row.tags as string[] | null) ?? [],
    lastMessageAt: (row.last_message_at as Date | null) ?? null,
    createdAt: row.created_at as Date,
  };
}

export interface SessionsDataAccess {
  list(
    // P19-T1-04 — tag 필터(GET /sessions?tag=). 미지정 시 전체(기존 동작 무변경).
    // P19-T1-05 — archived 필터: true 면 아카이브된 세션만, 미지정/false 면 기본값대로
    // 아카이브 제외(archived_at IS NULL) — 16-API-CONTRACT GET /sessions?...&archived.
    filter: { userId: string; tag?: string; archived?: boolean },
    pagination?: { cursor?: string; limit?: number },
  ): Promise<{ items: SessionWithPin[]; nextCursor?: string }>;
  byId(id: string): Promise<SessionWithPin | null>;
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
  // 토글: 현재 pinned_at 이 NULL 이면 NOW() 로, 아니면 NULL 로 — 원자적 단일 UPDATE
  // (read-then-write race 방지). ownership 은 WHERE id=.. AND user_id=.. 로 쿼리에 내장(TS-09 패턴).
  togglePinForOwner(userId: string, id: string): Promise<SessionWithPin | null>;
  // P19-T1-05 — 아카이브 토글(togglePinForOwner 와 동일 원자적 CASE 패턴).
  toggleArchiveForOwner(
    userId: string,
    id: string,
  ): Promise<SessionWithPin | null>;
  // P19-T1-06 — 제목+메시지 내용 검색(GET /sessions/search?q=). ownership 은 list() 와 동일하게
  // userId 로 쿼리에 내장(cross-org/타 사용자 세션은 결과에 노출 불가).
  search(
    userId: string,
    query: string,
    limit?: number,
  ): Promise<SessionWithPin[]>;
}

// P20-T1-07 — 검색 접두어 필터(tag:/folder:/pinned:/archived:). 공백으로 토큰을 나눠 인식된
// 접두어는 필터로 소비하고, 나머지 토큰은 기존 title/content/tag ILIKE 자유텍스트로 결합한다
// (Open WebUI Prefix Filters 패턴). 각 접두어는 AND 로 좁히고, 마지막 등장이 우선한다.
interface ParsedSearchQuery {
  tag?: string;
  folder?: string;
  pinned?: boolean;
  archived?: boolean;
  text: string;
}

const SEARCH_PREFIX_RE = /^(tag|folder|pinned|archived):(.+)$/i;

function parseSearchQuery(query: string): ParsedSearchQuery {
  const rest: string[] = [];
  const parsed: ParsedSearchQuery = { text: "" };
  for (const token of query.split(/\s+/).filter(Boolean)) {
    const match = token.match(SEARCH_PREFIX_RE);
    if (!match) {
      rest.push(token);
      continue;
    }
    const key = (match[1] ?? "").toLowerCase();
    const value = match[2] ?? "";
    if (key === "tag") parsed.tag = value;
    else if (key === "folder") parsed.folder = value;
    else if (key === "pinned") parsed.pinned = value.toLowerCase() !== "false";
    else if (key === "archived")
      parsed.archived = value.toLowerCase() !== "false";
  }
  parsed.text = rest.join(" ");
  return parsed;
}

function escapeIlike(value: string): string {
  return value.replace(/([\\%_])/g, "\\$1");
}

export function createPgSessionDataAccess(): SessionsDataAccess {
  return {
    async list(filter, pagination) {
      const limit = pagination?.limit ?? 20;
      const res = await pgPool.query(
        `SELECT s.*, COALESCE(
           (SELECT array_agg(t.tag ORDER BY t.tag) FROM session_tags t WHERE t.session_id = s.id),
           '{}'
         ) AS tags
         FROM sessions s
         WHERE s.user_id = $1
           AND ($2::text IS NULL OR EXISTS (
             SELECT 1 FROM session_tags t WHERE t.session_id = s.id AND t.tag = $2
           ))
           AND (
             ($3::boolean IS TRUE AND s.archived_at IS NOT NULL)
             OR ($3::boolean IS NOT TRUE AND s.archived_at IS NULL)
           )
         ORDER BY COALESCE(s.last_message_at, s.created_at) DESC LIMIT $4`,
        [filter.userId, filter.tag ?? null, filter.archived ?? null, limit],
      );
      return { items: res.rows.map(toSession) };
    },
    async byId(id) {
      const res = await pgPool.query("SELECT * FROM sessions WHERE id = $1", [
        id,
      ]);
      return res.rows[0] ? toSession(res.rows[0]) : null;
    },
    async updateForOwner(userId, id, data) {
      const fields: string[] = [];
      const values: unknown[] = [];
      let i = 1;
      if (data.title !== undefined) {
        fields.push(`title = $${i}`);
        values.push(data.title);
        i++;
      }
      if (data.archived !== undefined) {
        fields.push(`archived_at = $${i}`);
        values.push(data.archived ? new Date() : null);
        i++;
      }
      if (data.folderId !== undefined) {
        fields.push(`folder_id = $${i}`);
        values.push(data.folderId);
        i++;
      }
      if (fields.length === 0) return this.byId(id);
      values.push(id, userId);
      const res = await pgPool.query(
        `UPDATE sessions SET ${fields.join(", ")}
         WHERE id = $${i} AND user_id = $${i + 1} RETURNING *`,
        values,
      );
      return res.rows[0] ? toSession(res.rows[0]) : null;
    },
    async deleteForOwner(userId, id) {
      const res = await pgPool.query(
        "DELETE FROM sessions WHERE id = $1 AND user_id = $2",
        [id, userId],
      );
      return (res.rowCount ?? 0) > 0;
    },
    async togglePinForOwner(userId, id) {
      const res = await pgPool.query(
        `UPDATE sessions
         SET pinned_at = CASE WHEN pinned_at IS NULL THEN NOW() ELSE NULL END
         WHERE id = $1 AND user_id = $2
         RETURNING *`,
        [id, userId],
      );
      return res.rows[0] ? toSession(res.rows[0]) : null;
    },
    async toggleArchiveForOwner(userId, id) {
      const res = await pgPool.query(
        `UPDATE sessions
         SET archived_at = CASE WHEN archived_at IS NULL THEN NOW() ELSE NULL END
         WHERE id = $1 AND user_id = $2
         RETURNING *`,
        [id, userId],
      );
      return res.rows[0] ? toSession(res.rows[0]) : null;
    },
    async search(userId, query, limit = 20) {
      // P20-T1-07 — tag:/folder:/pinned:/archived: 접두어를 먼저 파싱해 각각 AND 조건으로
      // 좁히고, 잔여 자유텍스트(있을 때만)는 기존 title/content/tag ILIKE OR 로 결합한다.
      // 접두어가 하나도 없으면 이전 동작(자유텍스트만)과 동일하다.
      const parsed = parseSearchQuery(query);
      const conditions: string[] = ["s.user_id = $1"];
      const values: unknown[] = [userId];
      let i = 2;

      if (parsed.tag !== undefined) {
        values.push(escapeIlike(parsed.tag));
        conditions.push(
          `EXISTS (SELECT 1 FROM session_tags t WHERE t.session_id = s.id AND t.tag ILIKE $${i} ESCAPE '\\')`,
        );
        i++;
      }
      if (parsed.folder !== undefined) {
        values.push(`%${escapeIlike(parsed.folder)}%`);
        conditions.push(
          `EXISTS (SELECT 1 FROM session_folders f WHERE f.id = s.folder_id AND f.name ILIKE $${i} ESCAPE '\\')`,
        );
        i++;
      }
      if (parsed.pinned !== undefined) {
        conditions.push(
          parsed.pinned ? "s.pinned_at IS NOT NULL" : "s.pinned_at IS NULL",
        );
      }
      if (parsed.archived !== undefined) {
        conditions.push(
          parsed.archived
            ? "s.archived_at IS NOT NULL"
            : "s.archived_at IS NULL",
        );
      }
      const text = parsed.text.trim();
      if (text) {
        const pattern = `%${escapeIlike(text)}%`;
        values.push(pattern);
        conditions.push(
          `(
             s.title ILIKE $${i} ESCAPE '\\'
             OR EXISTS (
               SELECT 1 FROM messages m
               WHERE m.session_id = s.id AND m.content::text ILIKE $${i} ESCAPE '\\'
             )
             OR EXISTS (
               SELECT 1 FROM session_tags t2
               WHERE t2.session_id = s.id AND t2.tag ILIKE $${i} ESCAPE '\\'
             )
           )`,
        );
        i++;
      }
      values.push(limit);
      const res = await pgPool.query(
        `SELECT s.*, COALESCE(
           (SELECT array_agg(t.tag ORDER BY t.tag) FROM session_tags t WHERE t.session_id = s.id),
           '{}'
         ) AS tags
         FROM sessions s
         WHERE ${conditions.join(" AND ")}
         ORDER BY COALESCE(s.last_message_at, s.created_at) DESC
         LIMIT $${i}`,
        values,
      );
      return res.rows.map(toSession);
    },
  };
}
