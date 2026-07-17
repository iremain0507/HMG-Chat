// db/prompt-data-access.ts — routes/prompts.ts PromptDataAccess(P19-T1-08)의 pg 구현.
// dev/test DATABASE_URL role 은 superuser 라 RLS(0024_prompts.sql)를 우회한다 — private/org
// 접근 구분은 application 레벨(list/byIdVisible 의 WHERE 절)에서 강제한다(session_folders.ts,
// message_feedback 등과 동일한 이중 방어 패턴).
import { pgPool } from "./client.js";

export interface Prompt {
  id: string;
  orgId: string;
  ownerId: string;
  command: string;
  title: string;
  content: string;
  access: "private" | "org";
  createdAt: Date;
  updatedAt: Date;
}

function toPrompt(row: Record<string, unknown>): Prompt {
  return {
    id: row.id as string,
    orgId: row.org_id as string,
    ownerId: row.owner_id as string,
    command: row.command as string,
    title: row.title as string,
    content: row.content as string,
    access: row.access as "private" | "org",
    createdAt: row.created_at as Date,
    updatedAt: row.updated_at as Date,
  };
}

export interface PromptDataAccess {
  create(
    orgId: string,
    ownerId: string,
    input: {
      command: string;
      title: string;
      content: string;
      access: "private" | "org";
    },
  ): Promise<Prompt>;
  listVisible(orgId: string, userId: string): Promise<Prompt[]>;
  byIdVisible(
    orgId: string,
    userId: string,
    id: string,
  ): Promise<Prompt | null>;
  updateForOwner(
    orgId: string,
    ownerId: string,
    id: string,
    input: {
      command: string | undefined;
      title: string | undefined;
      content: string | undefined;
      access: "private" | "org" | undefined;
    },
  ): Promise<Prompt | null>;
  deleteForOwner(orgId: string, ownerId: string, id: string): Promise<boolean>;
}

export function createPgPromptDataAccess(): PromptDataAccess {
  return {
    async create(orgId, ownerId, input) {
      const res = await pgPool.query(
        `INSERT INTO prompts (org_id, owner_id, command, title, content, access)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [
          orgId,
          ownerId,
          input.command,
          input.title,
          input.content,
          input.access,
        ],
      );
      return toPrompt(res.rows[0]);
    },
    async listVisible(orgId, userId) {
      const res = await pgPool.query(
        `SELECT * FROM prompts WHERE org_id = $1 AND (owner_id = $2 OR access = 'org')
         ORDER BY created_at ASC`,
        [orgId, userId],
      );
      return res.rows.map(toPrompt);
    },
    async byIdVisible(orgId, userId, id) {
      const res = await pgPool.query(
        `SELECT * FROM prompts WHERE id = $1 AND org_id = $2 AND (owner_id = $3 OR access = 'org')`,
        [id, orgId, userId],
      );
      return res.rows[0] ? toPrompt(res.rows[0]) : null;
    },
    async updateForOwner(orgId, ownerId, id, input) {
      const current = await pgPool.query(
        `SELECT * FROM prompts WHERE id = $1 AND org_id = $2 AND owner_id = $3`,
        [id, orgId, ownerId],
      );
      if (!current.rows[0]) return null;
      const existing = toPrompt(current.rows[0]);
      const command = input.command ?? existing.command;
      const title = input.title ?? existing.title;
      const content = input.content ?? existing.content;
      const access = input.access ?? existing.access;
      const res = await pgPool.query(
        `UPDATE prompts SET command = $1, title = $2, content = $3, access = $4
         WHERE id = $5 AND org_id = $6 AND owner_id = $7 RETURNING *`,
        [command, title, content, access, id, orgId, ownerId],
      );
      return res.rows[0] ? toPrompt(res.rows[0]) : null;
    },
    async deleteForOwner(orgId, ownerId, id) {
      const res = await pgPool.query(
        `DELETE FROM prompts WHERE id = $1 AND org_id = $2 AND owner_id = $3`,
        [id, orgId, ownerId],
      );
      return (res.rowCount ?? 0) > 0;
    },
  };
}
