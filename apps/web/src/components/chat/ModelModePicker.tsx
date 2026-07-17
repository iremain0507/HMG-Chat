"use client";

// components/chat/ModelModePicker.tsx — 19-UIUX-UPGRADE § 컴포저 P10-T6-13,
//   P13-T6-04 F05 핸드오프: 모델/추론강도 select 는 칩 형태로 리스킨, 모드는 세그먼트
//   pill(에이전트|채팅) 버튼으로 노출한다. 모드 select 는 sr-only 로 유지해 스크린리더/
//   키보드 사용자에게 동일 기능을 제공하면서 fireEvent.change 기반 기존 동작도 보존한다.
//   org.allowedModels 가 비어있으면 렌더하지 않고(GET /auth/me 의 org.allowedModels — 16-API-CONTRACT § GET /config availableModels 와
//   동일 semantics 인 이미 구현된 endpoint, P10 신규 route prefix 금지라 재사용), webSearchAvailable
//   (org.allowedTools 에 web_search 포함 여부)이 false 면 웹검색 토글을 숨긴다.
import React from "react";

export type ReasoningEffort = "low" | "medium" | "high";
export type ChatMode = "agent" | "chat";

const EFFORT_LABEL: Record<ReasoningEffort, string> = {
  low: "추론: 낮음",
  medium: "추론: 보통",
  high: "추론: 높음",
};

const MODE_LABEL: Record<ChatMode, string> = {
  agent: "에이전트",
  chat: "채팅",
};

export interface ModelModePickerProps {
  models: string[];
  model: string;
  onModelChange: (model: string) => void;
  effort: ReasoningEffort;
  onEffortChange: (effort: ReasoningEffort) => void;
  mode: ChatMode;
  onModeChange: (mode: ChatMode) => void;
  webSearchAvailable: boolean;
  webSearch: boolean;
  onWebSearchChange: (webSearch: boolean) => void;
  temporary: boolean;
  onTemporaryChange: (temporary: boolean) => void;
}

const CHIP_CLASSNAME =
  "h-7 rounded-md border border-border bg-bg px-2 text-xs text-fg-muted outline-none hover:text-fg focus-visible:border-primary-400";

export function ModelModePicker({
  models,
  model,
  onModelChange,
  effort,
  onEffortChange,
  mode,
  onModeChange,
  webSearchAvailable,
  webSearch,
  onWebSearchChange,
  temporary,
  onTemporaryChange,
}: ModelModePickerProps) {
  if (models.length === 0) return null;

  return (
    <div
      data-testid="model-mode-picker"
      className="flex flex-wrap items-center gap-1.5"
    >
      <select
        aria-label="모델 선택"
        data-testid="model-picker-model"
        value={model}
        onChange={(e) => onModelChange(e.target.value)}
        className={CHIP_CLASSNAME}
      >
        {models.map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
      </select>
      <select
        aria-label="추론 강도"
        data-testid="model-picker-effort"
        value={effort}
        onChange={(e) => onEffortChange(e.target.value as ReasoningEffort)}
        className={CHIP_CLASSNAME}
      >
        {(Object.keys(EFFORT_LABEL) as ReasoningEffort[]).map((key) => (
          <option key={key} value={key}>
            {EFFORT_LABEL[key]}
          </option>
        ))}
      </select>
      {/* sr-only: 스크린리더/키보드 전용 접근 경로. 시각적 토글은 아래 세그먼트 버튼. */}
      <select
        aria-label="모드 선택"
        data-testid="model-picker-mode"
        value={mode}
        onChange={(e) => onModeChange(e.target.value as ChatMode)}
        className="sr-only"
      >
        <option value="agent">Agent</option>
        <option value="chat">Chat</option>
      </select>
      <span
        role="group"
        aria-label="모드"
        className="inline-flex rounded-md border border-border bg-surface p-0.5"
      >
        {(Object.keys(MODE_LABEL) as ChatMode[]).map((key) => (
          <button
            key={key}
            type="button"
            aria-pressed={mode === key}
            data-testid={`model-picker-mode-${key}`}
            onClick={() => onModeChange(key)}
            className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
              mode === key
                ? "bg-bg text-primary shadow-sm"
                : "text-fg-muted hover:text-fg"
            }`}
          >
            {MODE_LABEL[key]}
          </button>
        ))}
      </span>
      {webSearchAvailable && (
        <button
          type="button"
          aria-label="웹 검색 토글"
          aria-pressed={webSearch}
          data-testid="model-picker-websearch"
          onClick={() => onWebSearchChange(!webSearch)}
          className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border px-2 text-xs text-fg-muted transition hover:text-fg aria-pressed:border-primary-200 aria-pressed:bg-primary-50 aria-pressed:text-primary"
        >
          🌐 웹검색
        </button>
      )}
      <button
        type="button"
        aria-label="임시 채팅 토글"
        aria-pressed={temporary}
        data-testid="model-picker-temporary"
        onClick={() => onTemporaryChange(!temporary)}
        className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border px-2 text-xs text-fg-muted transition hover:text-fg aria-pressed:border-primary-200 aria-pressed:bg-primary-50 aria-pressed:text-primary"
      >
        🕶️ 임시
      </button>
    </div>
  );
}
