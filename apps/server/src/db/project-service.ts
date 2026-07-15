// db/project-service.ts — 16-API-CONTRACT.md § 4 Projects 단일 출처.
// RLS(0004/0015) 가 DB 레벨 read visibility 를 강제하지만, dev/test DATABASE_URL role 은
// superuser 라 RLS 를 우회한다(db/auth-data-access.ts 와 동일 근거) — 그래서 이 서비스가
// 08-SPRINT-PLAN.md § Phase 3 visibility 매트릭스 + 멤버 role(owner/editor/viewer) 권한을
// application 레벨에서 동일하게 재현해 강제한다.
import type { DataAccess, Project, ProjectMember } from "@wchat/interfaces";

export type ProjectDataAccess = Pick<
  DataAccess,
  "projects" | "projectMembers"
> & {
  // user_org_units 는 14-INTERFACES.md DataAccess 에 별도 Repo 가 없다 — routes/auth-data-access.ts
  // 패턴과 동일하게(AuthDataAccess 가 DataAccess 를 Pick 하듯) 이 서비스 전용으로 좁힌 조회 메서드.
  orgUnitIdsForUser(userId: string): Promise<string[]>;
};

export interface ProjectActor {
  userId: string;
  orgId: string;
}

export interface CreateProjectInput {
  name: string;
  description?: string | null;
  visibility: Project["visibility"];
  orgUnitId?: string;
}

export interface ProjectAccess {
  project: Project;
  role: ProjectMember["role"] | null;
}

export class ProjectServiceError extends Error {
  code: "INVALID_INPUT" | "NOT_FOUND" | "FORBIDDEN";

  constructor(code: ProjectServiceError["code"], message: string) {
    super(message);
    this.code = code;
  }
}

function canRead(
  project: Project,
  actor: ProjectActor,
  member: ProjectMember | null,
  actorOrgUnitIds: string[],
): boolean {
  if (project.orgId !== actor.orgId) return false;
  if (member) return true;
  if (project.visibility === "org") return true;
  if (project.visibility === "team") {
    return (
      project.orgUnitId !== null && actorOrgUnitIds.includes(project.orgUnitId)
    );
  }
  return false; // private, non-member
}

export function createProjectService(da: ProjectDataAccess) {
  async function getProjectForActor(
    actor: ProjectActor,
    projectId: string,
  ): Promise<ProjectAccess | null> {
    const project = await da.projects.byId(projectId);
    if (!project) return null;
    const [member, orgUnitIds] = await Promise.all([
      da.projectMembers.byKey(projectId, actor.userId),
      da.orgUnitIdsForUser(actor.userId),
    ]);
    if (!canRead(project, actor, member, orgUnitIds)) return null;
    return { project, role: member?.role ?? null };
  }

  async function requireAccess(
    actor: ProjectActor,
    projectId: string,
  ): Promise<ProjectAccess> {
    const found = await getProjectForActor(actor, projectId);
    if (!found) {
      throw new ProjectServiceError(
        "NOT_FOUND",
        "프로젝트를 찾을 수 없습니다.",
      );
    }
    return found;
  }

  function requireWrite(access: ProjectAccess): void {
    if (access.role === "owner" || access.role === "editor") return;
    throw new ProjectServiceError(
      "FORBIDDEN",
      "설정을 변경할 권한이 없습니다.",
    );
  }

  function requireAdmin(access: ProjectAccess): void {
    if (access.role === "owner") return;
    throw new ProjectServiceError(
      "FORBIDDEN",
      "이 작업은 owner 만 수행할 수 있습니다.",
    );
  }

  return {
    async createProjectWithOwner(
      actor: ProjectActor,
      input: CreateProjectInput,
    ): Promise<Project> {
      if (input.visibility === "team") {
        if (!input.orgUnitId) {
          throw new ProjectServiceError(
            "INVALID_INPUT",
            "team scope 는 orgUnitId 필수",
          );
        }
        const orgUnitIds = await da.orgUnitIdsForUser(actor.userId);
        if (!orgUnitIds.includes(input.orgUnitId)) {
          throw new ProjectServiceError(
            "INVALID_INPUT",
            "해당 org_unit 멤버 아님",
          );
        }
      }

      const project = await da.projects.insert({
        orgId: actor.orgId,
        ownerId: actor.userId,
        name: input.name,
        description: input.description ?? null,
        visibility: input.visibility,
        orgUnitId:
          input.visibility === "team" ? (input.orgUnitId ?? null) : null,
        archivedAt: null,
      });
      await da.projectMembers.upsert({
        projectId: project.id,
        userId: actor.userId,
        role: "owner",
        createdAt: new Date(),
      });
      return project;
    },

    getProjectForActor,

    async listProjectsForActor(
      actor: ProjectActor,
      filter?: { visibility?: Project["visibility"] },
    ): Promise<Project[]> {
      const [page, orgUnitIds] = await Promise.all([
        da.projects.list({
          orgId: actor.orgId,
          ...(filter?.visibility ? { visibility: filter.visibility } : {}),
        }),
        da.orgUnitIdsForUser(actor.userId),
      ]);
      const results: Project[] = [];
      for (const project of page.items) {
        const member = await da.projectMembers.byKey(project.id, actor.userId);
        if (canRead(project, actor, member, orgUnitIds)) results.push(project);
      }
      return results;
    },

    async updateProject(
      actor: ProjectActor,
      projectId: string,
      patch: Partial<
        Pick<Project, "name" | "description" | "visibility" | "archivedAt">
      >,
    ): Promise<Project> {
      const access = await requireAccess(actor, projectId);
      requireWrite(access);
      return da.projects.update(projectId, patch);
    },

    async deleteProject(actor: ProjectActor, projectId: string): Promise<void> {
      const access = await requireAccess(actor, projectId);
      requireAdmin(access);
      await da.projects.delete(projectId);
    },

    async listMembers(
      actor: ProjectActor,
      projectId: string,
    ): Promise<ProjectMember[]> {
      await requireAccess(actor, projectId);
      const page = await da.projectMembers.list({ projectId });
      return page.items;
    },

    async addMember(
      actor: ProjectActor,
      projectId: string,
      input: { userId: string; role: ProjectMember["role"] },
    ): Promise<ProjectMember> {
      const access = await requireAccess(actor, projectId);
      requireAdmin(access);
      return da.projectMembers.upsert({
        projectId,
        userId: input.userId,
        role: input.role,
        createdAt: new Date(),
      });
    },

    async removeMember(
      actor: ProjectActor,
      projectId: string,
      userId: string,
    ): Promise<void> {
      const access = await requireAccess(actor, projectId);
      requireAdmin(access);
      await da.projectMembers.deleteByKey(projectId, userId);
    },
  };
}
