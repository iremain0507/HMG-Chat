// @vitest-environment jsdom
// hooks/useSpeechSynthesis.ts — P22-T6-09 TTS 낭독(read-aloud, Open WebUI 파리티).
//   브라우저 네이티브 window.speechSynthesis 만 사용(서버·dependency·계약 변경 없음).
//   jsdom 에는 speechSynthesis 가 없으므로 stubGlobal 로 speak/cancel 스파이를 주입해
//   supported/speaking 상태 전이와 언마운트 정리를 단언한다.
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import { useSpeechSynthesis, markdownToPlainText } from "../useSpeechSynthesis";

class FakeUtterance {
  text: string;
  lang = "";
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(text: string) {
    this.text = text;
  }
}

function stubSynthesis() {
  const speak = vi.fn((u: FakeUtterance) => {
    lastUtterance = u;
  });
  const cancel = vi.fn();
  vi.stubGlobal("speechSynthesis", { speak, cancel, speaking: false });
  vi.stubGlobal("SpeechSynthesisUtterance", FakeUtterance);
  return { speak, cancel };
}

let lastUtterance: FakeUtterance | null = null;

describe("useSpeechSynthesis", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    lastUtterance = null;
  });

  it("speak() 호출 시 평문 utterance 로 speechSynthesis.speak 을 호출하고 speaking=true 가 된다", () => {
    const { speak } = stubSynthesis();
    const { result } = renderHook(() => useSpeechSynthesis());

    expect(result.current.supported).toBe(true);
    act(() => result.current.speak("**굵게** 그리고 `코드`"));

    expect(speak).toHaveBeenCalledTimes(1);
    expect(lastUtterance?.text).toBe("굵게 그리고 코드");
    expect(result.current.speaking).toBe(true);
  });

  it("낭독 중 stop() 호출 시 cancel 되고 speaking=false 로 돌아온다", () => {
    const { cancel } = stubSynthesis();
    const { result } = renderHook(() => useSpeechSynthesis());

    act(() => result.current.speak("안녕하세요"));
    expect(result.current.speaking).toBe(true);

    act(() => result.current.stop());
    expect(cancel).toHaveBeenCalled();
    expect(result.current.speaking).toBe(false);
  });

  it("utterance 가 onend 를 발화하면 speaking=false 로 복귀한다", () => {
    stubSynthesis();
    const { result } = renderHook(() => useSpeechSynthesis());

    act(() => result.current.speak("끝나는 문장"));
    act(() => lastUtterance?.onend?.());

    expect(result.current.speaking).toBe(false);
  });

  it("언마운트 시 진행 중 낭독을 cancel 한다", () => {
    const { cancel } = stubSynthesis();
    const { result, unmount } = renderHook(() => useSpeechSynthesis());

    act(() => result.current.speak("언마운트 전 낭독"));
    cancel.mockClear();
    unmount();

    expect(cancel).toHaveBeenCalled();
  });

  it("window.speechSynthesis 가 없으면 supported=false 이고 speak() 이 예외를 던지지 않는다", () => {
    const { result } = renderHook(() => useSpeechSynthesis());

    expect(result.current.supported).toBe(false);
    expect(() => act(() => result.current.speak("무시됨"))).not.toThrow();
    expect(result.current.speaking).toBe(false);
  });

  it("markdownToPlainText 가 마크다운 장식을 제거한다", () => {
    expect(markdownToPlainText("# 제목\n\n**굵게** _기울임_")).toBe(
      "제목 굵게 기울임",
    );
    expect(markdownToPlainText("[링크](https://example.com) 뒤")).toBe(
      "링크 뒤",
    );
    expect(markdownToPlainText("```js\nconst a = 1;\n```\n본문")).toBe("본문");
  });
});
