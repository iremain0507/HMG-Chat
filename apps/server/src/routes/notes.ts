// routes/notes.ts — 노트 워크스페이스 REST (P22-T6-17, 계약 승인 C7).
// Open WebUI 의 Notes(마크다운 문서 + AI 개선 + 채팅으로 보내기) 파리티.
// 승인 범위(C7): CRUD + 마크다운 에디터 + 채팅 컨텍스트 주입 + AI-enhance(C10 승인분과 동일 패턴).
//
// 설계:
//   - db/note-data-access.ts 는 RLS 를 superuser role 로 우회하므로, org 경계와 소유자 경계는
//     이 라우트가 application 레벨에서 강제한다. 남의 노트는 403 이 아니라 404 —
//     routes/agents.ts 와 동일한 existence-leak 방지 패턴.
//   - 노트는 공유 개념이 없다(작성자 전용). 공유가 필요해지면 별도 계약 단위로.
//   - enhance 는 routes/completions.ts(C10) 의 "짧은 보조 LLM 호출" 패턴을 그대로 따른다:
//     턴을 저장하지 않고, 도구 없이, 스트리밍 없이 한 번에 개선본을 만든다.
//     다만 fail-soft 가 아니다 — 자동완성과 달리 사용자가 명시적으로 누른 액션이라
//     실패를 조용히 삼키면 "아무 일도 안 일어난 것"처럼 보인다(21-LOOP-LESSONS L2 의 반대 방향).
import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import type { LLMMessage, LLMProvider, Note } from "@wchat/interfaces";
import type { AuthedVariables } from "../middleware/auth-middleware.js";
import type { NoteDataAccess } from "../db/note-data-access.js";

const DEFAULT_TITLE = "제목 없는 노트";
const MAX_TITLE_CHARS = 200;
const MAX_CONTENT_CHARS = 100_000;
const ENHANCE_MAX_TOKENS = 4096;

const ENHANCE_SYSTEM_PROMPT = `너는 사용자의 마크다운 노트를 다듬는 편집자다. 규칙:
- 원문의 의미·사실·의도를 바꾸지 말고 구조와 표현만 개선한다.
- 결과는 마크다운 본문 자체만 출력한다. 설명·머리말·코드펜스로 감싸기 금지.
- 사용자가 별도 지시를 주면 그 지시를 최우선으로 따른다.`;

function errorJson(code: string, message: string) {
  return {
    error: { code, category: "http" as const, message, retryable: false },
  };
}

function toDto(note: Note) {
  return {
    id: note.id,
    orgId: note.orgId,
    userId: note.userId,
    title: note.title,
    content: note.content,
    createdAt: note.createdAt.toISOString(),
    updatedAt: note.updatedAt.toISOString(),
  };
}

/** 문자열이면 잘라서 돌려주고, 아니면 undefined(=400 으로 잡는다). */
function boundedString(v: unknown, max: number): string | undefined {
  if (typeof v !== "string") return undefined;
  return v.slice(0, max);
}

export interface CreateNoteRoutesDeps {
  da: NoteDataAccess;
  /** 미주입이면 /:id/enhance 가 503 — LLM 미구성 환경에서도 CRUD 는 동작해야 한다. */
  provider?: LLMProvider;
  model?: string;
}

export function createNoteRoutes(
  deps: CreateNoteRoutesDeps,
): Hono<{ Variables: AuthedVariables }> {
  const app = new Hono<{ Variables: AuthedVariables }>();

  function actorOf(c: { get(key: "auth"): AuthedVariables["auth"] }) {
    const auth = c.get("auth");
    return { userId: auth.sub, orgId: auth.org };
  }

  /** 같은 org + 본인 소유인 것만 실재로 취급 — 아니면 null(=404). */
  async function ownedByActor(
    actor: { orgId: string; userId: string },
    id: string,
  ): Promise<Note | null> {
    const found = await deps.da.notes.byId(id);
    if (!found || found.orgId !== actor.orgId) return null;
    if (found.userId !== actor.userId) return null;
    return found;
  }

  app.post("/", async (c) => {
    const body = (await c.req.json().catch(() => null)) ?? {};
    if (typeof body !== "object") {
      return c.json(errorJson("INVALID_INPUT", "본문이 필요합니다."), 400);
    }
    if (body.title !== undefined && typeof body.title !== "string") {
      return c.json(
        errorJson("INVALID_INPUT", "title 은 문자열이어야 합니다."),
        400,
      );
    }
    if (body.content !== undefined && typeof body.content !== "string") {
      return c.json(
        errorJson("INVALID_INPUT", "content 는 문자열이어야 합니다."),
        400,
      );
    }

    const actor = actorOf(c);
    const title = (boundedString(body.title, MAX_TITLE_CHARS) ?? "").trim();
    const created = await deps.da.notes.insert({
      orgId: actor.orgId,
      userId: actor.userId,
      title: title === "" ? DEFAULT_TITLE : title,
      content: boundedString(body.content, MAX_CONTENT_CHARS) ?? "",
    });
    return c.json(
      { data: toDto(created), meta: { requestId: randomUUID() } },
      201,
    );
  });

  app.get("/", async (c) => {
    const actor = actorOf(c);
    const page = await deps.da.notes.list({
      orgId: actor.orgId,
      userId: actor.userId,
    });
    return c.json({
      data: page.items.map(toDto),
      meta: { requestId: randomUUID() },
    });
  });

  app.get("/:id", async (c) => {
    const actor = actorOf(c);
    const found = await ownedByActor(actor, c.req.param("id"));
    if (!found) {
      return c.json(errorJson("NOT_FOUND", "노트를 찾을 수 없습니다."), 404);
    }
    return c.json({ data: toDto(found), meta: { requestId: randomUUID() } });
  });

  app.patch("/:id", async (c) => {
    const actor = actorOf(c);
    const existing = await ownedByActor(actor, c.req.param("id"));
    if (!existing) {
      return c.json(errorJson("NOT_FOUND", "노트를 찾을 수 없습니다."), 404);
    }
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return c.json(errorJson("INVALID_INPUT", "본문이 필요합니다."), 400);
    }
    if (body.title !== undefined && typeof body.title !== "string") {
      return c.json(
        errorJson("INVALID_INPUT", "title 은 문자열이어야 합니다."),
        400,
      );
    }
    if (body.content !== undefined && typeof body.content !== "string") {
      return c.json(
        errorJson("INVALID_INPUT", "content 는 문자열이어야 합니다."),
        400,
      );
    }

    const patch: Partial<Note> = {};
    const title = boundedString(body.title, MAX_TITLE_CHARS);
    if (title !== undefined) {
      patch.title = title.trim() === "" ? DEFAULT_TITLE : title;
    }
    const content = boundedString(body.content, MAX_CONTENT_CHARS);
    if (content !== undefined) patch.content = content;

    const updated = await deps.da.notes.update(existing.id, patch);
    return c.json({ data: toDto(updated), meta: { requestId: randomUUID() } });
  });

  app.delete("/:id", async (c) => {
    const actor = actorOf(c);
    const existing = await ownedByActor(actor, c.req.param("id"));
    if (!existing) {
      return c.json(errorJson("NOT_FOUND", "노트를 찾을 수 없습니다."), 404);
    }
    await deps.da.notes.delete(existing.id);
    return c.body(null, 204);
  });

  // AI 개선 — 노트 본문을 LLM 으로 다듬어 저장하고 갱신된 노트를 돌려준다.
  // 소유권 확인이 provider 호출보다 먼저다(남의 노트로 LLM 비용을 태우지 않는다).
  app.post("/:id/enhance", async (c) => {
    const actor = actorOf(c);
    const existing = await ownedByActor(actor, c.req.param("id"));
    if (!existing) {
      return c.json(errorJson("NOT_FOUND", "노트를 찾을 수 없습니다."), 404);
    }
    const { provider, model } = deps;
    if (!provider || !model) {
      return c.json(
        errorJson(
          "SERVICE_UNAVAILABLE",
          "AI 개선 기능이 구성돼 있지 않습니다.",
        ),
        503,
      );
    }

    const body = (await c.req.json().catch(() => null)) ?? {};
    const instruction =
      typeof body?.instruction === "string" ? body.instruction.trim() : "";

    const messages: LLMMessage[] = [
      ...(instruction
        ? [{ role: "user" as const, content: `지시:\n${instruction}` }]
        : []),
      { role: "user" as const, content: `노트 본문:\n${existing.content}` },
    ];

    let text = "";
    try {
      for await (const event of provider.chat(
        {
          model,
          systemBlocks: [{ tier: "system", content: ENHANCE_SYSTEM_PROMPT }],
          messages,
          maxTokens: ENHANCE_MAX_TOKENS,
        },
        c.req.raw.signal,
      )) {
        if (event.type === "text_delta") text += event.text;
      }
    } catch {
      // 명시적 사용자 액션이라 조용히 삼키지 않는다 — 노트도 건드리지 않는다.
      return c.json(
        errorJson("UPSTREAM_ERROR", "AI 개선에 실패했습니다."),
        502,
      );
    }

    const improved = text.trim();
    if (improved === "") {
      return c.json(
        errorJson("UPSTREAM_ERROR", "AI 가 빈 응답을 반환했습니다."),
        502,
      );
    }

    const updated = await deps.da.notes.update(existing.id, {
      content: improved.slice(0, MAX_CONTENT_CHARS),
    });
    return c.json({ data: toDto(updated), meta: { requestId: randomUUID() } });
  });

  return app;
}
