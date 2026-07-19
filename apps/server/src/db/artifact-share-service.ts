// db/artifact-share-service.ts — 06-DATA-MODEL § 0007_artifact_shares.sql + 14-INTERFACES §
// ArtifactShareRecord/ArtifactShareRepo + 16-API-CONTRACT § 8 Artifact Shares 단일 출처.
// ttlDays 검증(기본 30/최대 90) + 발급자 격리(다른 유저 조회/revoke 불가, existence-leak 방지) +
// public 조회 시 만료/revoke 판정(410 GONE)을 여기서 강제한다. routes/{artifact-shares,public-share}.ts
// (T4, P6-T4-01)는 이 service 를 호출해 HTTP status 로 번역한다.
import type { ArtifactShareRecord, DataAccess } from "@wchat/interfaces";

export type ArtifactShareDataAccess = Pick<DataAccess, "artifactShares">;

export const DEFAULT_TTL_DAYS = 30;
export const MAX_TTL_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface ArtifactShareActor {
  userId: string;
}

export class ArtifactShareServiceError extends Error {
  code: "NOT_FOUND" | "GONE" | "INVALID_INPUT";
  // GONE 세분화: 만료(expired) 와 취소(revoked) 를 공개 응답에서 구분(P22-T4-02).
  reason?: "expired" | "revoked";

  constructor(
    code: ArtifactShareServiceError["code"],
    message: string,
    reason?: ArtifactShareServiceError["reason"],
  ) {
    super(message);
    this.code = code;
    // exactOptionalPropertyTypes: 미지정(undefined) 이면 속성 자체를 부여하지 않는다.
    if (reason !== undefined) this.reason = reason;
  }
}

export function createArtifactShareService(da: ArtifactShareDataAccess) {
  async function issueShare(
    actor: ArtifactShareActor,
    artifactId: string,
    ttlDays: number = DEFAULT_TTL_DAYS,
  ): Promise<ArtifactShareRecord> {
    if (ttlDays <= 0 || ttlDays > MAX_TTL_DAYS) {
      throw new ArtifactShareServiceError(
        "INVALID_INPUT",
        `ttlDays 는 1~${MAX_TTL_DAYS} 사이여야 합니다.`,
      );
    }
    return da.artifactShares.insert({
      artifactId,
      issuedBy: actor.userId,
      expiresAt: new Date(Date.now() + ttlDays * DAY_MS),
      revokedAt: null,
      viewCount: 0,
    });
  }

  async function getShareForActor(
    actor: ArtifactShareActor,
    id: string,
  ): Promise<ArtifactShareRecord | null> {
    const found = await da.artifactShares.byId(id);
    if (!found || found.issuedBy !== actor.userId) return null;
    return found;
  }

  async function revokeShare(
    actor: ArtifactShareActor,
    id: string,
  ): Promise<void> {
    const found = await getShareForActor(actor, id);
    if (!found) {
      throw new ArtifactShareServiceError(
        "NOT_FOUND",
        "share 를 찾을 수 없습니다.",
      );
    }
    await da.artifactShares.revoke(id);
  }

  async function resolvePublicShare(
    token: string,
  ): Promise<ArtifactShareRecord> {
    const found = await da.artifactShares.byToken(token);
    if (!found) {
      throw new ArtifactShareServiceError(
        "NOT_FOUND",
        "share 를 찾을 수 없습니다.",
      );
    }
    if (found.revokedAt || found.expiresAt.getTime() <= Date.now()) {
      // revoke 가 만료보다 우선(둘 다 성립 시 revoked 로 안내).
      throw new ArtifactShareServiceError(
        "GONE",
        "share 가 만료되었거나 revoke 되었습니다.",
        found.revokedAt ? "revoked" : "expired",
      );
    }
    return found;
  }

  async function recordView(token: string): Promise<void> {
    await da.artifactShares.incrementViewCount(token);
  }

  return {
    issueShare,
    getShareForActor,
    revokeShare,
    resolvePublicShare,
    recordView,
  };
}
