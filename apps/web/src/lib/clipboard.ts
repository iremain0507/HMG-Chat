// lib/clipboard.ts — 텍스트 클립보드 복사.
//   navigator.clipboard 는 "보안 컨텍스트"(HTTPS 또는 localhost)에서만 정의된다.
//   http://<Tailscale-host> / http://<LAN-ip> 같은 비보안 컨텍스트에선 undefined 이라
//   복사 버튼이 조용히 깨진다. 이 경우 레거시 execCommand("copy") 로 폴백한다.
//   반환값은 성공 여부(호출측이 "복사됨" 토스트/상태를 이 값으로 판단).

export async function copyText(text: string): Promise<boolean> {
  const nav = globalThis.navigator;
  if (nav?.clipboard?.writeText) {
    try {
      await nav.clipboard.writeText(text);
      return true;
    } catch {
      // 권한 거부 등 — 아래 레거시 폴백으로 진행.
    }
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    ta.setAttribute("readonly", "");
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
