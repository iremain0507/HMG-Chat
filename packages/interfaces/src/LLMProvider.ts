// packages/interfaces/src/LLMProvider.ts
// § 6 — Anthropic / OpenAI / Gemini 의 공통 어댑터.
// 본 파일은 types.ts (스트리밍/spec 타입) 만 import. ChatEvent/ChatSsePayload/
// TokenUsage/NotificationEvent/LLMMessage/ContentPart/PromptBlock 는 types.ts 가
// 단일 출처라 본 파일은 re-export 만 한다.

import type {
  AgentToolSpec,
  ChatEvent,
  LLMMessage,
  PromptBlock,
} from "./types.js";

export interface ChatInput {
  model: string;
  systemBlocks: PromptBlock[]; // PermissionTier=system, project
  messages: LLMMessage[]; // LLM turn 단위 (도메인 Message 아님)
  tools?: AgentToolSpec[];
  maxTokens: number;
  temperature?: number;
  topP?: number; // nucleus sampling — provider 가 지원 시 forward (미설정 시 provider 기본)
  // 추론 강도(P20-T2-02, human-gate 로 frozen 해제). provider 가 지원 시 extended thinking
  //   budget 으로 매핑(미설정 시 thinking 비활성). Anthropic thinking / OpenAI reasoning_effort.
  reasoningEffort?: "low" | "medium" | "high";
  cacheControl?: "ephemeral"; // Anthropic prompt cache
  toolChoice?: "auto" | "any" | { type: "tool"; name: string };
  parallelToolCalls?: boolean; // default false (v1.0)
}

export interface LLMProvider {
  name: string; // 'anthropic'
  models: string[]; // ['claude-opus-4-7', 'claude-sonnet-4-6', ...]
  chat(input: ChatInput, signal: AbortSignal): AsyncIterable<ChatEvent>;
}
