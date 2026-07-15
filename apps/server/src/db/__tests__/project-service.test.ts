// db/__tests__/project-service.test.ts — 08-SPRINT-PLAN.md § Phase 3 acceptance
// ("project-service.test.ts 권한 매트릭스 — viewer 가 settings 변경 불가 등") 단일 출처.
// InMemory ProjectDataAccess — 09-TDD-GUIDE.md § Mock vs Real 정책 (실 Postgres 불요, unit test).
import { describe, it, expect, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import type { Project, ProjectMember } from "@wchat/interfaces";
import {
  createProjectService,
  ProjectServiceError,
  type ProjectActor,
  type ProjectDataAccess,
} from "../project-service.js";

function makeInMemoryProjectDataAccess(): ProjectDataAccess {
  const projects = new Map<string, Project>();
  const members = new Map<string, ProjectMember>(); // key: `${projectId}:${userId}`
  const orgUnitsByUser = new Map<string, string[]>();

  return {
    projects: {
      async insert(data) {
        const row = {
          id: randomUUID(),
          archivedAt: null,
          createdAt: new Date(),
          ...data,
        } as Project;
        projects.set(row.id, row);
        return row;
      },
      async bulkInsert(rows) {
        return Promise.all(rows.map((r) => this.insert(r)));
      },
      async update(id, data) {
        const existing = projects.get(id);
        if (!existing) throw new Error("not found");
        const updated = { ...existing, ...data };
        projects.set(id, updated);
        return updated;
      },
      async delete(id) {
        projects.delete(id);
      },
      async byId(id) {
        return projects.get(id) ?? null;
      },
      async list(filter) {
        const items = [...projects.values()].filter(
          (p) =>
            (!filter?.orgId || p.orgId === filter.orgId) &&
            (!filter?.visibility || p.visibility === filter.visibility),
        );
        return { items };
      },
      async byOwner(userId) {
        return [...projects.values()].filter((p) => p.ownerId === userId);
      },
    },
    projectMembers: {
      async insert(data) {
        members.set(`${data.projectId}:${data.userId}`, data);
        return data;
      },
      async bulkInsert(rows) {
        return Promise.all(rows.map((r) => this.insert(r)));
      },
      async upsert(input) {
        members.set(`${input.projectId}:${input.userId}`, input);
        return input;
      },
      async byKey(projectId, userId) {
        return members.get(`${projectId}:${userId}`) ?? null;
      },
      async updateRole(projectId, userId, role) {
        const existing = members.get(`${projectId}:${userId}`);
        if (!existing) throw new Error("not found");
        const updated = { ...existing, role };
        members.set(`${projectId}:${userId}`, updated);
        return updated;
      },
      async deleteByKey(projectId, userId) {
        members.delete(`${projectId}:${userId}`);
      },
      async list(filter) {
        const items = [...members.values()].filter(
          (m) =>
            (!filter?.projectId || m.projectId === filter.projectId) &&
            (!filter?.userId || m.userId === filter.userId),
        );
        return { items };
      },
    },
    async orgUnitIdsForUser(userId) {
      return orgUnitsByUser.get(userId) ?? [];
    },
    __setOrgUnits(userId: string, unitIds: string[]) {
      orgUnitsByUser.set(userId, unitIds);
    },
  } as ProjectDataAccess & {
    __setOrgUnits(userId: string, unitIds: string[]): void;
  };
}

describe("project-service 권한 매트릭스", () => {
  let da: ReturnType<typeof makeInMemoryProjectDataAccess>;
  let svc: ReturnType<typeof createProjectService>;
  const orgId = randomUUID();
  const otherOrgId = randomUUID();
  const orgUnitId = randomUUID();
  const otherOrgUnitId = randomUUID();

  const owner: ProjectActor = { userId: randomUUID(), orgId };
  const editor: ProjectActor = { userId: randomUUID(), orgId };
  const viewer: ProjectActor = { userId: randomUUID(), orgId };
  const sameOrgUnitNonMember: ProjectActor = { userId: randomUUID(), orgId };
  const diffOrgUnitNonMember: ProjectActor = { userId: randomUUID(), orgId };
  const otherOrgActor: ProjectActor = {
    userId: randomUUID(),
    orgId: otherOrgId,
  };

  beforeEach(async () => {
    da = makeInMemoryProjectDataAccess();
    da.__setOrgUnits(owner.userId, [orgUnitId]);
    da.__setOrgUnits(sameOrgUnitNonMember.userId, [orgUnitId]);
    da.__setOrgUnits(diffOrgUnitNonMember.userId, [otherOrgUnitId]);
    svc = createProjectService(da);
  });

  describe("createProjectWithOwner", () => {
    it("생성한 actor 가 owner row 로 자동 등록된다", async () => {
      const project = await svc.createProjectWithOwner(owner, {
        name: "P1",
        visibility: "private",
      });
      const member = await da.projectMembers.byKey(project.id, owner.userId);
      expect(member?.role).toBe("owner");
      expect(project.ownerId).toBe(owner.userId);
      expect(project.orgId).toBe(owner.orgId);
    });

    it("visibility=team 인데 orgUnitId 누락 → INVALID_INPUT", async () => {
      await expect(
        svc.createProjectWithOwner(owner, { name: "P2", visibility: "team" }),
      ).rejects.toThrow(ProjectServiceError);
      await expect(
        svc.createProjectWithOwner(owner, { name: "P2", visibility: "team" }),
      ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    });

    it("orgUnitId 가 actor 의 user_org_units 에 없음 → INVALID_INPUT", async () => {
      await expect(
        svc.createProjectWithOwner(sameOrgUnitNonMember, {
          name: "P3",
          visibility: "team",
          orgUnitId: otherOrgUnitId,
        }),
      ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    });

    it("team + 소속 org_unit → 생성 성공", async () => {
      const project = await svc.createProjectWithOwner(sameOrgUnitNonMember, {
        name: "P4",
        visibility: "team",
        orgUnitId,
      });
      expect(project.orgUnitId).toBe(orgUnitId);
    });
  });

  describe("권한 매트릭스 (write/admin)", () => {
    let projectId: string;

    beforeEach(async () => {
      const project = await svc.createProjectWithOwner(owner, {
        name: "Matrix",
        visibility: "org",
      });
      projectId = project.id;
      await da.projectMembers.upsert({
        projectId,
        userId: editor.userId,
        role: "editor",
        createdAt: new Date(),
      });
      await da.projectMembers.upsert({
        projectId,
        userId: viewer.userId,
        role: "viewer",
        createdAt: new Date(),
      });
    });

    it("viewer 는 project 설정 변경 불가", async () => {
      await expect(
        svc.updateProject(viewer, projectId, { name: "renamed" }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    it("editor 는 project 설정 변경 가능", async () => {
      const updated = await svc.updateProject(editor, projectId, {
        name: "renamed-by-editor",
      });
      expect(updated.name).toBe("renamed-by-editor");
    });

    it("owner 는 project 설정 변경 가능", async () => {
      const updated = await svc.updateProject(owner, projectId, {
        name: "renamed-by-owner",
      });
      expect(updated.name).toBe("renamed-by-owner");
    });

    it("editor 는 project 삭제 불가 (owner 전용)", async () => {
      await expect(svc.deleteProject(editor, projectId)).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
    });

    it("owner 는 project 삭제 가능", async () => {
      await svc.deleteProject(owner, projectId);
      expect(await da.projects.byId(projectId)).toBeNull();
    });

    it("editor 는 멤버 추가 불가 (owner 전용)", async () => {
      await expect(
        svc.addMember(editor, projectId, {
          userId: randomUUID(),
          role: "viewer",
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    it("owner 는 멤버 추가/역할 변경 가능", async () => {
      const newMemberId = randomUUID();
      const member = await svc.addMember(owner, projectId, {
        userId: newMemberId,
        role: "viewer",
      });
      expect(member.role).toBe("viewer");
    });

    it("owner 는 멤버 제거 가능, viewer 는 불가", async () => {
      await expect(
        svc.removeMember(viewer, projectId, editor.userId),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await svc.removeMember(owner, projectId, editor.userId);
      expect(
        await da.projectMembers.byKey(projectId, editor.userId),
      ).toBeNull();
    });
  });

  describe("read 권한 (visibility 매트릭스와 정합)", () => {
    it("private 프로젝트는 non-member 에게 안 보인다 (null 반환)", async () => {
      const project = await svc.createProjectWithOwner(owner, {
        name: "Priv",
        visibility: "private",
      });
      const found = await svc.getProjectForActor(viewer, project.id);
      expect(found).toBeNull();
    });

    it("team 프로젝트는 같은 org_unit non-member 에게 보인다", async () => {
      const project = await svc.createProjectWithOwner(owner, {
        name: "Team",
        visibility: "team",
        orgUnitId,
      });
      const found = await svc.getProjectForActor(
        sameOrgUnitNonMember,
        project.id,
      );
      expect(found?.project.id).toBe(project.id);
    });

    it("team 프로젝트는 다른 org_unit non-member 에게 안 보인다", async () => {
      const project = await svc.createProjectWithOwner(owner, {
        name: "Team2",
        visibility: "team",
        orgUnitId,
      });
      const found = await svc.getProjectForActor(
        diffOrgUnitNonMember,
        project.id,
      );
      expect(found).toBeNull();
    });

    it("org 프로젝트는 같은 org 의 모든 non-member 에게 보인다", async () => {
      const project = await svc.createProjectWithOwner(owner, {
        name: "Org",
        visibility: "org",
      });
      const found = await svc.getProjectForActor(
        diffOrgUnitNonMember,
        project.id,
      );
      expect(found?.project.id).toBe(project.id);
    });

    it("다른 org 사용자에게는 어떤 visibility 든 안 보인다", async () => {
      const project = await svc.createProjectWithOwner(owner, {
        name: "OrgWide",
        visibility: "org",
      });
      const found = await svc.getProjectForActor(otherOrgActor, project.id);
      expect(found).toBeNull();
    });
  });
});
