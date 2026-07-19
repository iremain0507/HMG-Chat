// session-folder-nested-composition.test.ts — P20-T1-06 acceptance: session_folders
// (migration 0029 parent_folder_id) 의 pg 데이터접근 계층이 부모 지정 생성/조회에서
// parentFolderId 를 정확히 왕복시키고, 자기참조·순환(조상 체인) 시도를 애플리케이션 레벨에서
// 거부하는지 실 Postgres 로 검증한다(HTTP 라우트/UI 는 별도 스코프).
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pgPool } from "../../db/client.js";
import {
  createPgSessionFolderDataAccess,
  CircularFolderReferenceError,
} from "../../db/session-folder-data-access.js";

describe("session_folders 중첩(parent_folder_id) — P20-T1-06", () => {
  const org = {
    id: randomUUID(),
    domain: `org-nf-${randomUUID()}.example.com`,
  };
  const user = { id: randomUUID(), email: "" };
  const folders = createPgSessionFolderDataAccess();

  beforeAll(async () => {
    await pgPool.query(
      "INSERT INTO organizations (id, name, domain) VALUES ($1, 'Org NF', $2)",
      [org.id, org.domain],
    );
    user.email = `user-nf-${randomUUID()}@${org.domain}`;
    await pgPool.query(
      "INSERT INTO users (id, org_id, email) VALUES ($1, $2, $3)",
      [user.id, org.id, user.email],
    );
  });

  afterAll(async () => {
    await pgPool.query("DELETE FROM session_folders WHERE org_id = $1", [
      org.id,
    ]);
    await pgPool.query("DELETE FROM users WHERE id = $1", [user.id]);
    await pgPool.query("DELETE FROM organizations WHERE id = $1", [org.id]);
  });

  it("부모 지정 생성 후 list/byIdForOwner 가 parentFolderId 를 반환한다", async () => {
    const parent = await folders.create(org.id, user.id, "부모");
    const child = await folders.create(
      org.id,
      user.id,
      "자식",
      undefined,
      parent.id,
    );
    expect(child.parentFolderId).toBe(parent.id);

    const list = await folders.list(org.id, user.id);
    const listedChild = list.find((f) => f.id === child.id);
    expect(listedChild?.parentFolderId).toBe(parent.id);

    const fetched = await folders.byIdForOwner(org.id, user.id, child.id);
    expect(fetched?.parentFolderId).toBe(parent.id);
  });

  it("updateForOwner 로 parentFolderId 를 재지정(이동)할 수 있다", async () => {
    const folderA = await folders.create(org.id, user.id, "A");
    const folderB = await folders.create(org.id, user.id, "B");
    const updated = await folders.updateForOwner(org.id, user.id, folderB.id, {
      parentFolderId: folderA.id,
    });
    expect(updated?.parentFolderId).toBe(folderA.id);

    const moved = await folders.updateForOwner(org.id, user.id, folderB.id, {
      parentFolderId: null,
    });
    expect(moved?.parentFolderId).toBeNull();
  });

  it("자기 자신을 부모로 지정하면 CircularFolderReferenceError 로 거부된다", async () => {
    const folder = await folders.create(org.id, user.id, "자기참조");
    await expect(
      folders.updateForOwner(org.id, user.id, folder.id, {
        parentFolderId: folder.id,
      }),
    ).rejects.toBeInstanceOf(CircularFolderReferenceError);
  });

  it("조상 체인에 순환이 생기는 재지정은 CircularFolderReferenceError 로 거부된다", async () => {
    const grandparent = await folders.create(org.id, user.id, "조부모");
    const parent = await folders.create(
      org.id,
      user.id,
      "부모2",
      undefined,
      grandparent.id,
    );
    const child = await folders.create(
      org.id,
      user.id,
      "자식2",
      undefined,
      parent.id,
    );

    // grandparent 를 자신의 손자(child)의 하위로 옮기면 순환이 생긴다.
    await expect(
      folders.updateForOwner(org.id, user.id, grandparent.id, {
        parentFolderId: child.id,
      }),
    ).rejects.toBeInstanceOf(CircularFolderReferenceError);

    const unchanged = await folders.byIdForOwner(
      org.id,
      user.id,
      grandparent.id,
    );
    expect(unchanged?.parentFolderId).toBeNull();
  });
});
