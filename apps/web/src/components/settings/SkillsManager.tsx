"use client";

// components/settings/SkillsManager.tsx — design-reference F11(에이전트 & 스킬 라이브러리)
// 중 "스킬" 섹션 핸드오프 정렬(P13-T6-11) + P22-T6-18(계약 C12) 작성/활성화/삭제.
//   Open WebUI 의 Workspace > Tools/Functions 파리티: ＋ 버튼으로 SKILL.md 를 작성/붙여넣기해
//   등록하고, 목록에서 활성화 토글·삭제를 수행한다. 빌트인(파일시스템) 스킬은 불변이라
//   토글·삭제 UI 가 없고 "기본 제공" 배지만 붙는다.
//   관리 화면이므로 includeDisabled=true 로 비활성 항목까지 받아 토글을 되돌릴 수 있다.
import React, { useCallback, useRef, useState } from "react";
import { Sparkles } from "lucide-react";
import { useSkills, type SkillSpecDto } from "../../hooks/useSkills";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import { showToast } from "../../lib/toast";

const FOCUS_RING =
  "outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--focus-ring)] focus-visible:outline-offset-2";

const MD_PLACEHOLDER = `---
name: my-skill
version: 1.0.0
description: 이 스킬이 하는 일
entryPoint: scripts/build.py
---

# my-skill
`;

/** 사용자 스킬만 변이 대상 — 빌트인은 skillId 가 없다. */
function isUserSkill(s: SkillSpecDto): boolean {
  return s.source === "user" && typeof s.skillId === "string";
}

export function SkillsManager() {
  const {
    skills,
    loading,
    error,
    reload,
    createSkill,
    setSkillEnabled,
    deleteSkill,
  } = useSkills({ includeDisabled: true });

  const [showModal, setShowModal] = useState(false);
  const [skillMd, setSkillMd] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const dialogRef = useRef<HTMLDivElement>(null);

  const closeModal = useCallback(() => {
    setShowModal(false);
    setSkillMd("");
    setFormError(null);
  }, []);
  useFocusTrap(dialogRef, { active: showModal, onClose: closeModal });

  function markBusy(id: string, busy: boolean) {
    setBusyIds((prev) => {
      const next = new Set(prev);
      if (busy) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!skillMd.trim()) {
      setFormError("SKILL.md 내용을 입력하세요.");
      return;
    }
    setFormError(null);
    setSaving(true);
    try {
      const result = await createSkill(skillMd);
      if (!result.ok) {
        setFormError(result.error);
        return;
      }
      showToast("success", "스킬을 등록했습니다.");
      closeModal();
    } finally {
      setSaving(false);
    }
  }

  async function handleToggle(s: SkillSpecDto) {
    const id = s.skillId;
    if (!id || busyIds.has(id)) return;
    markBusy(id, true);
    try {
      const result = await setSkillEnabled(id, !s.enabled);
      if (!result.ok) {
        showToast("error", result.error);
        return;
      }
      await reload();
    } finally {
      markBusy(id, false);
    }
  }

  async function handleDelete(s: SkillSpecDto) {
    const id = s.skillId;
    if (!id || busyIds.has(id)) return;
    if (!window.confirm(`'${s.name}' 스킬을 삭제할까요? 되돌릴 수 없습니다.`)) {
      return;
    }
    markBusy(id, true);
    try {
      const result = await deleteSkill(id);
      if (!result.ok) {
        showToast("error", result.error);
        return;
      }
      showToast("success", "스킬을 삭제했습니다.");
      await reload();
    } finally {
      markBusy(id, false);
    }
  }

  return (
    <section>
      <div className="flex flex-wrap items-center gap-2.5">
        <h2 className="text-[13px] font-bold text-fg-muted">스킬</h2>
        <button
          type="button"
          onClick={() => {
            setSkillMd("");
            setFormError(null);
            setShowModal(true);
          }}
          className={`ml-auto h-[30px] rounded-md bg-primary px-3 text-[12.5px] font-semibold text-primary-fg ${FOCUS_RING}`}
        >
          ＋ 스킬 작성
        </button>
      </div>

      {error && <p className="mt-2 text-sm text-accent">{error}</p>}

      {loading ? (
        <p className="mt-3 text-sm text-fg-muted">불러오는 중…</p>
      ) : skills.length === 0 ? (
        <p className="mt-3 text-sm text-fg-muted">
          사용 가능한 스킬이 없습니다.
        </p>
      ) : (
        <div className="mt-2 flex flex-col">
          {skills.map((s, i) => {
            const mine = isUserSkill(s);
            const enabled = s.enabled !== false;
            return (
              <div
                key={s.id}
                data-testid={`skill-row-${s.id}`}
                className={`flex items-center gap-2.5 px-3 py-2.5 ${
                  i === 0
                    ? "rounded-[10px] border border-primary/30 bg-primary-50"
                    : "border-b border-border last:border-b-0"
                } ${enabled ? "" : "opacity-70"}`}
              >
                <Sparkles
                  aria-hidden="true"
                  size={14}
                  className={i === 0 ? "text-primary" : "text-fg-muted"}
                />
                <h3 className="text-[13.5px] font-semibold text-fg">
                  {s.name}
                </h3>
                <span className="font-mono text-[11px] text-fg-muted">
                  v{s.version}
                </span>
                <p className="flex-1 text-[12.5px] text-fg-muted">
                  {s.description}
                </p>

                {!mine ? (
                  <span className="rounded-full border border-border bg-surface px-2 py-0.5 text-[11px] text-fg-muted">
                    기본 제공
                  </span>
                ) : (
                  <>
                    {!enabled && (
                      <span className="rounded-full border border-border bg-surface px-2 py-0.5 text-[11px] text-fg-muted">
                        비활성
                      </span>
                    )}
                    <button
                      type="button"
                      role="switch"
                      aria-checked={enabled}
                      aria-label={`${s.name} 활성화`}
                      onClick={() => void handleToggle(s)}
                      disabled={busyIds.has(s.skillId ?? "")}
                      className={`inline-flex h-[22px] w-[38px] shrink-0 items-center rounded-full border transition disabled:opacity-60 ${FOCUS_RING} ${
                        enabled
                          ? "border-primary bg-primary"
                          : "border-border bg-surface"
                      }`}
                    >
                      <span
                        aria-hidden="true"
                        className={`mx-0.5 h-[16px] w-[16px] rounded-full bg-bg transition ${
                          enabled ? "translate-x-[16px]" : ""
                        }`}
                      />
                    </button>
                    <button
                      type="button"
                      aria-label={`${s.name} 삭제`}
                      onClick={() => void handleDelete(s)}
                      disabled={busyIds.has(s.skillId ?? "")}
                      className={`h-7 rounded-md px-2.5 text-xs text-fg-muted disabled:opacity-60 ${FOCUS_RING}`}
                    >
                      삭제
                    </button>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}

      {showModal && (
        <div
          className="fixed inset-0 z-[var(--z-modal)] grid place-items-center bg-fg/40 px-4"
          onClick={closeModal}
        >
          <div
            ref={dialogRef}
            role="dialog"
            aria-label="스킬 작성"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-lg rounded-[14px] border border-border bg-bg p-4 shadow-lg"
          >
            <form onSubmit={(e) => void handleSubmit(e)}>
              <label className="block text-xs text-fg-muted">
                SKILL.md 내용
                <textarea
                  aria-label="SKILL.md 내용"
                  rows={14}
                  value={skillMd}
                  placeholder={MD_PLACEHOLDER}
                  onChange={(e) => {
                    setSkillMd(e.target.value);
                    if (formError) setFormError(null);
                  }}
                  className={`mt-1 w-full rounded-md border border-border bg-bg px-2.5 py-2 font-mono text-[12.5px] text-fg ${FOCUS_RING}`}
                />
              </label>
              <p className="mt-1 text-[11px] text-fg-subtle">
                frontmatter 의 entryPoint 는 샌드박스 내부 상대경로여야 하며,
                실행 권한은 항상 user 티어로 강제됩니다.
              </p>
              {formError && (
                <p className="mt-2 text-xs text-accent">{formError}</p>
              )}
              <button
                type="submit"
                disabled={saving}
                className={`mt-3.5 h-8 w-full rounded-md bg-primary text-[12.5px] font-semibold text-primary-fg disabled:opacity-60 ${FOCUS_RING}`}
              >
                저장
              </button>
              <button
                type="button"
                onClick={closeModal}
                className={`mt-1.5 h-8 w-full rounded-md text-xs text-fg-muted ${FOCUS_RING}`}
              >
                취소
              </button>
            </form>
          </div>
        </div>
      )}
    </section>
  );
}
