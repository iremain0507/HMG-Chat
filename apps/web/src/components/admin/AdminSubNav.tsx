"use client";

// components/admin/AdminSubNav.tsx — P16-T6-02(갭1): /admin 하위(대시보드/사용자/도구 지표/설정)
// 로 갈 UI 진입점이 전무해(inert 모노스페이스 캡션만, next/link 0건) URL 을 직접 타이핑해야만
// 했던 것을 수정(docs/UAT-TEST-PLAN.md 갭1). AdminSettingsScreen 의 tablist 탭과 동일한 시각
// 스타일(활성 시 border-b-2 border-primary text-primary)을 쓰되, 실제 라우트 이동이라
// role=tablist/tab(ARIA 탭 패턴, 페이지 전환 없는 in-page 패널 전용)은 쓰지 않는다 —
// AdminSettingsScreen 자체 tablist 와 role 충돌도 피한다.
import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

interface AdminNavItem {
  key: string;
  label: string;
  href: string;
}

const ADMIN_NAV_ITEMS: AdminNavItem[] = [
  { key: "dashboard", label: "대시보드", href: "/admin" },
  { key: "users", label: "사용자 관리", href: "/admin/users" },
  { key: "groups", label: "그룹 관리", href: "/admin/groups" },
  { key: "grants", label: "접근 권한", href: "/admin/grants" },
  { key: "analytics", label: "사용량 분석", href: "/admin/analytics" },
  { key: "tool-metrics", label: "도구 지표", href: "/admin/tool-metrics" },
  { key: "settings", label: "설정", href: "/admin/settings" },
];

function isActivePath(pathname: string | null, href: string): boolean {
  if (!pathname) return false;
  if (href === "/admin") return pathname === "/admin";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AdminSubNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="관리 섹션"
      data-testid="admin-sub-nav"
      className="mt-4 flex flex-wrap gap-1 border-b border-border"
    >
      {ADMIN_NAV_ITEMS.map(({ key, label, href }) => {
        const active = isActivePath(pathname, href);
        return (
          <Link
            key={key}
            href={href}
            aria-current={active ? "page" : undefined}
            data-testid={`admin-sub-nav-${key}`}
            className={`px-3 pb-2 text-sm font-medium transition-colors ${
              active
                ? "border-b-2 border-primary text-primary"
                : "text-fg-muted hover:text-fg"
            }`}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
