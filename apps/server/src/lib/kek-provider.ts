// lib/kek-provider.ts — provider 연결 API 키(0035_provider_connections.api_key_encrypted)의
// 봉인/해제 포트. P22-T6-14, 계약 승인 정책 PROVIDER_KEK=pluggable(.ralph/CONTRACT_APPROVED).
//
// 왜 인터페이스로 분리하나: LOCAL_ONLY 인 지금은 env PROVIDER_KEY_ENCRYPTION_KEY 로 로컬 대칭
// 암호화(AES-256-GCM)하지만, 배포 시에는 AWS KMS 로 교체해야 한다. lib/email-sender.ts /
// knowledge/embedding-provider-dev-stub.ts 와 동일한 "포트 + 로컬 구현, 배포 시 교체" 패턴이라
// 소비자(db/provider-connection-data-access.ts)는 구현 교체에 영향받지 않는다.
// 실 KMS 배선은 배포 human gate(P0-T1-01 AWS 프로비저닝) 이후.
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

export interface KekProvider {
  /** 평문 비밀 → 봉인된 바이트(그대로 BYTEA 컬럼에 저장). */
  encrypt(plaintext: string): Promise<Buffer>;
  /** 봉인된 바이트 → 평문. 키 불일치·변조 시 throw. */
  decrypt(sealed: Buffer): Promise<string>;
}

const IV_BYTES = 12; // GCM 권장 nonce 길이
const TAG_BYTES = 16;

/**
 * 봉인 포맷: [IV(12) | authTag(16) | ciphertext]. 버전 프리픽스를 두지 않은 이유는
 * 이 컬럼의 유일한 소비자가 secretById() 하나라, 포맷 전환이 필요해지면 KMS 구현으로
 * 통째로 갈아끼우기 때문(현 시점 마이그레이션 부담 0).
 */
export function createLocalKekProvider(opts: { keyHex: string }): KekProvider {
  const key = Buffer.from(opts.keyHex, "hex");
  if (key.length !== 32) {
    throw new Error(
      "PROVIDER_KEY_ENCRYPTION_KEY 는 32바이트(hex 64자)여야 합니다.",
    );
  }
  return {
    async encrypt(plaintext) {
      const iv = randomBytes(IV_BYTES);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      const ciphertext = Buffer.concat([
        cipher.update(plaintext, "utf8"),
        cipher.final(),
      ]);
      return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
    },
    async decrypt(sealed) {
      if (sealed.length < IV_BYTES + TAG_BYTES) {
        throw new Error("봉인 데이터가 손상되었습니다.");
      }
      const iv = sealed.subarray(0, IV_BYTES);
      const tag = sealed.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
      const ciphertext = sealed.subarray(IV_BYTES + TAG_BYTES);
      const decipher = createDecipheriv("aes-256-gcm", key, iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([
        decipher.update(ciphertext),
        decipher.final(),
      ]).toString("utf8");
    },
  };
}

/**
 * env 기반 조립. PROVIDER_KEY_ENCRYPTION_KEY 미설정(dev/CI)이면 JWT_SECRET 에서 파생한
 * 고정 키로 fail-soft 한다 — LOCAL_ONLY 개발에서 연결 등록이 막히지 않게 하되, 배포에서는
 * 반드시 전용 KEK(또는 KMS)를 설정해야 한다(파생 키는 JWT_SECRET 회전 시 기존 암호문을
 * 못 읽으므로 재등록 필요 — 로컬 한정 트레이드오프).
 */
export function createKekProvider(env: {
  PROVIDER_KEY_ENCRYPTION_KEY?: string;
  JWT_SECRET: string;
}): KekProvider {
  const keyHex =
    env.PROVIDER_KEY_ENCRYPTION_KEY ??
    createHash("sha256")
      .update(`wchat:provider-kek:${env.JWT_SECRET}`)
      .digest("hex");
  return createLocalKekProvider({ keyHex });
}
