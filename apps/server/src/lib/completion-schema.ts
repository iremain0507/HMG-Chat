// lib/completion-schema.ts — POST /completions 요청 검증 단일 출처(P22-T6-16 / 계약배치 C10).
//   승인서 SCHEMAS=local 정책에 따라 packages/shared 로 올리지 않고 서버 로컬 Zod 로 둔다.
import { z } from "zod";

/** 초안 상한 — 컴포저 draft 는 길어질 수 있으나 자동완성엔 앞부분이면 충분(비용/지연 방어). */
export const MAX_DRAFT_CHARS = 4000;
/** 이어쓰기 조각 상한 — ghost text 가 컴포저를 덮지 않도록 서버에서도 자른다. */
export const MAX_COMPLETION_CHARS = 200;

export const CompletionRequestSchema = z.object({
  draft: z.string().trim().min(1).max(MAX_DRAFT_CHARS),
  /** 직전 대화 맥락(선택) — 세션 마지막 턴 요약 등. */
  context: z.string().max(4000).optional(),
});

export type CompletionRequest = z.infer<typeof CompletionRequestSchema>;
