// db/skill-asset-data-access.ts 의 SkillAssetRepo pg 구현체 — 06-DATA-MODEL.md § 0009 /
// 14-INTERFACES.md SkillAssetRepo 단일 출처. skill_assets 는 composite PK(skill_id, filename),
// skill_id 는 FK 없는 TEXT(스킬 마켓플레이스 id) — org/user 셋업 불요.
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { pgPool } from "../../db/client";
import { createPgSkillAssetDataAccess } from "../../db/skill-asset-data-access";

describe("skill-asset-data-access (SkillAssetRepo)", () => {
  const da = createPgSkillAssetDataAccess();
  const skillId = `wchat-pptx-${randomUUID()}@1.0.0`;

  afterEach(async () => {
    await pgPool.query("DELETE FROM skill_assets WHERE skill_id = $1", [
      skillId,
    ]);
  });

  it("insert 후 byKey 로 조회된다", async () => {
    const created = await da.skillAssets.insert({
      skillId,
      filename: "template.pptx",
      contentType:
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      sizeBytes: 12345,
      s3Key: `skills/${skillId}/template.pptx`,
      createdAt: new Date(),
    });
    expect(created.filename).toBe("template.pptx");

    const found = await da.skillAssets.byKey(skillId, "template.pptx");
    expect(found?.s3Key).toBe(`skills/${skillId}/template.pptx`);
    expect(found?.sizeBytes).toBe(12345);
  });

  it("byKey — 존재하지 않으면 null", async () => {
    expect(await da.skillAssets.byKey(skillId, "nope.bin")).toBeNull();
  });

  it("bulkInsert + bySkill 은 skillId 의 모든 asset 을 반환한다", async () => {
    await da.skillAssets.bulkInsert([
      {
        skillId,
        filename: "a.png",
        contentType: "image/png",
        sizeBytes: 10,
        s3Key: `skills/${skillId}/a.png`,
        createdAt: new Date(),
      },
      {
        skillId,
        filename: "b.png",
        contentType: "image/png",
        sizeBytes: 20,
        s3Key: `skills/${skillId}/b.png`,
        createdAt: new Date(),
      },
    ]);
    const rows = await da.skillAssets.bySkill(skillId);
    expect(rows.map((r) => r.filename).sort()).toEqual(["a.png", "b.png"]);
  });

  it("deleteByKey 는 하나만 제거한다", async () => {
    await da.skillAssets.insert({
      skillId,
      filename: "c.png",
      contentType: "image/png",
      sizeBytes: 1,
      s3Key: `skills/${skillId}/c.png`,
      createdAt: new Date(),
    });
    await da.skillAssets.deleteByKey(skillId, "c.png");
    expect(await da.skillAssets.byKey(skillId, "c.png")).toBeNull();
  });

  it("deleteBySkill 은 삭제된 row 수를 반환한다", async () => {
    await da.skillAssets.bulkInsert([
      {
        skillId,
        filename: "d.png",
        contentType: "image/png",
        sizeBytes: 1,
        s3Key: `skills/${skillId}/d.png`,
        createdAt: new Date(),
      },
      {
        skillId,
        filename: "e.png",
        contentType: "image/png",
        sizeBytes: 1,
        s3Key: `skills/${skillId}/e.png`,
        createdAt: new Date(),
      },
    ]);
    const count = await da.skillAssets.deleteBySkill(skillId);
    expect(count).toBe(2);
    expect(await da.skillAssets.bySkill(skillId)).toEqual([]);
  });

  it("list 는 skillId filter 를 적용한다", async () => {
    await da.skillAssets.insert({
      skillId,
      filename: "f.png",
      contentType: "image/png",
      sizeBytes: 1,
      s3Key: `skills/${skillId}/f.png`,
      createdAt: new Date(),
    });
    const page = await da.skillAssets.list({ skillId });
    expect(page.items).toHaveLength(1);
    expect(page.items[0].filename).toBe("f.png");
  });
});
