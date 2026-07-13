// skill-assets.test.ts — P8-T5-02 RED: routes/skill-assets.ts 가 createSkillAssetRoutes 를
// export 하지 않음. 16-API-CONTRACT § 11 GET /skill-assets/:skillId/:filename — binary.
import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import type { SkillAssetRecord } from "@wchat/interfaces";
import type { AuthedVariables } from "../../middleware/auth-middleware.js";
import { createSkillAssetRoutes } from "../skill-assets.js";
import type { SkillAssetDataAccess } from "../../db/skill-asset-data-access.js";
import { createInMemoryObjectStore } from "../../lib/object-store.js";

function makeDa(): SkillAssetDataAccess {
  const rows: SkillAssetRecord[] = [];
  return {
    skillAssets: {
      async insert(data) {
        rows.push(data);
        return data;
      },
      async bulkInsert(items) {
        return Promise.all(items.map((r) => this.insert(r)));
      },
      async byKey(skillId, filename) {
        return (
          rows.find((r) => r.skillId === skillId && r.filename === filename) ??
          null
        );
      },
      async bySkill(skillId) {
        return rows.filter((r) => r.skillId === skillId);
      },
      async deleteByKey(skillId, filename) {
        const idx = rows.findIndex(
          (r) => r.skillId === skillId && r.filename === filename,
        );
        if (idx !== -1) rows.splice(idx, 1);
      },
      async deleteBySkill(skillId) {
        const before = rows.length;
        for (let i = rows.length - 1; i >= 0; i--) {
          if (rows[i].skillId === skillId) rows.splice(i, 1);
        }
        return before - rows.length;
      },
      async list(filter) {
        return {
          items: rows.filter(
            (r) => !filter?.skillId || r.skillId === filter.skillId,
          ),
        };
      },
    },
  };
}

function appWith(
  da: SkillAssetDataAccess,
  objectStore = createInMemoryObjectStore(),
) {
  const routes = createSkillAssetRoutes({ da, objectStore });
  const app = new Hono<{ Variables: AuthedVariables }>();
  app.route("/", routes);
  return { app, objectStore };
}

describe("createSkillAssetRoutes", () => {
  it("GET /:skillId/:filename — 등록된 asset 은 바이트를 반환한다", async () => {
    const da = makeDa();
    const { app, objectStore } = appWith(da);
    await objectStore.put(
      "skills/wchat-pptx@1.0.0/logo.png",
      Buffer.from("PNGDATA"),
    );
    await da.skillAssets.insert({
      skillId: "wchat-pptx@1.0.0",
      filename: "logo.png",
      contentType: "image/png",
      sizeBytes: 7,
      s3Key: "skills/wchat-pptx@1.0.0/logo.png",
      createdAt: new Date(),
    });

    const res = await app.request("/wchat-pptx@1.0.0/logo.png");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(await res.text()).toBe("PNGDATA");
  });

  it("GET /:skillId/:filename — 없는 asset 은 404", async () => {
    const da = makeDa();
    const { app } = appWith(da);

    const res = await app.request("/wchat-pptx@1.0.0/nope.png");
    expect(res.status).toBe(404);
  });
});
