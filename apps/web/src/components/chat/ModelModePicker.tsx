"use client";

// components/chat/ModelModePicker.tsx — 19-UIUX-UPGRADE § 컴포저 P10-T6-13.
//   컴포저 내 모델(추론 effort 포함)+모드(Agent/Chat)+웹검색 피커. org.allowedModels 가 비어있으면
//   렌더하지 않고(GET /auth/me 의 org.allowedModels — 16-API-CONTRACT § GET /config availableModels 와
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
}

const SELECT_CLASSNAME =
  "rounded-md border border-border bg-bg px-1.5 py-0.5 text-xs text-fg-muted outline-none hover:text-fg focus:border-primary";

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
}: ModelModePickerProps) {
  if (models.length === 0) return null;

  return (
    <div
      data-testid="model-mode-picker"
      className="flex flex-wrap items-center gap-1.5 px-1 pb-1.5"
    >
      <select
        aria-label="모델 선택"
        data-testid="model-picker-model"
        value={model}
        onChange={(e) => onModelChange(e.target.value)}
        className={SELECT_CLASSNAME}
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
        className={SELECT_CLASSNAME}
      >
        {(Object.keys(EFFORT_LABEL) as ReasoningEffort[]).map((key) => (
          <option key={key} value={key}>
            {EFFORT_LABEL[key]}
          </option>
        ))}
      </select>
      <select
        aria-label="모드 선택"
        data-testid="model-picker-mode"
        value={mode}
        onChange={(e) => onModeChange(e.target.value as ChatMode)}
        className={SELECT_CLASSNAME}
      >
        <option value="agent">Agent</option>
        <option value="chat">Chat</option>
      </select>
      {webSearchAvailable && (
        <button
          type="button"
          aria-label="웹 검색 토글"
          aria-pressed={webSearch}
          data-testid="model-picker-websearch"
          onClick={() => onWebSearchChange(!webSearch)}
          className="rounded-full border border-border px-2 py-0.5 text-xs text-fg-muted transition hover:text-fg aria-pressed:border-primary aria-pressed:bg-primary/10 aria-pressed:text-primary"
        >
          🌐 웹검색
        </button>
      )}
    </div>
  );
}
