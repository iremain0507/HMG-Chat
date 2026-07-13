// mcp/url-validator.ts — 12-OPS-SECURITY.md 부록 B "SSRF validator 알고리즘" 테스트 케이스 표
// (§ 부록 B "테스트 케이스") 그대로 검증. RFC-1918 차단 + VPC CIDR 화이트리스트 + IPv6 + rebinding.
import { describe, expect, it } from "vitest";
import { McpUrlValidationError, validateMcpUrl } from "../url-validator.js";

describe("validateMcpUrl (SSRF validator)", () => {
  it("잘못된 URL 은 INVALID_URL", async () => {
    await expect(validateMcpUrl("not a url")).rejects.toMatchObject({
      code: "INVALID_URL",
    });
  });

  it("prod 에서는 http 차단 (PROTOCOL_NOT_ALLOWED)", async () => {
    await expect(
      validateMcpUrl("http://example.com/foo", {
        nodeEnv: "production",
        resolveHostname: async () => ["93.184.216.34"],
      }),
    ).rejects.toMatchObject({ code: "PROTOCOL_NOT_ALLOWED" });
  });

  it("dev 환경에서는 http 허용", async () => {
    const result = await validateMcpUrl("http://example.com/foo", {
      nodeEnv: "development",
      resolveHostname: async () => ["93.184.216.34"],
    });
    expect(result.resolvedIps).toEqual(["93.184.216.34"]);
  });

  it("https://localhost/ → INTERNAL_IP_FORBIDDEN", async () => {
    await expect(
      validateMcpUrl("https://localhost/", {
        resolveHostname: async () => ["127.0.0.1"],
      }),
    ).rejects.toMatchObject({ code: "INTERNAL_IP_FORBIDDEN" });
  });

  it("https://127.0.0.1/ (IP literal) → INTERNAL_IP_FORBIDDEN", async () => {
    await expect(validateMcpUrl("https://127.0.0.1/")).rejects.toMatchObject({
      code: "INTERNAL_IP_FORBIDDEN",
    });
  });

  it("https://10.0.0.1/ (SSRF 시도, 화이트리스트 밖) → INTERNAL_IP_FORBIDDEN", async () => {
    await expect(validateMcpUrl("https://10.0.0.1/")).rejects.toMatchObject({
      code: "INTERNAL_IP_FORBIDDEN",
    });
  });

  it("https://10.20.5.10/ + MCP_ALLOWED_INTERNAL_CIDRS=10.20.0.0/16 → 통과", async () => {
    const result = await validateMcpUrl("https://10.20.5.10/", {
      allowedCidrs: ["10.20.0.0/16"],
    });
    expect(result.resolvedIps).toEqual(["10.20.5.10"]);
  });

  it("https://[::1]/ (IPv6 loopback) → INTERNAL_IP_FORBIDDEN", async () => {
    await expect(validateMcpUrl("https://[::1]/")).rejects.toMatchObject({
      code: "INTERNAL_IP_FORBIDDEN",
    });
  });

  it("169.254.169.254 (메타데이터 IP) → INTERNAL_IP_FORBIDDEN", async () => {
    await expect(
      validateMcpUrl("https://169.254.169.254/latest/meta-data"),
    ).rejects.toMatchObject({ code: "INTERNAL_IP_FORBIDDEN" });
  });

  it("DNS rebinding (attacker.com → CNAME → 10.0.0.5) → INTERNAL_IP_FORBIDDEN", async () => {
    await expect(
      validateMcpUrl("https://attacker.com/", {
        resolveHostname: async () => ["10.0.0.5"],
      }),
    ).rejects.toMatchObject({ code: "INTERNAL_IP_FORBIDDEN" });
  });

  it("공인 IP 호스트는 통과하고 resolvedIps 를 반환한다", async () => {
    const result = await validateMcpUrl("https://example.com/", {
      resolveHostname: async () => ["93.184.216.34"],
    });
    expect(result.resolvedIps).toEqual(["93.184.216.34"]);
    expect(result.url.hostname).toBe("example.com");
  });

  it("McpUrlValidationError 는 Error 인스턴스다", async () => {
    try {
      await validateMcpUrl("https://127.0.0.1/");
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(McpUrlValidationError);
      expect(e).toBeInstanceOf(Error);
    }
  });
});
