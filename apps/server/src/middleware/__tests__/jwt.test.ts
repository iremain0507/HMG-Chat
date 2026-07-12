import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import jwt from "jsonwebtoken";
import {
  signAccessToken,
  signRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
} from "../jwt.js";

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  process.env.JWT_SECRET = "test-only-jwt-secret-32chars-minimum-xxxx";
  process.env.PROJECT_SLUG = "wchat";
  process.env.JWT_ACCESS_TTL_SECONDS = "900";
  process.env.JWT_REFRESH_TTL_SECONDS = "2592000";
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.useRealTimers();
});

describe("signAccessToken / verifyAccessToken", () => {
  it("12-OPS-SECURITY 부록 A 의 access token 클레임 구조로 발급한다", () => {
    const token = signAccessToken({
      userId: "user-1",
      orgId: "org-1",
      role: "member",
    });
    const decoded = jwt.decode(token) as Record<string, unknown>;

    expect(decoded.iss).toBe("wchat");
    expect(decoded.sub).toBe("user-1");
    expect(decoded.org).toBe("org-1");
    expect(decoded.role).toBe("member");
    expect(decoded.scope).toBe("access");
    expect(typeof decoded.jti).toBe("string");
    expect((decoded.exp as number) - (decoded.iat as number)).toBe(900);
  });

  it("발급된 토큰을 검증하면 원본 클레임을 반환한다", () => {
    const token = signAccessToken({
      userId: "user-1",
      orgId: "org-1",
      role: "admin",
    });
    const payload = verifyAccessToken(token);

    expect(payload.sub).toBe("user-1");
    expect(payload.org).toBe("org-1");
    expect(payload.role).toBe("admin");
    expect(payload.scope).toBe("access");
  });

  it("만료된 토큰은 검증 시 실패한다", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const token = signAccessToken({
      userId: "user-1",
      orgId: "org-1",
      role: "member",
    });

    vi.setSystemTime(new Date("2026-01-01T00:15:01Z")); // 900초 + 1초 경과
    expect(() => verifyAccessToken(token)).toThrow(jwt.TokenExpiredError);
  });

  it("변조되거나 다른 비밀키로 서명된 토큰은 검증에 실패한다", () => {
    const forged = jwt.sign(
      { sub: "user-1", org: "org-1", role: "member", scope: "access" },
      "wrong-secret-not-matching-env-xxxxxxxxxx",
      { issuer: "wchat", expiresIn: 900 },
    );
    expect(() => verifyAccessToken(forged)).toThrow(jwt.JsonWebTokenError);
  });

  it("refresh 토큰을 access 검증기로 검증하면 실패한다 (scope 교차 방지)", () => {
    const refreshToken = signRefreshToken({
      userId: "user-1",
      familyId: "family-1",
    });
    expect(() => verifyAccessToken(refreshToken)).toThrow();
  });
});

describe("signRefreshToken / verifyRefreshToken", () => {
  it("12-OPS-SECURITY 부록 A 의 refresh token 클레임 구조로 발급한다 (family 포함)", () => {
    const token = signRefreshToken({ userId: "user-1", familyId: "family-1" });
    const decoded = jwt.decode(token) as Record<string, unknown>;

    expect(decoded.iss).toBe("wchat");
    expect(decoded.sub).toBe("user-1");
    expect(decoded.scope).toBe("refresh");
    expect(decoded.family).toBe("family-1");
    expect(typeof decoded.jti).toBe("string");
    expect((decoded.exp as number) - (decoded.iat as number)).toBe(2592000);
  });

  it("발급된 refresh 토큰을 검증하면 원본 클레임을 반환한다", () => {
    const token = signRefreshToken({ userId: "user-1", familyId: "family-1" });
    const payload = verifyRefreshToken(token);

    expect(payload.sub).toBe("user-1");
    expect(payload.family).toBe("family-1");
    expect(payload.scope).toBe("refresh");
  });

  it("만료된 refresh 토큰은 검증 시 실패한다", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const token = signRefreshToken({ userId: "user-1", familyId: "family-1" });

    vi.setSystemTime(new Date("2026-01-31T00:00:01Z")); // 30일 + 1초 경과
    expect(() => verifyRefreshToken(token)).toThrow(jwt.TokenExpiredError);
  });
});
