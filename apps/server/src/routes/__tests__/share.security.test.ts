// share.security.test.ts — P6-T4-01 acceptance: 발급된 share token 이 122-bit 안전(UUID v4)한지,
// 예측/추측 공격(인접 토큰 변형, 순차 발급 상관관계)에 안전한지 검증한다.
// UUID v4 는 128 bit 중 6 bit 가 버전/변형 고정 비트라 실질 엔트로피가 122 bit — RFC 4122 § 4.4.
import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import type { ArtifactShareRecord } from "@wchat/interfaces";
import {
  createArtifactShareService,
  type ArtifactShareDataAccess,
} from "../../db/artifact-share-service.js";

const UUID_V4_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function makeShareDa(): ArtifactShareDataAccess {
  const shares = new Map<string, ArtifactShareRecord>();
  return {
    artifactShares: {
      async insert(data) {
        const row = {
          id: randomUUID(),
          token: randomUUID(),
          createdAt: new Date(),
          ...data,
        } as ArtifactShareRecord;
        shares.set(row.id, row);
        return row;
      },
      async bulkInsert(items) {
        return Promise.all(items.map((r) => this.insert(r)));
      },
      async update(id, data) {
        const existing = shares.get(id);
        if (!existing) throw new Error("not found");
        const updated = { ...existing, ...data };
        shares.set(id, updated);
        return updated;
      },
      async delete(id) {
        shares.delete(id);
      },
      async byId(id) {
        return shares.get(id) ?? null;
      },
      async list() {
        return { items: [...shares.values()] };
      },
      async byToken(token) {
        return [...shares.values()].find((r) => r.token === token) ?? null;
      },
      async incrementViewCount(token) {
        const found = [...shares.values()].find((r) => r.token === token);
        if (found) found.viewCount += 1;
      },
      async revoke(id) {
        const found = shares.get(id);
        if (found) found.revokedAt = new Date();
      },
    },
  };
}

describe("artifact share token — 122-bit 안전성", () => {
  it("발급된 토큰은 RFC 4122 UUID v4 형식이다 (6 bit 고정, 122 bit 랜덤)", async () => {
    const da = makeShareDa();
    const service = createArtifactShareService(da);
    const share = await service.issueShare(
      { userId: randomUUID() },
      randomUUID(),
    );
    expect(share.token).toMatch(UUID_V4_RE);
  });

  it("대량 발급 토큰이 전부 UUID v4 형식이고 충돌 없이 유일하다 (예측 불가능성)", async () => {
    const da = makeShareDa();
    const service = createArtifactShareService(da);
    const artifactId = randomUUID();
    const tokens = new Set<string>();
    for (let i = 0; i < 500; i++) {
      const share = await service.issueShare(
        { userId: randomUUID() },
        artifactId,
      );
      expect(share.token).toMatch(UUID_V4_RE);
      tokens.add(share.token);
    }
    // 122-bit 랜덤 공간에서 500개 표본의 생일 문제 충돌 확률은 무시 가능(~1e-33) — 충돌 시 CSPRNG 결함.
    expect(tokens.size).toBe(500);
  });

  it("연속 발급된 두 토큰은 순차/예측 가능한 패턴(공통 접두사 등)을 갖지 않는다", async () => {
    const da = makeShareDa();
    const service = createArtifactShareService(da);
    const artifactId = randomUUID();
    const a = await service.issueShare({ userId: randomUUID() }, artifactId);
    const b = await service.issueShare({ userId: randomUUID() }, artifactId);
    // 순차 카운터/타임스탬프 기반 토큰이면 앞부분이 자주 일치한다 — CSPRNG UUID 는 8자 접두사가
    // 우연히 일치할 확률이 1/16^8 (≈3.7e-10) 수준으로 사실상 0.
    expect(a.token.slice(0, 8)).not.toBe(b.token.slice(0, 8));
  });

  it("유효한 토큰에서 마지막 문자만 바꾼 인접 토큰은 존재하지 않는 토큰으로 처리된다 (추측 공격 방어)", async () => {
    const da = makeShareDa();
    const service = createArtifactShareService(da);
    const share = await service.issueShare(
      { userId: randomUUID() },
      randomUUID(),
    );
    const lastChar = share.token.slice(-1);
    const flipped = lastChar === "0" ? "1" : "0";
    const guessed = share.token.slice(0, -1) + flipped;

    await expect(service.resolvePublicShare(guessed)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});
