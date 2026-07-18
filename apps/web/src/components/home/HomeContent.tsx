"use client";

// components/home/HomeContent.tsx — design-reference/README.md §Screens "홈(F03)":
// 중앙 720px 컬럼 — 인사 → 컴포저 트리거 → 빠른 시작 2×2 → 능력 스트립 → 최근 세션 5.
// 순수 프레젠테이션 컴포넌트(데이터 페칭은 app/page.tsx 가 담당) — app/preview 갤러리에서도
// 목 props 로 그대로 재사용.
import React, { useState } from "react";
import {
  FileText,
  Presentation,
  Search,
  Telescope,
  ChevronRight,
  ArrowUp,
} from "lucide-react";
import { formatRelativeTime } from "../../lib/relative-time";

export interface QuickStart {
  title: string;
  desc: string;
  prompt: string;
  icon: React.ComponentType<{ size?: number; strokeWidth?: number }>;
  featured?: boolean;
}

// P13-T6-02 — design-reference Frames F03 의 빠른 시작 4카드(§1 대표 시나리오 1:1).
export const QUICK_STARTS: QuickStart[] = [
  {
    title: "문서 요약",
    desc: "PDF를 끌어다 놓으세요 — 인용과 함께 요약합니다",
    prompt: "요약하고 싶은 문서를 첨부해주세요.",
    icon: FileText,
  },
  {
    title: "WIA 브랜드 PPT 만들기",
    desc: "스킬이 사내 양식으로 초안을 생성합니다",
    prompt: "WIA 브랜드 PPT 초안을 만들어줘",
    icon: Presentation,
    featured: true,
  },
  {
    title: "사내 지식 검색",
    desc: "프로젝트 문서에서 근거 페이지까지 찾아드립니다",
    prompt: "사내 지식에서 다음 내용을 찾아줘: ",
    icon: Search,
  },
  {
    title: "@딥리서치로 시장 조사",
    desc: "서브 에이전트가 병렬로 조사하고 출처를 인용합니다",
    prompt: "@딥리서치로 다음 주제를 조사해줘: ",
    icon: Telescope,
  },
];

export interface HomeRecentSession {
  id: string;
  title: string | null;
  lastMessageAt: string | null;
  projectId: string | null;
  archived: boolean;
}

export interface HomeContentProps {
  userName: string;
  /** 홈 컴포저에서 질문을 입력하고 Enter(또는 보내기)했을 때 — 새 세션으로 이동+자동전송. */
  onSubmitPrompt: (text: string) => void;
  onQuickStart: (prompt: string) => void;
  onOpenSession: (id: string) => void;
  connectorsCount: number;
  skillsCount: number;
  agentsCount: number;
  recentSessions: HomeRecentSession[];
  now: number;
}

export function HomeContent({
  userName,
  onSubmitPrompt,
  onQuickStart,
  onOpenSession,
  connectorsCount,
  skillsCount,
  agentsCount,
  recentSessions,
  now,
}: HomeContentProps) {
  const recent = recentSessions.slice(0, 5);
  const [input, setInput] = useState("");

  function submitHome() {
    const text = input.trim();
    if (!text) return;
    onSubmitPrompt(text);
  }

  return (
    <div className="mx-auto w-full max-w-[720px] px-6 py-10">
      <h1 className="text-center text-[30px] font-bold tracking-tight text-fg">
        안녕하세요, {userName}님
      </h1>
      <p className="mt-2 text-center text-[15px] text-fg-muted">
        사내 지식과 도구를 불러 업무를 시작하세요
      </p>

      {/* 홈 컴포저 — 클릭만으로 화면 전환하지 않는다. 여기서 직접 입력하고 Enter(또는 보내기)해야
          새 세션으로 이동+자동전송한다(page.tsx onSubmitPrompt). */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submitHome();
        }}
        className="mt-7 w-full rounded-[14px] border border-border bg-surface px-4 py-3 shadow-sm transition focus-within:border-primary-300"
      >
        <label htmlFor="home-composer" className="sr-only">
          메시지 입력
        </label>
        <textarea
          id="home-composer"
          aria-label="메시지 입력"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            // 한글 IME 조합 중 Enter 는 조합 확정용 — 제출 금지(마지막 글자 유실 방지).
            if (
              e.key === "Enter" &&
              !e.shiftKey &&
              !e.nativeEvent.isComposing
            ) {
              e.preventDefault();
              submitHome();
            }
          }}
          rows={1}
          placeholder="메시지를 입력하세요 — @로 에이전트·도구 호출"
          className="min-h-12 w-full resize-none bg-transparent text-[15px] text-fg outline-none placeholder:text-placeholder"
        />
        <div className="mt-2 flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="flex h-[30px] w-[30px] items-center justify-center rounded-md border border-border text-fg-muted"
          >
            +
          </span>
          <span
            aria-hidden="true"
            className="flex h-[30px] w-[30px] items-center justify-center rounded-md border border-border text-sm font-medium text-fg-muted"
          >
            @
          </span>
          <span
            aria-hidden="true"
            className="flex h-[30px] w-[30px] items-center justify-center rounded-md border border-border text-sm font-medium text-fg-muted"
          >
            /
          </span>
          <span
            aria-hidden="true"
            className="ml-1.5 inline-flex h-[30px] items-center rounded-md border border-border px-2.5 text-xs text-fg"
          >
            Claude Sonnet
          </span>
          <button
            type="submit"
            disabled={!input.trim()}
            aria-label="보내기"
            className="ml-auto flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-fg transition disabled:opacity-40"
          >
            <ArrowUp size={16} strokeWidth={2.5} />
          </button>
        </div>
      </form>

      <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {QUICK_STARTS.map((qs) => (
          <button
            key={qs.title}
            type="button"
            onClick={() => onQuickStart(qs.prompt)}
            className={`flex items-start gap-3 rounded-[10px] border px-4 py-3.5 text-left transition hover:border-primary-300 ${
              qs.featured
                ? "border-primary-300 bg-primary-50"
                : "border-border bg-bg"
            }`}
          >
            <qs.icon size={17} strokeWidth={1.8} />
            <div>
              <div className="text-sm font-semibold text-fg">{qs.title}</div>
              <div className="mt-0.5 text-xs text-fg-muted">{qs.desc}</div>
            </div>
          </button>
        ))}
      </div>

      <div className="mt-5 flex items-center justify-center gap-2 text-xs text-fg-muted">
        <a
          href="/settings/mcp"
          data-testid="capability-connectors"
          className="font-medium hover:text-fg"
        >
          커넥터{" "}
          <span className="font-mono tabular-nums">{connectorsCount}</span>{" "}
          연결됨
        </a>
        <span className="text-border">·</span>
        <a
          href="/settings/skills"
          data-testid="capability-agents"
          className="font-medium hover:text-fg"
        >
          에이전트 <span className="font-mono tabular-nums">{agentsCount}</span>
        </a>
        <span className="text-border">·</span>
        <a
          href="/settings/skills"
          data-testid="capability-skills"
          className="font-medium hover:text-fg"
        >
          스킬 <span className="font-mono tabular-nums">{skillsCount}</span>
        </a>
      </div>

      <div className="mt-9">
        <div className="mb-1.5 text-xs font-semibold text-fg-muted">
          최근 세션
        </div>
        {recent.length === 0 ? (
          <p className="px-3 py-4 text-sm text-fg-subtle">
            최근 세션이 없습니다.
          </p>
        ) : (
          <div className="flex flex-col">
            {recent.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => onOpenSession(s.id)}
                className="flex items-center gap-2.5 border-b border-surface-2 px-3 py-2.5 text-left last:border-b-0 hover:bg-surface"
              >
                <span className="flex-1 truncate text-[13.5px] text-fg">
                  {s.title ?? "(제목 없음)"}
                </span>
                <span className="font-mono text-[11px] text-fg-subtle">
                  {formatRelativeTime(s.lastMessageAt, now)}
                </span>
                <ChevronRight
                  size={13}
                  strokeWidth={2}
                  className="text-fg-subtle"
                />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
