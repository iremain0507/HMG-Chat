import { describe, expect, it } from "vitest";
import { substitutePromptVariables } from "../promptVariables";

describe("substitutePromptVariables (P19-T6-13)", () => {
  it("{{today}}를 오늘 날짜 문자열로 치환한다", () => {
    const today = new Date().toLocaleDateString("ko-KR");
    expect(substitutePromptVariables("오늘은 {{today}} 입니다")).toBe(
      `오늘은 ${today} 입니다`,
    );
  });

  it("{{user}}를 전달된 사용자 이름으로 치환한다", () => {
    expect(
      substitutePromptVariables("안녕 {{user}}", { userName: "김철수" }),
    ).toBe("안녕 김철수");
  });

  it("{{clipboard}}를 전달된 클립보드 텍스트로 치환한다", () => {
    expect(
      substitutePromptVariables("내용: {{clipboard}}", {
        clipboardText: "복사된 텍스트",
      }),
    ).toBe("내용: 복사된 텍스트");
  });

  it("컨텍스트가 없는 변수는 빈 문자열로 치환한다", () => {
    expect(substitutePromptVariables("사용자: {{user}}")).toBe("사용자: ");
  });
});
