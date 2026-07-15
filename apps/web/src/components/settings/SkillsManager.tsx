"use client";

// components/settings/SkillsManager.tsx — 18-FRONTEND-WIREFRAMES § 18.5.6 /settings/skills
// 의 최소 구현: 스킬 카드 목록(name/description/version).
import React from "react";
import { useSkills } from "../../hooks/useSkills";

export function SkillsManager() {
  const { skills, loading, error } = useSkills();

  return (
    <section>
      {error && <p className="text-accent">{error}</p>}

      {loading ? (
        <p>불러오는 중…</p>
      ) : skills.length === 0 ? (
        <p className="text-fg-muted">사용 가능한 스킬이 없습니다.</p>
      ) : (
        <ul className="grid gap-4">
          {skills.map((s) => (
            <li
              key={s.id}
              className="rounded-xl border border-border bg-surface p-4"
            >
              <h3 className="text-fg font-semibold">{s.name}</h3>
              <p className="text-fg-muted">{s.description}</p>
              <span className="text-fg-muted">v{s.version}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
