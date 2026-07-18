"use client";

// components/layout/NavRail.tsx — design-reference/README.md § Screens/AppShell,
// claude-design-prompt §4 정보구조. 나비게이션 레일 64px: 홈·프로젝트·에이전트·커넥터·설정
// (+admin 만 관리) + 하단 테마 토글·아바타.
import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Home,
  Briefcase,
  Bot,
  Plug,
  Settings,
  ShieldCheck,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useCurrentUser } from "../../hooks/useCurrentUser";
import { ThemeToggle } from "./ThemeToggle";

interface NavItem {
  /** nav 카탈로그(lib/i18n/messages)의 키이자 data-testid 접미사 */
  key: "home" | "projects" | "agents" | "connectors" | "settings";
  href: string;
  icon: React.ComponentType<{ size?: number; strokeWidth?: number }>;
}

// P22-T6-15(C11): 라벨은 하드코딩 대신 nav.<key> 카탈로그에서 — 언어 전환 시 즉시 재렌더.
const NAV_ITEMS: NavItem[] = [
  { key: "home", href: "/", icon: Home },
  { key: "projects", href: "/projects", icon: Briefcase },
  { key: "agents", href: "/settings/agents", icon: Bot },
  { key: "connectors", href: "/settings/mcp", icon: Plug },
  { key: "settings", href: "/settings", icon: Settings },
];

function isActivePath(pathname: string | null, href: string): boolean {
  if (!pathname) return false;
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

function railItemClass(active: boolean): string {
  return `flex h-[38px] w-[38px] items-center justify-center rounded transition ${
    active
      ? "bg-primary-50 text-primary"
      : "text-fg-muted hover:bg-surface hover:text-fg"
  }`;
}

export function NavRail() {
  const pathname = usePathname();
  const t = useTranslations("nav");
  const { user } = useCurrentUser();
  const isAdmin = user?.role === "admin" || user?.role === "owner";

  return (
    <nav
      data-testid="app-shell-nav-rail"
      aria-label={t("primary")}
      className="flex w-16 shrink-0 flex-col items-center gap-1 border-r border-border py-2.5"
    >
      {NAV_ITEMS.map(({ key, href, icon: Icon }) => {
        const active = isActivePath(pathname, href);
        const label = t(key);
        return (
          <Link
            key={key}
            href={href}
            aria-label={label}
            aria-current={active ? "page" : undefined}
            data-testid={`nav-rail-${key}`}
            title={label}
            className={railItemClass(active)}
          >
            <Icon size={17} strokeWidth={1.8} />
          </Link>
        );
      })}
      {isAdmin && (
        <Link
          href="/admin"
          aria-label={t("admin")}
          aria-current={isActivePath(pathname, "/admin") ? "page" : undefined}
          data-testid="nav-rail-admin"
          title={t("admin")}
          className={railItemClass(isActivePath(pathname, "/admin"))}
        >
          <ShieldCheck size={17} strokeWidth={1.8} />
        </Link>
      )}
      <div className="mt-auto flex flex-col items-center gap-2">
        <ThemeToggle testId="nav-rail-theme-toggle" />
        <span
          aria-hidden="true"
          data-testid="nav-rail-avatar"
          className="flex h-[30px] w-[30px] items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-fg"
        >
          {user?.name ? user.name.charAt(0) : "?"}
        </span>
      </div>
    </nav>
  );
}
