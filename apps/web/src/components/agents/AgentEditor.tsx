"use client";

// components/agents/AgentEditor.tsx — P22-T6-10 에이전트 편집 슬라이드오버.
//   Open WebUI Workspace › Models 의 모델 편집 패널 흐름을 우측 슬라이드오버로 옮긴 것.
//   ID 목록(도구/스킬/프로젝트)은 쉼표 구분 텍스트 입력 → 배열로 정규화해 계약
//   (POST/PATCH /api/v1/agents 의 toolIds·skillIds·projectIds) 형태로 onSave 에 넘긴다.
//   모달 a11y 는 공용 useFocusTrap(트랩 + Escape + 트리거 포커스 복귀)을 재사용한다.
import React, { useRef, useState, type RefObject } from "react";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import type { AgentDto, AgentInput } from "../../hooks/useAgents";

const FOCUS_RING =
  "outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--focus-ring)] focus-visible:outline-offset-2";

const FIELD =
  "mt-1 w-full rounded-md border border-border bg-bg px-2.5 py-1.5 text-[13px] text-fg placeholder:text-fg-subtle";

// 채팅 모델 선택지와 동일 집합(preview 갤러리 AVAILABLE_MODELS). 조직이 커스텀 모델을
// 붙이면 agent.baseModel 이 목록 밖일 수 있어 그 값도 옵션으로 합쳐 표시한다.
export const BASE_MODEL_OPTIONS = ["claude-sonnet-4-6", "claude-opus-4-7"];
export const DEFAULT_BASE_MODEL = BASE_MODEL_OPTIONS[0] as string;

function toList(raw: string): string[] {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export interface AgentEditorProps {
  agent: AgentDto | null;
  onClose(): void;
  onSave(input: AgentInput): void | Promise<void>;
  restoreFocusRef?: RefObject<HTMLElement | null> | undefined;
}

export function AgentEditor({
  agent,
  onClose,
  onSave,
  restoreFocusRef,
}: AgentEditorProps) {
  const [name, setName] = useState(agent?.name ?? "");
  const [description, setDescription] = useState(agent?.description ?? "");
  const [baseModel, setBaseModel] = useState(
    agent?.baseModel ?? DEFAULT_BASE_MODEL,
  );
  const [systemPrompt, setSystemPrompt] = useState(agent?.systemPrompt ?? "");
  const [toolIds, setToolIds] = useState((agent?.toolIds ?? []).join(", "));
  const [skillIds, setSkillIds] = useState((agent?.skillIds ?? []).join(", "));
  const [projectIds, setProjectIds] = useState(
    (agent?.projectIds ?? []).join(", "),
  );
  const [visibility, setVisibility] = useState<AgentDto["visibility"]>(
    agent?.visibility ?? "private",
  );
  const [saving, setSaving] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);

  useFocusTrap(dialogRef, { active: true, onClose, restoreFocusRef });

  const title = agent ? "에이전트 편집" : "에이전트 만들기";
  const canSave = name.trim().length > 0 && !saving;

  const modelOptions = BASE_MODEL_OPTIONS.includes(baseModel)
    ? BASE_MODEL_OPTIONS
    : [baseModel, ...BASE_MODEL_OPTIONS];

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSave) return;
    setSaving(true);
    try {
      await onSave({
        name: name.trim(),
        baseModel,
        description: description.trim() ? description.trim() : null,
        systemPrompt: systemPrompt.trim() ? systemPrompt.trim() : null,
        toolIds: toList(toolIds),
        skillIds: toList(skillIds),
        projectIds: toList(projectIds),
        visibility,
      });
    } finally {
      setSaving(false);
    }
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-[var(--z-modal)] flex justify-end bg-fg/40"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className="flex h-full w-full max-w-md flex-col overflow-y-auto border-l border-border bg-bg p-5 shadow-lg"
      >
        <h3 className="text-[15px] font-bold text-fg">{title}</h3>
        <p className="mt-0.5 text-[11.5px] text-fg-subtle">
          기본 모델에 시스템 프롬프트·도구·스킬을 묶어 워크스페이스 에이전트로
          저장합니다.
        </p>

        <form onSubmit={(e) => void handleSubmit(e)} className="mt-4">
          <label className="block text-xs text-fg-muted">
            이름
            <input
              aria-label="이름"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="예: 품질 분석가"
              className={`${FIELD} ${FOCUS_RING}`}
            />
          </label>

          <label className="mt-3 block text-xs text-fg-muted">
            설명
            <input
              aria-label="설명"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="이 에이전트가 하는 일"
              className={`${FIELD} ${FOCUS_RING}`}
            />
          </label>

          <label className="mt-3 block text-xs text-fg-muted">
            기본 모델
            <select
              aria-label="기본 모델"
              value={baseModel}
              onChange={(e) => setBaseModel(e.target.value)}
              className={`${FIELD} ${FOCUS_RING}`}
            >
              {modelOptions.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>

          <label className="mt-3 block text-xs text-fg-muted">
            시스템 프롬프트
            <textarea
              aria-label="시스템 프롬프트"
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              rows={5}
              placeholder="이 에이전트의 역할·규칙을 적습니다."
              className={`${FIELD} resize-y font-mono text-xs leading-relaxed ${FOCUS_RING}`}
            />
          </label>

          <label className="mt-3 block text-xs text-fg-muted">
            도구 IDs
            <input
              aria-label="도구 IDs"
              value={toolIds}
              onChange={(e) => setToolIds(e.target.value)}
              placeholder="쉼표로 구분 — 예: web_search, code_interpreter"
              className={`${FIELD} font-mono text-xs ${FOCUS_RING}`}
            />
          </label>

          <label className="mt-3 block text-xs text-fg-muted">
            스킬 IDs
            <input
              aria-label="스킬 IDs"
              value={skillIds}
              onChange={(e) => setSkillIds(e.target.value)}
              placeholder="쉼표로 구분"
              className={`${FIELD} font-mono text-xs ${FOCUS_RING}`}
            />
          </label>

          <label className="mt-3 block text-xs text-fg-muted">
            프로젝트 IDs
            <input
              aria-label="프로젝트 IDs"
              value={projectIds}
              onChange={(e) => setProjectIds(e.target.value)}
              placeholder="쉼표로 구분"
              className={`${FIELD} font-mono text-xs ${FOCUS_RING}`}
            />
          </label>

          <div className="mt-3 text-xs text-fg-muted">공개 범위</div>
          <div className="mt-1.5 flex gap-1.5">
            {(["private", "org"] as const).map((v) => (
              <button
                key={v}
                type="button"
                aria-pressed={visibility === v}
                onClick={() => setVisibility(v)}
                className={`rounded-full px-3 py-1 text-xs ${FOCUS_RING} ${
                  visibility === v
                    ? "border border-primary/30 bg-primary-50 font-medium text-primary"
                    : "border border-border text-fg-muted"
                }`}
              >
                {v === "private" ? "비공개" : "조직"}
              </button>
            ))}
          </div>

          <div className="mt-5 flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className={`h-9 flex-1 rounded-md border border-border text-[13px] text-fg-muted ${FOCUS_RING}`}
            >
              취소
            </button>
            <button
              type="submit"
              disabled={!canSave}
              className={`h-9 flex-1 rounded-md bg-primary text-[13px] font-semibold text-primary-fg disabled:opacity-50 ${FOCUS_RING}`}
            >
              저장
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
