"use client";

// app/page.tsx — 인증 랜딩 홈. design-reference/README.md §Screens "홈(F03)" 재현.
//   미인증 → /login 리다이렉트. 인증 → HomeContent(중앙 컬럼: 인사/컴포저/빠른 시작/능력
//   스트립/최근 세션) + 기존 프로젝트·설정·관리자 바로가기(HomeLink, 프레임 밖 실 내비게이션
//   보존). (magic-link verify 가 / 로 302 하므로 이 페이지가 로그인 직후 착지점.)
import React, { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useCurrentUser } from "../../hooks/useCurrentUser";
import { useSessions } from "../../hooks/useSessions";
import { useMcpServers } from "../../hooks/useMcpServers";
import { useSkills } from "../../hooks/useSkills";
import { randomUUID } from "../../lib/uuid";
import { HomeContent } from "../../components/home/HomeContent";
import { draftKey } from "../../components/chat/ChatInput";

// 내장 에이전틱 도구(tools/assemble-builtin-tools.ts) 개수 — artifact_create/web_search/
// code_interpreter/deep_research. 전용 "에이전트" API 가 아직 없어 정적 상수로 반영.
const BUILTIN_AGENT_COUNT = 4;

export default function Home() {
  const router = useRouter();
  const { user, loading } = useCurrentUser();
  const { sessions } = useSessions();
  const { servers } = useMcpServers();
  const { skills } = useSkills();

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

  function startWithPrompt(prompt: string) {
    const id = randomUUID();
    try {
      window.sessionStorage.setItem(draftKey(id), prompt);
    } catch {
      // sessionStorage 접근 불가(프라이빗 모드 등) — prefill 은 best-effort.
    }
    router.push(`/chat/${id}`);
  }

  function openSession(id: string) {
    router.push(`/chat/${id}`);
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
      <header className="mx-auto flex max-w-[720px] items-center justify-between px-6 pt-6">
        <span className="text-xl font-bold text-primary">WChat</span>
        <button
          onClick={logout}
          className="rounded-lg border border-border px-3 py-1.5 text-sm text-fg-muted hover:text-fg"
        >
          로그아웃
        </button>
      </header>

      <HomeContent
        userName={user.name}
        onNewChat={startNewChat}
        onQuickStart={startWithPrompt}
        onOpenSession={openSession}
        connectorsCount={servers.length}
        skillsCount={skills.length}
        agentsCount={BUILTIN_AGENT_COUNT}
        recentSessions={sessions}
        now={Date.now()}
      />

      <nav className="mx-auto grid max-w-[720px] gap-3 px-6 pb-16 sm:grid-cols-2">
        <HomeLink href="/projects" title="프로젝트" desc="프로젝트·문서·지식" />
        <HomeLink
          href="/settings/memories"
          title="설정"
          desc="메모리·스킬·MCP"
        />
        {(user.role === "admin" || user.role === "owner") && (
          <HomeLink href="/admin" title="관리자" desc="대시보드·사용자·지표" />
        )}
      </nav>
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
