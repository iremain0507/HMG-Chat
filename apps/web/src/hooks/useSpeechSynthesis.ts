"use client";

// hooks/useSpeechSynthesis.ts — P22-T6-09 TTS 낭독(read-aloud, Open WebUI 파리티).
//   브라우저 네이티브 Web Speech API(window.speechSynthesis + SpeechSynthesisUtterance)만 사용.
//   서버 라우트·신규 dependency·shared 타입·API 계약 변경 없음 => 순수 T6(apps/web) 범위.
//   미지원 런타임(jsdom 등)에서는 supported=false 로 그레이스풀하게 무력화(버튼 숨김),
//   새 speak / stop / 언마운트 시 진행 중 utterance 를 항상 cancel 한다(useSpeechRecognition 패턴).
import { useCallback, useEffect, useRef, useState } from "react";

// 마크다운 장식을 제거해 낭독용 평문으로 변환한다. 렌더 파이프라인(Markdown)은 React 노드를
// 만들기 때문에 낭독에는 쓸 수 없어, 낭독 전용 최소 스트리퍼를 둔다(신규 dependency 없음).
export function markdownToPlainText(markdown: string): string {
  return (
    markdown
      // 펜스 코드 블록은 통째로 제거(코드를 소리내 읽는 것은 무의미).
      .replace(/```[\s\S]*?```/g, " ")
      .replace(/~~~[\s\S]*?~~~/g, " ")
      // 이미지 → alt 텍스트, 링크 → 라벨.
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      // 인라인 코드 백틱 제거(내용은 유지).
      .replace(/`([^`]*)`/g, "$1")
      // 제목·인용·목록 마커(줄 앞) 제거.
      .replace(/^\s{0,3}#{1,6}\s+/gm, "")
      .replace(/^\s{0,3}>\s?/gm, "")
      .replace(/^\s{0,3}[-*+]\s+/gm, "")
      .replace(/^\s{0,3}\d+\.\s+/gm, "")
      // 수평선.
      .replace(/^\s{0,3}([-*_])\s*(?:\1\s*){2,}$/gm, " ")
      // 강조 마커(**, __, *, _, ~~) 제거.
      .replace(/(\*\*|__|~~)(.*?)\1/g, "$2")
      .replace(/(^|[\s(])[*_]([^*_\n]+)[*_](?=[\s).,!?]|$)/g, "$1$2")
      // 공백 정규화.
      .replace(/\s+/g, " ")
      .trim()
  );
}

interface SpeechSynthesisLike {
  speak(utterance: UtteranceLike): void;
  cancel(): void;
}
interface UtteranceLike {
  text: string;
  lang: string;
  onend: (() => void) | null;
  onerror: (() => void) | null;
}
type UtteranceCtor = new (text: string) => UtteranceLike;

function getSynthesis(): SpeechSynthesisLike | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { speechSynthesis?: SpeechSynthesisLike };
  return w.speechSynthesis ?? null;
}

function getUtteranceCtor(): UtteranceCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechSynthesisUtterance?: UtteranceCtor;
  };
  return w.SpeechSynthesisUtterance ?? null;
}

export interface SpeechSynthesisState {
  supported: boolean;
  speaking: boolean;
  // 마크다운 원문을 받아 평문으로 낭독한다.
  speak(markdown: string): void;
  stop(): void;
  toggle(markdown: string): void;
}

export function useSpeechSynthesis(lang = "ko-KR"): SpeechSynthesisState {
  // SSR/초기 렌더는 supported=false 로 시작해 hydration mismatch 방지(useSpeechRecognition 패턴).
  const [supported, setSupported] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const utteranceRef = useRef<UtteranceLike | null>(null);
  const langRef = useRef(lang);
  langRef.current = lang;

  useEffect(() => {
    setSupported(getSynthesis() !== null && getUtteranceCtor() !== null);
  }, []);

  // 진행 중 utterance 의 핸들러를 떼고 합성기를 취소한다(중복 onend 로 인한 상태 오염 방지).
  const cancelCurrent = useCallback(() => {
    const current = utteranceRef.current;
    if (current) {
      current.onend = null;
      current.onerror = null;
      utteranceRef.current = null;
    }
    getSynthesis()?.cancel();
  }, []);

  const stop = useCallback(() => {
    cancelCurrent();
    setSpeaking(false);
  }, [cancelCurrent]);

  const speak = useCallback(
    (markdown: string) => {
      const synthesis = getSynthesis();
      const Ctor = getUtteranceCtor();
      if (!synthesis || !Ctor) return;
      const text = markdownToPlainText(markdown);
      if (!text) return;
      // 새 낭독은 항상 이전 낭독을 대체한다.
      cancelCurrent();
      const utterance = new Ctor(text);
      utterance.lang = langRef.current;
      utterance.onend = () => {
        utteranceRef.current = null;
        setSpeaking(false);
      };
      utterance.onerror = () => {
        utteranceRef.current = null;
        setSpeaking(false);
      };
      utteranceRef.current = utterance;
      try {
        synthesis.speak(utterance);
        setSpeaking(true);
      } catch {
        utteranceRef.current = null;
        setSpeaking(false);
      }
    },
    [cancelCurrent],
  );

  const toggle = useCallback(
    (markdown: string) => {
      if (speaking) stop();
      else speak(markdown);
    },
    [speaking, speak, stop],
  );

  // 언마운트 시 진행 중 낭독을 반드시 중단(다른 화면으로 이동해도 계속 읽히는 것 방지).
  useEffect(() => {
    return () => {
      const current = utteranceRef.current;
      if (current) {
        current.onend = null;
        current.onerror = null;
        utteranceRef.current = null;
        getSynthesis()?.cancel();
      }
    };
  }, []);

  return { supported, speaking, speak, stop, toggle };
}
