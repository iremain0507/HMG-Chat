// @vitest-environment jsdom
// components/chat/ChatInput.tsx — P22-T6-08 음성 입력(STT, Web Speech API 파리티).
//   컴포저 액션바의 마이크 토글 → SpeechRecognition 시작/정지, 인식된 최종 텍스트를 커서
//   위치에 삽입, 미지원 브라우저에서는 버튼 숨김. 실 SpeechRecognition 은 jsdom 에 없으므로
//   가짜 생성자를 stub 해 onresult 이벤트를 결정론적으로 흉내낸다(실 이벤트·상태 단언, L1).
import React from "react";
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  act,
  cleanup,
} from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ChatInput } from "../ChatInput";

class FakeRecognition {
  static instances: FakeRecognition[] = [];
  lang = "";
  continuous = false;
  interimResults = false;
  started = false;
  onresult: ((e: unknown) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  onend: (() => void) | null = null;
  onstart: (() => void) | null = null;
  constructor() {
    FakeRecognition.instances.push(this);
  }
  start() {
    this.started = true;
    this.onstart?.();
  }
  stop() {
    this.started = false;
    this.onend?.();
  }
  abort() {
    this.started = false;
  }
  emitFinal(text: string) {
    const result = Object.assign([{ transcript: text }], { isFinal: true });
    this.onresult?.({ resultIndex: 0, results: [result] } as unknown);
  }
}

function renderComposer() {
  return render(
    <ChatInput
      sessionId="voice-session"
      isStreaming={false}
      onSend={vi.fn()}
      onStop={vi.fn()}
    />,
  );
}

describe("ChatInput — 음성 입력(STT)", () => {
  beforeEach(() => {
    FakeRecognition.instances = [];
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    try {
      window.sessionStorage.clear();
    } catch {
      // ignore
    }
  });

  it("Web Speech API 지원 시 마이크 버튼을 렌더하고 인식된 텍스트를 컴포저에 삽입한다", () => {
    vi.stubGlobal("SpeechRecognition", FakeRecognition as unknown);
    renderComposer();

    const mic = screen.getByTestId("composer-trigger-mic");
    expect(mic).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(mic);
    expect(mic).toHaveAttribute("aria-pressed", "true");

    const rec = FakeRecognition.instances.at(-1);
    expect(rec?.started).toBe(true);

    act(() => rec?.emitFinal("안녕하세요 반갑습니다"));

    const ta = screen.getByLabelText("메시지 입력") as HTMLTextAreaElement;
    expect(ta.value).toContain("안녕하세요 반갑습니다");
  });

  it("녹음 중 마이크를 다시 누르면 인식을 멈추고 활성 상태가 해제된다", () => {
    vi.stubGlobal("SpeechRecognition", FakeRecognition as unknown);
    renderComposer();

    const mic = screen.getByTestId("composer-trigger-mic");
    fireEvent.click(mic);
    const rec = FakeRecognition.instances.at(-1);
    expect(rec?.started).toBe(true);

    fireEvent.click(mic);
    expect(rec?.started).toBe(false);
    expect(mic).toHaveAttribute("aria-pressed", "false");
  });

  it("녹음 중 Escape 를 누르면 인식이 멈춘다", () => {
    vi.stubGlobal("SpeechRecognition", FakeRecognition as unknown);
    renderComposer();

    const mic = screen.getByTestId("composer-trigger-mic");
    fireEvent.click(mic);
    const rec = FakeRecognition.instances.at(-1);
    expect(rec?.started).toBe(true);

    const ta = screen.getByLabelText("메시지 입력");
    fireEvent.keyDown(ta, { key: "Escape" });

    expect(rec?.started).toBe(false);
    expect(mic).toHaveAttribute("aria-pressed", "false");
  });

  it("Web Speech API 미지원 브라우저에서는 마이크 버튼을 렌더하지 않는다", () => {
    renderComposer();
    expect(screen.queryByTestId("composer-trigger-mic")).toBeNull();
  });
});
