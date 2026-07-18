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
import { useAgents } from "../../hooks/useAgents";
import { randomUUID } from "../../lib/uuid";
import { HomeContent } from "../../components/home/HomeContent";
import { draftKey } from "../../components/chat/ChatInput";
import { setPendingMessage } from "../../lib/pending-message";

export default function Home() {
  const router = useRouter();
  const { user, loading } = useCurrentUser();
  const { sessions } = useSessions();
  const { servers } = useMcpServers();
  const { skills } = useSkills();
  // P22-T6-10 — Agent registry(/api/v1/agents) 도입으로 정적 BUILTIN_AGENT_COUNT 를
  // 제거하고 조직에 실제 등록된 워크스페이스 에이전트 수를 표시한다. 조회 중에는
  // 0(=아직 확인된 것 없음)을 보여주고, 로드 완료 시 실제 길이로 대체된다.
  const { agents } = useAgents();

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

  // 홈 컴포저 제출 — 클릭 즉시 전환이 아니라, 질문을 입력하고 Enter 했을 때만 새 세션으로
  // 이동하며 그 첫 메시지를 pending 으로 예약(ChatView 마운트 시 1회 자동전송).
  function submitFromHome(text: string) {
    const id = randomUUID();
    setPendingMessage(id, text);
    router.push(`/chat/${id}`);
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
        onSubmitPrompt={submitFromHome}
        onQuickStart={startWithPrompt}
        onOpenSession={openSession}
        connectorsCount={servers.length}
        skillsCount={skills.length}
        agentsCount={agents.length}
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
