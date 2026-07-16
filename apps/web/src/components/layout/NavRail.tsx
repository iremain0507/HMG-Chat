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
import { useCurrentUser } from "../../hooks/useCurrentUser";
import { ThemeToggle } from "./ThemeToggle";

interface NavItem {
  key: string;
  label: string;
  href: string;
  icon: React.ComponentType<{ size?: number; strokeWidth?: number }>;
}

const NAV_ITEMS: NavItem[] = [
  { key: "home", label: "홈", href: "/", icon: Home },
  { key: "projects", label: "프로젝트", href: "/projects", icon: Briefcase },
  { key: "agents", label: "에이전트", href: "/agents", icon: Bot },
  { key: "connectors", label: "커넥터", href: "/settings/mcp", icon: Plug },
  {
    key: "settings",
    label: "설정",
    href: "/settings",
    icon: Settings,
  },
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
  const { user } = useCurrentUser();
  const isAdmin = user?.role === "admin" || user?.role === "owner";

  return (
    <nav
      data-testid="app-shell-nav-rail"
      aria-label="주 내비게이션"
      className="flex w-16 shrink-0 flex-col items-center gap-1 border-r border-border py-2.5"
    >
      {NAV_ITEMS.map(({ key, label, href, icon: Icon }) => {
        const active = isActivePath(pathname, href);
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
          aria-label="관리"
          aria-current={isActivePath(pathname, "/admin") ? "page" : undefined}
          data-testid="nav-rail-admin"
          title="관리"
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
