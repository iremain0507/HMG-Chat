// routes/projects.ts — 16-API-CONTRACT.md § 4 Projects 단일 출처.
// db/project-service.ts 가 visibility/role 권한 매트릭스를 강제하므로, 여기선 HTTP 계층
// (파싱/상태코드 매핑)만 담당한다. NOT_FOUND/FORBIDDEN 은 둘 다 404 로 매핑해
// existence-leak 을 방지한다 (private/team 프로젝트 존재 여부를 다른 org 에 노출하지 않음).
import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import type { AuthedVariables } from "../middleware/auth-middleware.js";
import {
  ProjectServiceError,
  createProjectService,
  type ProjectDataAccess,
} from "../db/project-service.js";

function errorJson(code: string, message: string) {
  return {
    error: { code, category: "http" as const, message, retryable: false },
  };
}

export function createProjectRoutes(da: ProjectDataAccess): Hono<{
  Variables: AuthedVariables;
}> {
  const app = new Hono<{ Variables: AuthedVariables }>();
  const service = createProjectService(da);

  function actorOf(c: { get(key: "auth"): AuthedVariables["auth"] }) {
    const auth = c.get("auth");
    return { userId: auth.sub, orgId: auth.org };
  }

  function handleServiceError(err: unknown): {
    body: ReturnType<typeof errorJson>;
    status: 400 | 403 | 404;
  } {
    if (err instanceof ProjectServiceError) {
      if (err.code === "INVALID_INPUT") {
        return { body: errorJson(err.code, err.message), status: 400 };
      }
      // FORBIDDEN 도 404 로 매핑 — existence-leak 방지 (private/team 프로젝트 존재 자체를 숨김).
      return { body: errorJson("NOT_FOUND", err.message), status: 404 };
    }
    throw err;
  }

  app.post("/", async (c) => {
    const body = await c.req
      .json<{
        name?: string;
        description?: string;
        visibility?: "private" | "team" | "org";
        orgUnitId?: string;
      }>()
      .catch(() => ({}) as Record<string, never>);
    if (!body.name || !body.visibility) {
      return c.json(
        errorJson("INVALID_INPUT", "name/visibility 가 필요합니다."),
        400,
      );
    }
    try {
      const project = await service.createProjectWithOwner(actorOf(c), {
        name: body.name,
        description: body.description ?? null,
        visibility: body.visibility,
        ...(body.orgUnitId ? { orgUnitId: body.orgUnitId } : {}),
      });
      return c.json({ data: project, meta: { requestId: randomUUID() } }, 201);
    } catch (err) {
      const { body: errBody, status } = handleServiceError(err);
      return c.json(errBody, status);
    }
  });

  app.get("/", async (c) => {
    const visibility = c.req.query("visibility") as
      "private" | "team" | "org" | undefined;
    const projects = await service.listProjectsForActor(
      actorOf(c),
      visibility ? { visibility } : undefined,
    );
    return c.json({ data: projects, meta: { requestId: randomUUID() } });
  });

  app.get("/:id", async (c) => {
    const found = await service.getProjectForActor(
      actorOf(c),
      c.req.param("id"),
    );
    if (!found) {
      return c.json(
        errorJson("NOT_FOUND", "프로젝트를 찾을 수 없습니다."),
        404,
      );
    }
    return c.json({ data: found.project, meta: { requestId: randomUUID() } });
  });

  app.patch("/:id", async (c) => {
    const body = await c.req
      .json<{
        name?: string;
        description?: string;
        visibility?: "private" | "team" | "org";
        archivedAt?: string | null;
      }>()
      .catch(() => ({}) as Record<string, never>);
    try {
      const project = await service.updateProject(
        actorOf(c),
        c.req.param("id"),
        {
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.description !== undefined
            ? { description: body.description }
            : {}),
          ...(body.visibility !== undefined
            ? { visibility: body.visibility }
            : {}),
          ...(body.archivedAt !== undefined
            ? { archivedAt: body.archivedAt ? new Date(body.archivedAt) : null }
            : {}),
        },
      );
      return c.json({ data: project, meta: { requestId: randomUUID() } });
    } catch (err) {
      const { body: errBody, status } = handleServiceError(err);
      return c.json(errBody, status);
    }
  });

  app.delete("/:id", async (c) => {
    try {
      await service.deleteProject(actorOf(c), c.req.param("id"));
      return c.body(null, 204);
    } catch (err) {
      const { body: errBody, status } = handleServiceError(err);
      return c.json(errBody, status);
    }
  });

  app.get("/:id/members", async (c) => {
    try {
      const members = await service.listMembers(actorOf(c), c.req.param("id"));
      return c.json({ data: members, meta: { requestId: randomUUID() } });
    } catch (err) {
      const { body: errBody, status } = handleServiceError(err);
      return c.json(errBody, status);
    }
  });

  app.post("/:id/members", async (c) => {
    const body = await c.req
      .json<{ userId?: string; role?: "owner" | "editor" | "viewer" }>()
      .catch(() => ({}) as Record<string, never>);
    if (!body.userId || !body.role) {
      return c.json(
        errorJson("INVALID_INPUT", "userId/role 이 필요합니다."),
        400,
      );
    }
    try {
      const member = await service.addMember(actorOf(c), c.req.param("id"), {
        userId: body.userId,
        role: body.role,
      });
      return c.json({ data: member, meta: { requestId: randomUUID() } }, 201);
    } catch (err) {
      const { body: errBody, status } = handleServiceError(err);
      return c.json(errBody, status);
    }
  });

  app.delete("/:id/members/:userId", async (c) => {
    try {
      await service.removeMember(
        actorOf(c),
        c.req.param("id"),
        c.req.param("userId"),
      );
      return c.body(null, 204);
    } catch (err) {
      const { body: errBody, status } = handleServiceError(err);
      return c.json(errBody, status);
    }
  });

  return app;
}
