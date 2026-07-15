"use client";

// components/settings/SkillsManager.tsx — design-reference F11(에이전트 & 스킬 라이브러리)
// 중 "스킬" 섹션 핸드오프 정렬(P13-T6-11). 에이전트 갤러리(카드+슬라이드오버)는 이를 뒷받침할
// Agent 레지스트리 인터페이스가 14-INTERFACES.md 에 없어 이번 태스크 범위에서 제외한다(새
// 타입 금지 규칙 — 필요 시 별도 태스크로 격리).
import React from "react";
import { Sparkles } from "lucide-react";
import { useSkills } from "../../hooks/useSkills";

export function SkillsManager() {
  const { skills, loading, error } = useSkills();

  return (
    <section>
      <h2 className="text-[13px] font-bold text-fg-muted">스킬</h2>

      {error && <p className="mt-2 text-sm text-accent">{error}</p>}

      {loading ? (
        <p className="mt-3 text-sm text-fg-muted">불러오는 중…</p>
      ) : skills.length === 0 ? (
        <p className="mt-3 text-sm text-fg-muted">
          사용 가능한 스킬이 없습니다.
        </p>
      ) : (
        <div className="mt-2 flex flex-col">
          {skills.map((s, i) => (
            <div
              key={s.id}
              className={`flex items-center gap-2.5 px-3 py-2.5 ${
                i === 0
                  ? "rounded-[10px] border border-primary/30 bg-primary-50"
                  : "border-b border-border last:border-b-0"
              }`}
            >
              <Sparkles
                aria-hidden="true"
                size={14}
                className={i === 0 ? "text-primary" : "text-fg-muted"}
              />
              <h3 className="text-[13.5px] font-semibold text-fg">{s.name}</h3>
              <span className="font-mono text-[11px] text-fg-muted">
                v{s.version}
              </span>
              <p className="flex-1 text-[12.5px] text-fg-muted">
                {s.description}
              </p>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
