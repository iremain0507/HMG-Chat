// routes/folders.ts — P19-T1-03: 세션 폴더 CRUD(16-API-CONTRACT 확장, migration 0019
// session_folders 단일 출처). 폴더는 개인 소유(org 공유 아님, 0019 주석 참조) — org_id+
// created_by 이중 조건은 db/session-folder-data-access.ts 가 담당, 여기선 HTTP 계층만.
import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import type { AuthedVariables } from "../middleware/auth-middleware.js";
import {
  createPgSessionFolderDataAccess,
  CircularFolderReferenceError,
  type SessionFolder,
  type SessionFolderDataAccess,
} from "../db/session-folder-data-access.js";

function errorJson(code: string, message: string) {
  return {
    error: { code, category: "http" as const, message, retryable: false },
  };
}

function toWire(folder: SessionFolder) {
  return {
    id: folder.id,
    name: folder.name,
    systemPrompt: folder.systemPrompt,
    parentFolderId: folder.parentFolderId,
    createdAt: folder.createdAt.toISOString(),
  };
}

export interface FolderRoutesDeps {
  folders?: SessionFolderDataAccess;
}

export function createFolderRoutes(
  deps: FolderRoutesDeps = {},
): Hono<{ Variables: AuthedVariables }> {
  const folders = deps.folders ?? createPgSessionFolderDataAccess();
  const app = new Hono<{ Variables: AuthedVariables }>();

  app.post("/", async (c) => {
    const auth = c.get("auth");
    const body = await c.req
      .json<{
        name?: string;
        systemPrompt?: string | null;
        parentFolderId?: string | null;
      }>()
      .catch(
        () =>
          ({}) as {
            name?: string;
            systemPrompt?: string | null;
            parentFolderId?: string | null;
          },
      );
    const name = body.name?.trim();
    if (!name) {
      return c.json(errorJson("INVALID_INPUT", "name 이 필요합니다."), 400);
    }
    if (body.parentFolderId) {
      const parent = await folders.byIdForOwner(
        auth.org,
        auth.sub,
        body.parentFolderId,
      );
      if (!parent) {
        return c.json(
          errorJson("INVALID_INPUT", "parentFolderId 를 찾을 수 없습니다."),
          400,
        );
      }
    }
    const folder = await folders.create(
      auth.org,
      auth.sub,
      name,
      body.systemPrompt,
      body.parentFolderId,
    );
    return c.json(
      { data: toWire(folder), meta: { requestId: randomUUID() } },
      201,
    );
  });

  app.get("/", async (c) => {
    const auth = c.get("auth");
    const list = await folders.list(auth.org, auth.sub);
    return c.json({
      data: list.map(toWire),
      meta: { requestId: randomUUID() },
    });
  });

  app.patch("/:id", async (c) => {
    const auth = c.get("auth");
    const id = c.req.param("id");
    const body = await c.req
      .json<{
        name?: string;
        systemPrompt?: string | null;
        parentFolderId?: string | null;
      }>()
      .catch(
        () =>
          ({}) as {
            name?: string;
            systemPrompt?: string | null;
            parentFolderId?: string | null;
          },
      );
    const name = body.name?.trim();
    const hasSystemPrompt = body.systemPrompt !== undefined;
    const hasParentFolderId = body.parentFolderId !== undefined;
    if (!name && !hasSystemPrompt && !hasParentFolderId) {
      return c.json(
        errorJson(
          "INVALID_INPUT",
          "name, systemPrompt 또는 parentFolderId 가 필요합니다.",
        ),
        400,
      );
    }
    if (hasParentFolderId && body.parentFolderId) {
      const parent = await folders.byIdForOwner(
        auth.org,
        auth.sub,
        body.parentFolderId,
      );
      if (!parent) {
        return c.json(
          errorJson("INVALID_INPUT", "parentFolderId 를 찾을 수 없습니다."),
          400,
        );
      }
    }
    let updated: SessionFolder | null;
    try {
      updated = await folders.updateForOwner(auth.org, auth.sub, id, {
        ...(name ? { name } : {}),
        ...(hasSystemPrompt ? { systemPrompt: body.systemPrompt } : {}),
        ...(hasParentFolderId ? { parentFolderId: body.parentFolderId } : {}),
      });
    } catch (err) {
      if (err instanceof CircularFolderReferenceError) {
        return c.json(errorJson("INVALID_INPUT", err.message), 400);
      }
      throw err;
    }
    if (!updated) {
      return c.json(errorJson("NOT_FOUND", "폴더를 찾을 수 없습니다."), 404);
    }
    return c.json({ data: toWire(updated), meta: { requestId: randomUUID() } });
  });

  app.delete("/:id", async (c) => {
    const auth = c.get("auth");
    const id = c.req.param("id");
    const deleted = await folders.deleteForOwner(auth.org, auth.sub, id);
    if (!deleted) {
      return c.json(errorJson("NOT_FOUND", "폴더를 찾을 수 없습니다."), 404);
    }
    return c.body(null, 204);
  });

  return app;
}
