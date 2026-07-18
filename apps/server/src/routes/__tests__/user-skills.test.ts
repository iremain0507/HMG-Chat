// user-skills.test.ts — P22-T6-18 (계약배치 C12) 사용자 작성 스킬 CRUD + enable/disable.
// 16-API-CONTRACT § 11 확장: POST /skills, PATCH /skills/:id, DELETE /skills/:id.
// 읽기 전용 SkillRegistry(파일시스템 빌트인)는 불변 — 사용자 스킬은 UserSkillStore 로 분리(RFC C12).
// 보안 조건(승인서 필수): permissions 는 항상 'user' 티어로 강제, entryPoint 는 샌드박스
//   상대경로만 허용(절대경로/`..`/스킴 거부) — 임의 스크립트 실행 경로를 열지 않는다.
import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import type { UserSkill, UserSkillStore } from "@wchat/interfaces";
import type { AuthedVariables } from "../../middleware/auth-middleware.js";
import { createSkillRoutes } from "../skills.js";
import { createSkillRegistry } from "../../tools/skills-engine.js";

/** in-memory UserSkillStore fake — 라우트 계약만 검증(DB 는 user-skill-data-access 소관). */
function fakeUserSkillStore(): UserSkillStore & { rows: UserSkill[] } {
  const rows: UserSkill[] = [];
  return {
    rows,
    async create(input) {
      const now = new Date();
      const row: UserSkill = {
        id: randomUUID(),
        orgId: input.orgId,
        userId: input.userId,
        name: input.name,
        version: input.version,
        skillMd: input.skillMd,
        enabled: true,
        createdAt: now,
        updatedAt: now,
      };
      rows.push(row);
      return row;
    },
    async update(id, input) {
      const row = rows.find((r) => r.id === id);
      if (!row) throw new Error("not found");
      if (input.skillMd !== undefined) row.skillMd = input.skillMd;
      if (input.name !== undefined) row.name = input.name;
      if (input.version !== undefined) row.version = input.version;
      row.updatedAt = new Date();
      return row;
    },
    async setEnabled(id, enabled) {
      const row = rows.find((r) => r.id === id);
      if (row) row.enabled = enabled;
    },
    async remove(id) {
      const idx = rows.findIndex((r) => r.id === id);
      if (idx >= 0) rows.splice(idx, 1);
    },
    async byId(id) {
      return rows.find((r) => r.id === id) ?? null;
    },
    async list(scope) {
      return rows.filter(
        (r) => r.orgId === scope.orgId && r.userId === scope.userId,
      );
    },
  };
}

function skillMd(
  fields: Record<string, string>,
  body = "이 스킬의 사용법 본문입니다.",
): string {
  const lines = Object.entries(fields).map(([k, v]) => `${k}: ${v}`);
  return `---\n${lines.join("\n")}\n---\n\n# ${fields.name}\n\n${body}\n`;
}

const VALID_MD = skillMd({
  name: "my-report",
  version: "1.0.0",
  description: "분기 실적 보고서를 자동 작성하는 사용자 스킬입니다.",
  entryPoint: "scripts/build.py",
});

function appWith(opts: {
  skillsDir?: string;
  userSkills: UserSkillStore;
  orgId: string;
  userId: string;
}) {
  const skillsDir = opts.skillsDir ?? mkdtempSync(join(tmpdir(), "us-empty-"));
  const routes = createSkillRoutes({
    registry: createSkillRegistry({ skillsDir }),
    skillsDir,
    userSkills: opts.userSkills,
  });
  const app = new Hono<{ Variables: AuthedVariables }>();
  app.use("*", async (c, next) => {
    c.set("auth", {
      sub: opts.userId,
      org: opts.orgId,
      role: "member",
      scope: "access",
      jti: "x",
    });
    await next();
  });
  app.route("/", routes);
  return app;
}

async function post(app: Hono<{ Variables: AuthedVariables }>, md: string) {
  return app.request("/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ skillMd: md }),
  });
}

describe("createSkillRoutes — 사용자 작성 스킬(C12)", () => {
  it("POST / — SKILL.md 를 올리면 파싱해 저장하고 목록에 나타난다", async () => {
    const store = fakeUserSkillStore();
    const app = appWith({
      userSkills: store,
      orgId: randomUUID(),
      userId: randomUUID(),
    });

    const res = await post(app, VALID_MD);
    expect(res.status).toBe(201);
    const created = (await res.json()) as {
      data: { id: string; name: string; version: string; enabled: boolean };
    };
    expect(created.data.name).toBe("my-report");
    expect(created.data.version).toBe("1.0.0");
    expect(created.data.enabled).toBe(true);

    const list = (await (await app.request("/")).json()) as {
      data: Array<{ id: string; source?: string }>;
    };
    expect(list.data.map((s) => s.id)).toContain("my-report@1.0.0");
    expect(list.data.find((s) => s.id === "my-report@1.0.0")?.source).toBe(
      "user",
    );
  });

  it("POST / — frontmatter 가 깨졌으면 400", async () => {
    const app = appWith({
      userSkills: fakeUserSkillStore(),
      orgId: randomUUID(),
      userId: randomUUID(),
    });
    const res = await post(app, "# 프론트매터 없는 문서\n\n본문만 있음.\n");
    expect(res.status).toBe(400);
  });

  it("POST / — 같은 org 에 같은 name@version 이 있으면 409", async () => {
    const store = fakeUserSkillStore();
    const orgId = randomUUID();
    const userId = randomUUID();
    const app = appWith({ userSkills: store, orgId, userId });

    expect((await post(app, VALID_MD)).status).toBe(201);
    expect((await post(app, VALID_MD)).status).toBe(409);
  });

  it("POST / — permissions 를 tool 로 올려도 user 티어로 강제된다(보안조건)", async () => {
    const app = appWith({
      userSkills: fakeUserSkillStore(),
      orgId: randomUUID(),
      userId: randomUUID(),
    });
    const res = await post(
      app,
      skillMd({
        name: "escalate",
        version: "1.0.0",
        description: "권한 상승을 시도하는 스킬 설명 텍스트입니다.",
        entryPoint: "scripts/run.py",
        permissions: "system",
      }),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { data: { permissions: string } };
    expect(body.data.permissions).toBe("user");
  });

  it.each([
    ["절대경로", "/etc/passwd"],
    ["상위경로 탈출", "../../server/src/app.ts"],
    ["원격 스킴", "http://evil.test/x.py"],
  ])("POST / — entryPoint %s 는 400(샌드박스 상대경로만)", async (_l, ep) => {
    const app = appWith({
      userSkills: fakeUserSkillStore(),
      orgId: randomUUID(),
      userId: randomUUID(),
    });
    const res = await post(
      app,
      skillMd({
        name: "bad-entry",
        version: "1.0.0",
        description: "샌드박스 밖을 가리키는 잘못된 진입점 스킬입니다.",
        entryPoint: ep,
      }),
    );
    expect(res.status).toBe(400);
  });

  it("PATCH /:id — 비활성화하면 목록(주입 대상)에서 빠진다", async () => {
    const store = fakeUserSkillStore();
    const app = appWith({
      userSkills: store,
      orgId: randomUUID(),
      userId: randomUUID(),
    });
    const created = (await (await post(app, VALID_MD)).json()) as {
      data: { skillId: string };
    };

    const res = await app.request(`/${created.data.skillId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: false }),
    });
    expect(res.status).toBe(200);

    const list = (await (await app.request("/")).json()) as {
      data: Array<{ id: string }>;
    };
    expect(list.data.map((s) => s.id)).not.toContain("my-report@1.0.0");

    // 관리 화면용 — includeDisabled=true 면 비활성 항목도 enabled:false 로 보인다.
    const all = (await (
      await app.request("/?includeDisabled=true")
    ).json()) as { data: Array<{ id: string; enabled?: boolean }> };
    expect(all.data.find((s) => s.id === "my-report@1.0.0")?.enabled).toBe(
      false,
    );
  });

  it("DELETE /:id — 삭제하면 목록에서 사라진다", async () => {
    const store = fakeUserSkillStore();
    const app = appWith({
      userSkills: store,
      orgId: randomUUID(),
      userId: randomUUID(),
    });
    const created = (await (await post(app, VALID_MD)).json()) as {
      data: { skillId: string };
    };

    const res = await app.request(`/${created.data.skillId}`, {
      method: "DELETE",
    });
    expect(res.status).toBe(204);
    expect(store.rows).toHaveLength(0);
  });

  it("PATCH/DELETE /:id — 다른 org 의 스킬은 404(existence-leak 방지)", async () => {
    const store = fakeUserSkillStore();
    const ownerApp = appWith({
      userSkills: store,
      orgId: randomUUID(),
      userId: randomUUID(),
    });
    const created = (await (await post(ownerApp, VALID_MD)).json()) as {
      data: { skillId: string };
    };

    const strangerApp = appWith({
      userSkills: store,
      orgId: randomUUID(),
      userId: randomUUID(),
    });
    const patch = await strangerApp.request(`/${created.data.skillId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: false }),
    });
    expect(patch.status).toBe(404);
    const del = await strangerApp.request(`/${created.data.skillId}`, {
      method: "DELETE",
    });
    expect(del.status).toBe(404);
    expect(store.rows).toHaveLength(1);
  });

  it("GET / — 빌트인(파일시스템) 스킬과 사용자 스킬이 함께 나온다", async () => {
    const skillsDir = mkdtempSync(join(tmpdir(), "us-builtin-"));
    mkdirSync(join(skillsDir, "wchat-pptx"), { recursive: true });
    writeFileSync(
      join(skillsDir, "wchat-pptx", "SKILL.md"),
      skillMd({
        name: "wchat-pptx",
        version: "1.0.0",
        description: "사내 표준 PPTX 템플릿을 생성하는 스킬입니다.",
        entryPoint: "skills/wchat-pptx/scripts/build.py",
      }),
    );
    const app = appWith({
      skillsDir,
      userSkills: fakeUserSkillStore(),
      orgId: randomUUID(),
      userId: randomUUID(),
    });
    await post(app, VALID_MD);

    const list = (await (await app.request("/")).json()) as {
      data: Array<{ id: string; source?: string }>;
    };
    expect(list.data.find((s) => s.id === "wchat-pptx@1.0.0")?.source).toBe(
      "builtin",
    );
    expect(list.data.find((s) => s.id === "my-report@1.0.0")?.source).toBe(
      "user",
    );
  });

  it("GET /:id/SKILL.md — 사용자 스킬은 DB 본문을 반환한다", async () => {
    const app = appWith({
      userSkills: fakeUserSkillStore(),
      orgId: randomUUID(),
      userId: randomUUID(),
    });
    await post(app, VALID_MD);

    const res = await app.request("/my-report@1.0.0/SKILL.md");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("이 스킬의 사용법 본문입니다.");
  });
});
