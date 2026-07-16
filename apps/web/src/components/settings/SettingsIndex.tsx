"use client";

// components/settings/SettingsIndex.tsx — P16-T6-04(갭6·9): 통합 /settings 인덱스가
// 없어 NavRail '설정'이 /settings/memories 를 하드코딩하고(UAT 갭9), /settings/quota
// 가 자기 자신 외 어디서도 링크되지 않던(UAT 갭6) 문제를 해소한다. memories/skills/
// mcp/quota/profile 5개 섹션을 한 곳에서 나열.
import React from "react";
import Link from "next/link";

interface SettingsSectionItem {
  key: string;
  label: string;
  description: string;
  href: string;
}

const SETTINGS_SECTIONS: SettingsSectionItem[] = [
  {
    key: "memories",
    label: "메모리",
    description: "모든 대화에 자동 적용되는 저장된 메모리를 관리합니다.",
    href: "/settings/memories",
  },
  {
    key: "skills",
    label: "스킬",
    description: "사용 가능한 스킬과 허용 도구·정책을 확인합니다.",
    href: "/settings/skills",
  },
  {
    key: "mcp",
    label: "커넥터",
    description: "MCP 커넥터 연결 상태와 도구를 관리합니다.",
    href: "/settings/mcp",
  },
  {
    key: "prompts",
    label: "프롬프트",
    description: "자주 쓰는 프롬프트를 저장하고 /명령으로 불러옵니다.",
    href: "/settings/prompts",
  },
  {
    key: "api-keys",
    label: "API 키",
    description: "API 키를 발급·폐기해 외부 클라이언트 인증에 사용합니다.",
    href: "/settings/api-keys",
  },
  {
    key: "quota",
    label: "사용량",
    description: "이번 달 예산 사용량과 일별 추이를 확인합니다.",
    href: "/settings/quota",
  },
  {
    key: "profile",
    label: "프로필",
    description: "이름과 커스텀 지침을 관리합니다.",
    href: "/settings/profile",
  },
];

export function SettingsIndex() {
  return (
    <section>
      <div className="flex items-center gap-2.5">
        <h2 className="text-xl font-bold text-fg">설정</h2>
        <span className="font-mono text-[11px] text-fg-subtle">/settings</span>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {SETTINGS_SECTIONS.map(({ key, label, description, href }) => (
          <Link
            key={key}
            href={href}
            data-testid={`settings-index-${key}`}
            className="rounded-[10px] border border-border p-3.5 px-4 transition hover:border-primary hover:bg-primary-50"
          >
            <div className="text-sm font-semibold text-fg">{label}</div>
            <div className="mt-1 text-xs text-fg-muted">{description}</div>
          </Link>
        ))}
      </div>
    </section>
  );
}
