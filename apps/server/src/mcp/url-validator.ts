// mcp/url-validator.ts — 12-OPS-SECURITY.md 부록 B "SSRF validator 알고리즘" 단일 출처.
// MCP 서버 등록(routes/mcp-servers.ts) + web_fetch 도구 호출 시 공통으로 사용.
// resolvedIps 는 호출자가 connection 을 그 IP 에 직접 bind(DNS rebinding 방지)하는 데 쓴다 —
// 실 HTTP client binding 은 mcp-client-pool(P8-T1-02)의 책임이라 이 모듈은 검증까지만 담당.
import { isIP } from "node:net";
import { promises as dns } from "node:dns";

export type McpUrlValidationErrorCode =
  "INVALID_URL" | "PROTOCOL_NOT_ALLOWED" | "INTERNAL_IP_FORBIDDEN";

export class McpUrlValidationError extends Error {
  code: McpUrlValidationErrorCode;
  constructor(code: McpUrlValidationErrorCode, message: string) {
    super(message);
    this.name = "McpUrlValidationError";
    this.code = code;
  }
}

export interface McpUrlValidatorOptions {
  nodeEnv?: string; // "development"|"test" 인 경우만 http 허용, 그 외 https 만
  allowedCidrs?: string[]; // MCP_ALLOWED_INTERNAL_CIDRS env (예: ["10.20.0.0/16"])
  resolveHostname?: (hostname: string) => Promise<string[]>; // 테스트/DI 훅, 기본은 실 DNS
}

export interface McpUrlValidationResult {
  url: URL;
  resolvedIps: string[];
}

// RFC-1918 + loopback + link-local/metadata + 기타 예약 대역 (denyList 는 화이트리스트로만 우회 가능).
const DENY_CIDRS = [
  "0.0.0.0/8",
  "10.0.0.0/8",
  "127.0.0.0/8",
  "169.254.0.0/16",
  "172.16.0.0/12",
  "192.168.0.0/16",
  "198.18.0.0/15",
  "224.0.0.0/4",
  "240.0.0.0/4",
  "::1/128",
  "fc00::/7",
  "fe80::/10",
  "ff00::/8",
];

function ipv4ToBigInt(ip: string): bigint {
  return ip
    .split(".")
    .reduce((acc, part) => (acc << 8n) | BigInt(Number(part)), 0n);
}

function ipv6ToBigInt(ip: string): bigint {
  const halves = ip.split("::");
  if (halves.length > 2) {
    throw new McpUrlValidationError("INVALID_URL", `잘못된 IPv6 주소: ${ip}`);
  }
  const parseGroups = (s: string) =>
    s === "" ? [] : s.split(":").map((h) => Number.parseInt(h, 16));
  const groups =
    halves.length === 2
      ? (() => {
          const head = parseGroups(halves[0] ?? "");
          const tail = parseGroups(halves[1] ?? "");
          const missing = 8 - head.length - tail.length;
          return [...head, ...Array(Math.max(missing, 0)).fill(0), ...tail];
        })()
      : parseGroups(ip);
  return groups.reduce((acc, g) => (acc << 16n) | BigInt(g), 0n);
}

function parseCidr(cidr: string) {
  const [addr = "", bitsStr = ""] = cidr.split("/");
  const version = isIP(addr) === 6 ? 6 : 4;
  const totalBits = version === 4 ? 32 : 128;
  const bits = Number(bitsStr);
  const base = version === 4 ? ipv4ToBigInt(addr) : ipv6ToBigInt(addr);
  return { base, bits, version, totalBits };
}

function ipInCidr(ip: string, cidr: string): boolean {
  const ipVersion = isIP(ip);
  if (!ipVersion) return false;
  const { base, bits, version, totalBits } = parseCidr(cidr);
  if (ipVersion !== version) return false;
  const ipInt = version === 4 ? ipv4ToBigInt(ip) : ipv6ToBigInt(ip);
  const shift = BigInt(totalBits - bits);
  return ipInt >> shift === base >> shift;
}

async function defaultResolveHostname(hostname: string): Promise<string[]> {
  const results = await dns.lookup(hostname, { all: true });
  return results.map((r) => r.address);
}

export async function validateMcpUrl(
  input: string,
  options: McpUrlValidatorOptions = {},
): Promise<McpUrlValidationResult> {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new McpUrlValidationError(
      "INVALID_URL",
      `URL을 파싱할 수 없습니다: ${input}`,
    );
  }

  const allowedProtocols =
    options.nodeEnv === "development" || options.nodeEnv === "test"
      ? ["http:", "https:"]
      : ["https:"];
  if (!allowedProtocols.includes(url.protocol)) {
    throw new McpUrlValidationError(
      "PROTOCOL_NOT_ALLOWED",
      `허용되지 않은 protocol: ${url.protocol}`,
    );
  }

  // WHATWG URL.hostname 은 IPv6 를 대괄호 포함("[::1]")으로 반환 — isIP/CIDR 비교 전 벗겨낸다.
  const hostname =
    url.hostname.startsWith("[") && url.hostname.endsWith("]")
      ? url.hostname.slice(1, -1)
      : url.hostname;
  const resolvedIps = isIP(hostname)
    ? [hostname]
    : await (options.resolveHostname ?? defaultResolveHostname)(hostname);

  const allowedCidrs = options.allowedCidrs ?? [];
  for (const ip of resolvedIps) {
    if (allowedCidrs.some((cidr) => ipInCidr(ip, cidr))) continue;
    if (DENY_CIDRS.some((cidr) => ipInCidr(ip, cidr))) {
      throw new McpUrlValidationError(
        "INTERNAL_IP_FORBIDDEN",
        `내부/사설 IP 는 허용되지 않습니다: ${ip}`,
      );
    }
  }

  return { url, resolvedIps };
}
