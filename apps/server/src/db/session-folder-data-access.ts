// db/session-folder-data-access.ts — routes/folders.ts SessionFolderDataAccess(P19-T1-03)의
// pg 구현. dev/test DATABASE_URL role 은 superuser 라 RLS(0019_session_folders.sql)를
// 우회한다 — org_id + created_by 이중 조건으로 application 레벨 격리를 강제한다
// (session-data-access.ts 의 user_id 단일 조건과 달리, session_folders 는 org_id 컬럼도
// 갖고 있어 migration 주석의 "이중 검사" 방침을 그대로 따른다).
import { pgPool } from "./client.js";

export interface SessionFolder {
  id: string;
  orgId: string;
  name: string;
  // P20-T1-03 — 폴더 스코프 시스템 프롬프트(Open WebUI Folder System Prompt 참고).
  // nullable-first(0028), 미설정 폴더는 null(기존 동작 무변경).
  systemPrompt: string | null;
  // P20-T1-06 — 중첩 폴더(Open WebUI Nested Folders 참고). nullable-first(0029),
  // 기존 폴더는 전부 null(root, 기존 flat 동작 무변경).
  parentFolderId: string | null;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface SessionFolderUpdate {
  name?: string;
  systemPrompt?: string | null;
  parentFolderId?: string | null;
}

// 자기참조/순환 시도를 애플리케이션 레벨에서 거부하기 위한 전용 에러(routes/folders.ts 가
// 400 INVALID_INPUT 으로 매핑). FK 자체는 self-reference·순환을 막지 못한다(0029 주석 참조).
export class CircularFolderReferenceError extends Error {
  constructor() {
    super("폴더는 자기 자신이나 하위 폴더를 부모로 지정할 수 없습니다.");
    this.name = "CircularFolderReferenceError";
  }
}

function toFolder(row: Record<string, unknown>): SessionFolder {
  return {
    id: row.id as string,
    orgId: row.org_id as string,
    name: row.name as string,
    systemPrompt: (row.system_prompt as string | null) ?? null,
    parentFolderId: (row.parent_folder_id as string | null) ?? null,
    createdBy: row.created_by as string,
    createdAt: row.created_at as Date,
    updatedAt: row.updated_at as Date,
  };
}

export interface SessionFolderDataAccess {
  create(
    orgId: string,
    userId: string,
    name: string,
    systemPrompt?: string | null,
    parentFolderId?: string | null,
  ): Promise<SessionFolder>;
  list(orgId: string, userId: string): Promise<SessionFolder[]>;
  byIdForOwner(
    orgId: string,
    userId: string,
    id: string,
  ): Promise<SessionFolder | null>;
  updateForOwner(
    orgId: string,
    userId: string,
    id: string,
    patch: SessionFolderUpdate,
  ): Promise<SessionFolder | null>;
  deleteForOwner(orgId: string, userId: string, id: string): Promise<boolean>;
}

export function createPgSessionFolderDataAccess(): SessionFolderDataAccess {
  // P20-T1-06 — folderId 를 newParentId 의 조상 체인(newParentId 자신 포함)에서 찾으면
  // 순환이 생긴다. FK 는 self-reference/순환을 막지 못하므로 이 애플리케이션 레벨 워크가
  // 유일한 방어선이다(0029 migration 주석 참조).
  async function wouldCreateCycle(
    orgId: string,
    userId: string,
    folderId: string,
    newParentId: string,
  ): Promise<boolean> {
    if (folderId === newParentId) return true;
    let current: string | null = newParentId;
    const visited = new Set<string>();
    while (current) {
      if (current === folderId) return true;
      if (visited.has(current)) return false;
      visited.add(current);
      const res: { rows: Array<{ parent_folder_id: string | null }> } =
        await pgPool.query(
          `SELECT parent_folder_id FROM session_folders
         WHERE id = $1 AND org_id = $2 AND created_by = $3`,
          [current, orgId, userId],
        );
      if (res.rows.length === 0) return false;
      current = res.rows[0]?.parent_folder_id ?? null;
    }
    return false;
  }

  return {
    async create(orgId, userId, name, systemPrompt, parentFolderId) {
      const res = await pgPool.query(
        `INSERT INTO session_folders (org_id, name, created_by, system_prompt, parent_folder_id)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [orgId, name, userId, systemPrompt ?? null, parentFolderId ?? null],
      );
      return toFolder(res.rows[0]);
    },
    async list(orgId, userId) {
      const res = await pgPool.query(
        `SELECT * FROM session_folders WHERE org_id = $1 AND created_by = $2
         ORDER BY created_at ASC`,
        [orgId, userId],
      );
      return res.rows.map(toFolder);
    },
    async byIdForOwner(orgId, userId, id) {
      const res = await pgPool.query(
        `SELECT * FROM session_folders WHERE id = $1 AND org_id = $2 AND created_by = $3`,
        [id, orgId, userId],
      );
      return res.rows[0] ? toFolder(res.rows[0]) : null;
    },
    async updateForOwner(orgId, userId, id, patch) {
      if (
        patch.parentFolderId !== undefined &&
        patch.parentFolderId !== null &&
        (await wouldCreateCycle(orgId, userId, id, patch.parentFolderId))
      ) {
        throw new CircularFolderReferenceError();
      }
      const fields: string[] = [];
      const values: unknown[] = [];
      let i = 1;
      if (patch.name !== undefined) {
        fields.push(`name = $${i}`);
        values.push(patch.name);
        i += 1;
      }
      if (patch.systemPrompt !== undefined) {
        fields.push(`system_prompt = $${i}`);
        values.push(patch.systemPrompt);
        i += 1;
      }
      if (patch.parentFolderId !== undefined) {
        fields.push(`parent_folder_id = $${i}`);
        values.push(patch.parentFolderId);
        i += 1;
      }
      if (fields.length === 0) {
        return this.byIdForOwner(orgId, userId, id);
      }
      values.push(id, orgId, userId);
      const res = await pgPool.query(
        `UPDATE session_folders SET ${fields.join(", ")}
         WHERE id = $${i} AND org_id = $${i + 1} AND created_by = $${i + 2} RETURNING *`,
        values,
      );
      return res.rows[0] ? toFolder(res.rows[0]) : null;
    },
    async deleteForOwner(orgId, userId, id) {
      const res = await pgPool.query(
        `DELETE FROM session_folders WHERE id = $1 AND org_id = $2 AND created_by = $3`,
        [id, orgId, userId],
      );
      return (res.rowCount ?? 0) > 0;
    },
  };
}
