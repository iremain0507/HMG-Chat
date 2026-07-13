// db/project-data-access.ts — db/project-service.ts 의 ProjectDataAccess pg 구현체
// (db/auth-data-access.ts 와 동일 패턴). dev/test DATABASE_URL role 은 superuser 라
// RLS 를 우회한다 — project-service.ts 가 application 레벨에서 권한을 재현/강제한다.
import type { Page, Project, ProjectMember } from "@wchat/interfaces";
import type { ProjectDataAccess } from "./project-service.js";
import { pgPool } from "./client.js";

function toProject(row: Record<string, unknown>): Project {
  return {
    id: row.id as string,
    orgId: row.org_id as string,
    ownerId: row.owner_id as string,
    orgUnitId: (row.org_unit_id as string | null) ?? null,
    name: row.name as string,
    description: (row.description as string | null) ?? null,
    visibility: row.visibility as Project["visibility"],
    archivedAt: (row.archived_at as Date | null) ?? null,
    createdAt: row.created_at as Date,
  };
}

function toProjectMember(row: Record<string, unknown>): ProjectMember {
  return {
    projectId: row.project_id as string,
    userId: row.user_id as string,
    role: row.role as ProjectMember["role"],
    createdAt: row.created_at as Date,
  };
}

export function createPgProjectDataAccess(): ProjectDataAccess {
  return {
    projects: {
      async insert(data) {
        const res = await pgPool.query(
          `INSERT INTO projects (org_id, owner_id, name, description, visibility, org_unit_id, archived_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           RETURNING *`,
          [
            data.orgId,
            data.ownerId,
            data.name,
            data.description ?? null,
            data.visibility,
            data.orgUnitId ?? null,
            data.archivedAt ?? null,
          ],
        );
        return toProject(res.rows[0]);
      },
      async bulkInsert(rows) {
        const results: Project[] = [];
        for (const row of rows) {
          results.push(await this.insert(row));
        }
        return results;
      },
      async update(id, data) {
        const fields: string[] = [];
        const values: unknown[] = [];
        let i = 1;
        for (const [key, col] of [
          ["name", "name"],
          ["description", "description"],
          ["visibility", "visibility"],
          ["archivedAt", "archived_at"],
        ] as const) {
          if (key in data) {
            fields.push(`${col} = $${i}`);
            values.push((data as Record<string, unknown>)[key]);
            i++;
          }
        }
        values.push(id);
        const res = await pgPool.query(
          `UPDATE projects SET ${fields.join(", ")} WHERE id = $${i} RETURNING *`,
          values,
        );
        return toProject(res.rows[0]);
      },
      async delete(id) {
        await pgPool.query("DELETE FROM projects WHERE id = $1", [id]);
      },
      async byId(id) {
        const res = await pgPool.query("SELECT * FROM projects WHERE id = $1", [
          id,
        ]);
        return res.rows[0] ? toProject(res.rows[0]) : null;
      },
      async list(filter, pagination): Promise<Page<Project>> {
        const conditions: string[] = [];
        const values: unknown[] = [];
        let i = 1;
        if (filter?.orgId) {
          conditions.push(`org_id = $${i}`);
          values.push(filter.orgId);
          i++;
        }
        if (filter?.visibility) {
          conditions.push(`visibility = $${i}`);
          values.push(filter.visibility);
          i++;
        }
        const where = conditions.length
          ? `WHERE ${conditions.join(" AND ")}`
          : "";
        const limit = pagination?.limit ?? 50;
        values.push(limit);
        const res = await pgPool.query(
          `SELECT * FROM projects ${where} ORDER BY created_at DESC LIMIT $${i}`,
          values,
        );
        return { items: res.rows.map(toProject) };
      },
      async byOwner(userId) {
        const res = await pgPool.query(
          "SELECT * FROM projects WHERE owner_id = $1 ORDER BY created_at DESC",
          [userId],
        );
        return res.rows.map(toProject);
      },
    },
    projectMembers: {
      async insert(data) {
        const res = await pgPool.query(
          `INSERT INTO project_members (project_id, user_id, role)
           VALUES ($1, $2, $3) RETURNING *`,
          [data.projectId, data.userId, data.role],
        );
        return toProjectMember(res.rows[0]);
      },
      async bulkInsert(rows) {
        const results: ProjectMember[] = [];
        for (const row of rows) {
          results.push(await this.insert(row));
        }
        return results;
      },
      async upsert(input) {
        const res = await pgPool.query(
          `INSERT INTO project_members (project_id, user_id, role)
           VALUES ($1, $2, $3)
           ON CONFLICT (project_id, user_id) DO UPDATE SET role = EXCLUDED.role
           RETURNING *`,
          [input.projectId, input.userId, input.role],
        );
        return toProjectMember(res.rows[0]);
      },
      async byKey(projectId, userId) {
        const res = await pgPool.query(
          "SELECT * FROM project_members WHERE project_id = $1 AND user_id = $2",
          [projectId, userId],
        );
        return res.rows[0] ? toProjectMember(res.rows[0]) : null;
      },
      async updateRole(projectId, userId, role) {
        const res = await pgPool.query(
          `UPDATE project_members SET role = $1 WHERE project_id = $2 AND user_id = $3
           RETURNING *`,
          [role, projectId, userId],
        );
        return toProjectMember(res.rows[0]);
      },
      async deleteByKey(projectId, userId) {
        await pgPool.query(
          "DELETE FROM project_members WHERE project_id = $1 AND user_id = $2",
          [projectId, userId],
        );
      },
      async list(filter, pagination): Promise<Page<ProjectMember>> {
        const conditions: string[] = [];
        const values: unknown[] = [];
        let i = 1;
        if (filter?.projectId) {
          conditions.push(`project_id = $${i}`);
          values.push(filter.projectId);
          i++;
        }
        if (filter?.userId) {
          conditions.push(`user_id = $${i}`);
          values.push(filter.userId);
          i++;
        }
        const where = conditions.length
          ? `WHERE ${conditions.join(" AND ")}`
          : "";
        const limit = pagination?.limit ?? 50;
        values.push(limit);
        const res = await pgPool.query(
          `SELECT * FROM project_members ${where} ORDER BY created_at ASC LIMIT $${i}`,
          values,
        );
        return { items: res.rows.map(toProjectMember) };
      },
    },
    async orgUnitIdsForUser(userId) {
      const res = await pgPool.query(
        "SELECT org_unit_id FROM user_org_units WHERE user_id = $1",
        [userId],
      );
      return res.rows.map((row) => row.org_unit_id as string);
    },
  };
}
