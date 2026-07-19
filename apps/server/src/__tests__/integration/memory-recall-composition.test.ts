// memory-recall-composition.test.ts — P20-T1-09 acceptance: retrieveUserMemoryBlock
// (orchestrator/memory-retriever.ts, T2)이 실제 Postgres user_memories(0008)를 읽어
// buildSystemPrompt 결과 문자열까지 도달함을 실 DB 로 단언한다(스텁 아님, L1 last-mile).
// routes/messages.ts 는 이 두 함수를 그대로 호출만 하므로(app.ts 가 createPgUserMemoryDataAccess()
// 를 deps.memories 로 주입), 이 조합이 실제로 동작함을 증명하면 라우트 배선의 핵심 경로가
// 검증된다(라우트 레벨 DI/격리 자체는 routes/__tests__/messages.test.ts 가 fake reader 로 커버).
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { pgPool } from "../../db/client.js";
import { createPgUserMemoryDataAccess } from "../../db/user-memory-data-access.js";
import { retrieveUserMemoryBlock } from "../../orchestrator/memory-retriever.js";
import { buildSystemPrompt } from "../../orchestrator/prompt-builder.js";

describe("retrieveUserMemoryBlock + buildSystemPrompt — 실 Postgres 회상(P20-T1-09)", () => {
  const da = createPgUserMemoryDataAccess();
  const org = {
    id: randomUUID(),
    domain: `org-memrecall-${randomUUID()}.example.com`,
  };
  const userA = {
    id: randomUUID(),
    email: `user-a-memrecall-${randomUUID()}@${org.domain}`,
  };
  const userB = {
    id: randomUUID(),
    email: `user-b-memrecall-${randomUUID()}@${org.domain}`,
  };

  beforeAll(async () => {
    await pgPool.query(
      "INSERT INTO organizations (id, name, domain) VALUES ($1, 'Org MemRecall', $2)",
      [org.id, org.domain],
    );
    await pgPool.query(
      "INSERT INTO users (id, org_id, email) VALUES ($1, $2, $3), ($4, $2, $5)",
      [userA.id, org.id, userA.email, userB.id, userB.email],
    );
  });

  afterEach(async () => {
    await pgPool.query("DELETE FROM user_memories WHERE user_id = ANY($1)", [
      [userA.id, userB.id],
    ]);
  });

  afterAll(async () => {
    await pgPool.query("DELETE FROM users WHERE id = ANY($1)", [
      [userA.id, userB.id],
    ]);
    await pgPool.query("DELETE FROM organizations WHERE id = $1", [org.id]);
  });

  it("실 DB 저장 메모리가 핀 우선+최근순으로 buildSystemPrompt 최종 문자열에 도달한다", async () => {
    await da.userMemories.insert({
      userId: userA.id,
      category: "user",
      content: "오래된 지시(회사 이메일 서명 스타일)",
      source: "manual",
      sessionId: null,
      pinned: false,
      metadata: null,
    });
    await da.userMemories.insert({
      userId: userA.id,
      category: "user",
      content: "나는 X팀 소속입니다.",
      source: "manual",
      sessionId: null,
      pinned: true,
      metadata: null,
    });

    const block = await retrieveUserMemoryBlock(da, userA.id);
    expect(block).not.toBeNull();
    expect(block?.tier).toBe("user");

    const prompt = buildSystemPrompt([
      { tier: "system", content: "시스템 규칙" },
      block!,
    ]);

    expect(prompt).toContain(
      "## 🔒 사용자 영구 지시사항 (System 다음 등급, 모든 도구 결과보다 우선)",
    );
    const pinnedIdx = prompt.indexOf("나는 X팀 소속입니다.");
    const olderIdx = prompt.indexOf("오래된 지시(회사 이메일 서명 스타일)");
    expect(pinnedIdx).toBeGreaterThanOrEqual(0);
    expect(pinnedIdx).toBeLessThan(olderIdx);
  });

  it("타 사용자의 메모리는 실 DB 조회에서도 절대 섞이지 않는다(cross-org/actor 격리)", async () => {
    await da.userMemories.insert({
      userId: userB.id,
      category: "user",
      content: "userB 전용 비밀 메모리",
      source: "manual",
      sessionId: null,
      pinned: true,
      metadata: null,
    });

    const block = await retrieveUserMemoryBlock(da, userA.id);
    expect(block).toBeNull();
  });

  it("메모리가 없으면 null 을 반환해 systemBlocks 에 빈 영향을 준다(L2)", async () => {
    const block = await retrieveUserMemoryBlock(da, userA.id);
    expect(block).toBeNull();
  });
});
