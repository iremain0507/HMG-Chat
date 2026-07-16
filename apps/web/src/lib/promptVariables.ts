// lib/promptVariables.ts — P19-T6-13: 프롬프트 라이브러리 본문의 {{today}}/{{user}}/
//   {{clipboard}} 변수를 컴포저 삽입 직전에 치환한다. 컨텍스트가 없는 변수는 빈 문자열로
//   치환(L2: throw 금지, 안전 기본값).
export interface PromptVariableContext {
  userName?: string;
  clipboardText?: string;
}

export function substitutePromptVariables(
  content: string,
  ctx: PromptVariableContext = {},
): string {
  const today = new Date().toLocaleDateString("ko-KR");
  return content
    .replace(/\{\{\s*today\s*\}\}/g, today)
    .replace(/\{\{\s*user\s*\}\}/g, ctx.userName ?? "")
    .replace(/\{\{\s*clipboard\s*\}\}/g, ctx.clipboardText ?? "");
}
