"use client";

// app/page.tsx — 인증 랜딩 홈.
//   미인증 → /login 리다이렉트. 인증 → 환영 + 새 채팅/프로젝트/설정 진입.
//   (magic-link verify 가 / 로 302 하므로 이 페이지가 로그인 직후 착지점.)
import React, { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useCurrentUser } from "../hooks/useCurrentUser";
import { randomUUID } from "../lib/uuid";

export default function Home() {
  const router = useRouter();
  const { user, loading } = useCurrentUser();

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  if (loading) {
    return (
      <main className="grid min-h-screen place-items-center bg-bg text-fg-muted">
        <p>불러오는 중…</p>
      </main>
    );
  }

  if (!user) {
    return (
      <main className="grid min-h-screen place-items-center bg-bg text-fg-muted">
        <p>로그인 페이지로 이동합니다…</p>
      </main>
    );
  }

  function startNewChat() {
    router.push(`/chat/${randomUUID()}`);
  }

  async function logout() {
    await fetch("/api/v1/auth/logout", {
      method: "POST",
      credentials: "include",
    });
    router.replace("/login");
  }

  return (
    <main className="min-h-screen bg-bg text-fg">
      <div className="mx-auto max-w-2xl px-6 py-16">
        <header className="flex items-center justify-between">
          <span className="text-xl font-bold text-primary">WChat</span>
          <button
            onClick={logout}
            className="rounded-lg border border-border px-3 py-1.5 text-sm text-fg-muted hover:text-fg"
          >
            로그아웃
          </button>
        </header>

        <h1 className="mt-10 text-2xl font-semibold">
          안녕하세요, {user.name}님
        </h1>
        <p className="mt-1 text-fg-muted">무엇을 시작할까요?</p>

        <button
          onClick={startNewChat}
          className="mt-8 w-full rounded-xl bg-primary px-5 py-4 text-left text-primary-fg transition hover:opacity-90"
        >
          <span className="text-lg font-semibold">＋ 새 채팅 시작</span>
          <span className="mt-0.5 block text-sm opacity-80">
            AI 어시스턴트와 대화를 시작합니다
          </span>
        </button>

        <nav className="mt-4 grid gap-3 sm:grid-cols-2">
          <HomeLink
            href="/projects"
            title="프로젝트"
            desc="프로젝트·문서·지식"
          />
          <HomeLink
            href="/settings/memories"
            title="설정"
            desc="메모리·스킬·MCP"
          />
          {(user.role === "admin" || user.role === "owner") && (
            <HomeLink
              href="/admin"
              title="관리자"
              desc="대시보드·사용자·지표"
            />
          )}
        </nav>
      </div>
    </main>
  );
}

function HomeLink({
  href,
  title,
  desc,
}: {
  href: string;
  title: string;
  desc: string;
}) {
  return (
    <a
      href={href}
      className="rounded-xl border border-border bg-surface px-4 py-3 transition hover:border-primary"
    >
      <div className="font-medium">{title}</div>
      <div className="mt-0.5 text-sm text-fg-muted">{desc}</div>
    </a>
  );
}
