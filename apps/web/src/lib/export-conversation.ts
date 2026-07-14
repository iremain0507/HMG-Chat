// lib/export-conversation.ts — 19-UIUX-UPGRADE.md § P10-T6-16 공유/내보내기.
//   대화를 md/JSON 으로 내보내는 순수 변환 함수 + 브라우저 다운로드 트리거.
//   서버 계약 변경 없음(클라이언트가 이미 보유한 messages 를 그대로 직렬화).
export interface ExportMessage {
  role: "user" | "assistant";
  content: string;
}

const ROLE_LABEL: Record<ExportMessage["role"], string> = {
  user: "User",
  assistant: "Assistant",
};

export function conversationToMarkdown(
  title: string,
  messages: ExportMessage[],
): string {
  const lines = [`# ${title}`, ""];
  for (const m of messages) {
    lines.push(`### ${ROLE_LABEL[m.role]}`, "", m.content, "");
  }
  return lines.join("\n");
}

export function conversationToJson(
  title: string,
  messages: ExportMessage[],
): string {
  return JSON.stringify({ title, messages }, null, 2);
}

export function downloadTextFile(
  filename: string,
  content: string,
  mimeType: string,
): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
