// kek-provider.test.ts — P22-T6-14 RED: lib/kek-provider.ts 부재.
// 계약 승인 정책 PROVIDER_KEK=pluggable (.ralph/CONTRACT_APPROVED):
//   지금은 env PROVIDER_KEY_ENCRYPTION_KEY 기반 로컬 대칭 암호화(AES-256-GCM),
//   배포 시 AWS KMS 구현으로 교체 가능하도록 KekProvider 인터페이스로 분리한다
//   (createEmailSender/createDevStubEmbeddingProvider 와 동일한 dev-stub 교체 패턴).
import { describe, it, expect } from "vitest";
import { createLocalKekProvider } from "../kek-provider.js";

const KEY = "0".repeat(64); // 32바이트 hex

describe("createLocalKekProvider", () => {
  it("encrypt → decrypt 로 평문이 왕복한다", async () => {
    const kek = createLocalKekProvider({ keyHex: KEY });
    const sealed = await kek.encrypt("sk-supersecret-full-key");
    expect(await kek.decrypt(sealed)).toBe("sk-supersecret-full-key");
  });

  it("암호문에는 평문이 남지 않는다", async () => {
    const kek = createLocalKekProvider({ keyHex: KEY });
    const sealed = await kek.encrypt("sk-supersecret-full-key");
    expect(sealed.toString("utf8")).not.toContain("sk-supersecret");
    expect(sealed.toString("base64")).not.toContain("c2stc3VwZXJzZWNyZXQ");
  });

  it("같은 평문이라도 매번 다른 암호문(랜덤 IV)", async () => {
    const kek = createLocalKekProvider({ keyHex: KEY });
    const a = await kek.encrypt("same");
    const b = await kek.encrypt("same");
    expect(a.equals(b)).toBe(false);
    expect(await kek.decrypt(a)).toBe("same");
    expect(await kek.decrypt(b)).toBe("same");
  });

  it("다른 키로는 복호화되지 않는다(GCM 인증 실패)", async () => {
    const sealed = await createLocalKekProvider({ keyHex: KEY }).encrypt("x");
    const other = createLocalKekProvider({ keyHex: "1".repeat(64) });
    await expect(other.decrypt(sealed)).rejects.toThrow();
  });

  it("변조된 암호문은 복호화되지 않는다(무결성)", async () => {
    const kek = createLocalKekProvider({ keyHex: KEY });
    const sealed = await kek.encrypt("tamper-me");
    const tampered = Buffer.from(sealed);
    tampered[tampered.length - 1] ^= 0xff;
    await expect(kek.decrypt(tampered)).rejects.toThrow();
  });

  it("keyHex 가 32바이트가 아니면 생성 시점에 거부한다", () => {
    expect(() => createLocalKekProvider({ keyHex: "abcd" })).toThrow();
  });
});
