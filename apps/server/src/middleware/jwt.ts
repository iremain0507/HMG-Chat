// JWT claim 구조 단일 출처: rebuild_plan/12-OPS-SECURITY.md § 부록 A
import jwt from "jsonwebtoken";
import { randomUUID } from "node:crypto";

export type UserRole = "member" | "admin" | "owner";

export interface AccessTokenPayload {
  iss: string;
  sub: string;
  org: string;
  role: UserRole;
  scope: "access";
  iat: number;
  exp: number;
  jti: string;
}

export interface RefreshTokenPayload {
  iss: string;
  sub: string;
  scope: "refresh";
  iat: number;
  exp: number;
  jti: string;
  family: string;
}

function getSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET is not set");
  return secret;
}

function getIssuer(): string {
  return process.env.PROJECT_SLUG ?? "wchat";
}

function getAccessTtlSeconds(): number {
  return Number(process.env.JWT_ACCESS_TTL_SECONDS ?? 900);
}

function getRefreshTtlSeconds(): number {
  return Number(process.env.JWT_REFRESH_TTL_SECONDS ?? 2592000);
}

export function signAccessToken(input: {
  userId: string;
  orgId: string;
  role: UserRole;
}): string {
  return jwt.sign(
    { org: input.orgId, role: input.role, scope: "access", jti: randomUUID() },
    getSecret(),
    {
      algorithm: "HS256",
      issuer: getIssuer(),
      subject: input.userId,
      expiresIn: getAccessTtlSeconds(),
    },
  );
}

export function signRefreshToken(input: {
  userId: string;
  familyId: string;
}): string {
  return jwt.sign(
    { scope: "refresh", family: input.familyId, jti: randomUUID() },
    getSecret(),
    {
      algorithm: "HS256",
      issuer: getIssuer(),
      subject: input.userId,
      expiresIn: getRefreshTtlSeconds(),
    },
  );
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  const payload = jwt.verify(token, getSecret(), {
    algorithms: ["HS256"],
    issuer: getIssuer(),
  });
  if (typeof payload === "string" || payload.scope !== "access") {
    throw new jwt.JsonWebTokenError("INVALID_TOKEN_SCOPE");
  }
  return payload as AccessTokenPayload;
}

export function verifyRefreshToken(token: string): RefreshTokenPayload {
  const payload = jwt.verify(token, getSecret(), {
    algorithms: ["HS256"],
    issuer: getIssuer(),
  });
  if (typeof payload === "string" || payload.scope !== "refresh") {
    throw new jwt.JsonWebTokenError("INVALID_TOKEN_SCOPE");
  }
  return payload as RefreshTokenPayload;
}
