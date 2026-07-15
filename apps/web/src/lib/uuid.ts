// lib/uuid.ts — RFC4122 v4 UUID 생성.
//   crypto.randomUUID() 는 브라우저에서 "보안 컨텍스트"(HTTPS 또는 localhost)에서만
//   정의된다. http://<Tailscale-host> / http://<LAN-ip> 같은 비보안 컨텍스트에선
//   undefined 이므로 그대로 호출하면 TypeError 가 난다("새 채팅" 클릭 시 크래시).
//   getRandomValues 는 비보안 컨텍스트에서도 항상 사용 가능하므로 이를 폴백으로 쓴다.

export function randomUUID(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") {
    return c.randomUUID();
  }
  // 비보안 컨텍스트 폴백 — getRandomValues 기반 v4.
  const bytes = new Uint8Array(16);
  c.getRandomValues(bytes);
  const fixed = bytes.map((byte, i) => {
    if (i === 6) return (byte & 0x0f) | 0x40; // version 4
    if (i === 8) return (byte & 0x3f) | 0x80; // variant 10
    return byte;
  });
  const hex = Array.from(fixed, (byte) => byte.toString(16).padStart(2, "0"));
  return (
    hex.slice(0, 4).join("") +
    "-" +
    hex.slice(4, 6).join("") +
    "-" +
    hex.slice(6, 8).join("") +
    "-" +
    hex.slice(8, 10).join("") +
    "-" +
    hex.slice(10, 16).join("")
  );
}
