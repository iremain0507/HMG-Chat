"use client";

// hooks/useSpeechRecognition.ts — P22-T6-08 음성 입력(STT, Open WebUI 파리티).
//   브라우저 네이티브 Web Speech API(SpeechRecognition / webkitSpeechRecognition)만 사용.
//   서버 라우트·신규 dependency·shared 타입·API 계약 변경 없음 => 순수 T6(apps/web) 범위.
//   미지원 브라우저(jsdom 포함)에서는 supported=false 로 그레이스풀하게 무력화(버튼 숨김).
//   인식된 "최종(final)" 텍스트만 onFinalTranscript 로 흘려 컴포저에 삽입한다.
import { useCallback, useEffect, useRef, useState } from "react";

// 표준 SpeechRecognition 이벤트/인스턴스는 lib.dom 에 없거나 벤더 프리픽스라 최소 형태만 선언.
interface SpeechRecognitionResultLike {
  0: { transcript: string };
  isFinal: boolean;
}
interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<SpeechRecognitionResultLike>;
}
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export interface UseSpeechRecognitionOptions {
  // 인식이 확정된(final) 문장 조각을 컴포저에 삽입하도록 위임.
  onFinalTranscript: (text: string) => void;
  // 진행 중(interim) 텍스트 — 선택적 미리보기용.
  onInterimTranscript?: (text: string) => void;
  lang?: string;
}

export interface SpeechRecognitionState {
  supported: boolean;
  listening: boolean;
  start(): void;
  stop(): void;
  toggle(): void;
}

export function useSpeechRecognition(
  options: UseSpeechRecognitionOptions,
): SpeechRecognitionState {
  // SSR/초기 렌더는 supported=false 로 시작해 hydration mismatch 방지(useOnlineStatus 패턴).
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    setSupported(getRecognitionCtor() !== null);
  }, []);

  const stop = useCallback(() => {
    const rec = recognitionRef.current;
    if (rec) {
      try {
        rec.stop();
      } catch {
        // 이미 정지됨 등 — 무시.
      }
    }
    setListening(false);
  }, []);

  const start = useCallback(() => {
    const Ctor = getRecognitionCtor();
    if (!Ctor) return;
    // 기존 세션이 남아있으면 정리 후 새로 시작.
    const prev = recognitionRef.current;
    if (prev) {
      prev.onresult = null;
      prev.onerror = null;
      prev.onend = null;
      try {
        prev.abort();
      } catch {
        // ignore
      }
    }
    const rec = new Ctor();
    rec.lang = optionsRef.current.lang ?? "ko-KR";
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (event) => {
      let interim = "";
      let final = "";
      for (let i = event.resultIndex ?? 0; i < event.results.length; i++) {
        const result = event.results[i];
        if (!result) continue;
        const transcript = result[0]?.transcript ?? "";
        if (result.isFinal) final += transcript;
        else interim += transcript;
      }
      if (final) optionsRef.current.onFinalTranscript(final);
      if (interim) optionsRef.current.onInterimTranscript?.(interim);
    };
    rec.onerror = () => setListening(false);
    rec.onend = () => setListening(false);
    recognitionRef.current = rec;
    try {
      rec.start();
      setListening(true);
    } catch {
      setListening(false);
    }
  }, []);

  const toggle = useCallback(() => {
    if (listening) stop();
    else start();
  }, [listening, start, stop]);

  // 언마운트 시 진행 중 인식을 중단하고 핸들러를 떼어 누수 방지.
  useEffect(() => {
    return () => {
      const rec = recognitionRef.current;
      if (rec) {
        rec.onresult = null;
        rec.onerror = null;
        rec.onend = null;
        try {
          rec.abort();
        } catch {
          // ignore
        }
      }
    };
  }, []);

  return { supported, listening, start, stop, toggle };
}
