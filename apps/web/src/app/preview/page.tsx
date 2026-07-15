"use client";

// app/preview/page.tsx — P10 브라우저 검증용 컴포넌트 갤러리 (dev 전용, 인증/서버 불필요).
//   Playwright(e2e/*.pw.ts)가 이 라우트를 headless 로 열어 실제 렌더/CSS/인터랙션을 검증.
//   각 FE 태스크는 자기 컴포넌트를 data-testid="preview-<name>" 섹션으로 여기에 추가한다.
import React, { useState } from "react";
import { ThemeToggle } from "../../components/layout/ThemeToggle";
import { AppShell } from "../../components/layout/AppShell";
import { SessionList } from "../../components/sessions/SessionList";
import { Markdown } from "../../components/chat/Markdown";
import { Reasoning } from "../../components/chat/Reasoning";
import { MessageActions } from "../../components/chat/MessageActions";
import { ToolCallRenderer } from "../../components/chat/ToolCallRenderer";
import { HitlPrompt } from "../../components/chat/HitlPrompt";
import { ChatInput } from "../../components/chat/ChatInput";
import { MessageItem } from "../../components/chat/ChatView";
import { ProjectPicker } from "../../components/chat/ProjectPicker";
import { MemoryPanel } from "../../components/chat/MemoryPanel";
import { ShareExportMenu } from "../../components/chat/ShareExportMenu";
import { HomeContent } from "../../components/home/HomeContent";
import { ToastContainer } from "../../components/layout/ToastContainer";
import {
  ArtifactCanvas,
  type ArtifactCanvasArtifact,
} from "../../components/artifacts/ArtifactCanvas";
import { useOnlineStatus } from "../../hooks/useOnlineStatus";
import type { Citation } from "../../hooks/useSessionStream";
import type { ProjectDto } from "../../hooks/useProject";
import { showToast } from "../../lib/toast";

const CITATIONS: Citation[] = [
  {
    index: 1,
    source: "project",
    documentId: "doc-1",
    filename: "manual.pdf",
    page: 3,
    snippet: "42 는 만물의 답이다.",
  },
  {
    index: 2,
    source: "ephemeral",
    uploadId: "upload-1",
    filename: "notes.md",
    snippet: "세션에 첨부된 임시 메모.",
  },
];

function CitationPreview() {
  const [focused, setFocused] = useState<number | null>(null);
  return (
    <div>
      <Markdown citations={CITATIONS} onCitationClick={setFocused}>
        {"정답은 42입니다[1]. 추가로 메모도 참고했습니다[2]."}
      </Markdown>
      <div
        data-testid="citation-reference-footer"
        className="mt-3 border-t border-border pt-2 text-xs text-fg-muted"
      >
        <div className="font-semibold text-fg">Reference</div>
        <ul className="mt-1 space-y-1">
          {CITATIONS.map((c) => (
            <li
              key={c.index}
              id={`citation-ref-${c.index}`}
              data-testid={`citation-ref-${c.index}`}
              data-focused={focused === c.index}
              className="rounded px-1 py-0.5 data-[focused=true]:bg-primary/10 data-[focused=true]:text-fg"
            >
              [{c.index}] {c.filename}
              {c.page ? ` p.${c.page}` : ""}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

const ARTIFACTS: ArtifactCanvasArtifact[] = [
  {
    artifactId: "preview-artifact-1",
    artifactKind: "markdown",
    filename: "report-v1.md",
    sizeBytes: 512,
  },
  {
    artifactId: "preview-artifact-2",
    artifactKind: "markdown",
    filename: "report-v2.md",
    sizeBytes: 1024,
  },
];

function ArtifactCanvasPreview() {
  const [open, setOpen] = useState(true);
  const [activeIndex, setActiveIndex] = useState(1);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mb-3 rounded-md border border-border px-3 py-1.5 text-sm text-fg-muted hover:border-primary hover:text-fg"
      >
        패널 다시 열기
      </button>
      {open && (
        <div className="relative h-[420px] overflow-hidden rounded-lg border border-border">
          <ArtifactCanvas
            artifacts={ARTIFACTS}
            activeIndex={activeIndex}
            onActiveIndexChange={setActiveIndex}
            onClose={() => setOpen(false)}
          />
        </div>
      )}
    </div>
  );
}

const SLASH_COMMANDS = [
  { id: "clear", label: "대화 지우기" },
  { id: "search", label: "웹 검색" },
];

// P10-T6-14 — 프로젝트 스코핑 프리뷰 데모 데이터.
const PREVIEW_PROJECTS: ProjectDto[] = [
  {
    id: "proj-1",
    name: "영업 RFP 분석",
    description: null,
    visibility: "private",
    orgUnitId: null,
    ownerId: "user-1",
    createdAt: "2026-04-01T00:00:00Z",
  },
  {
    id: "proj-2",
    name: "사내 정책",
    description: null,
    visibility: "org",
    orgUnitId: null,
    ownerId: "user-2",
    createdAt: "2026-04-02T00:00:00Z",
  },
];

function ProjectPickerPreview() {
  const [projectId, setProjectId] = useState<string | null>(null);
  return (
    <ProjectPicker
      projects={PREVIEW_PROJECTS}
      projectId={projectId}
      onSelect={setProjectId}
    />
  );
}

// P10-T6-15 — 메시지 편집/분기(트리) + 형제 페이저 프리뷰 데모.
//   실제 useSessionStream 대신 로컬 state 로 분기 배열을 흉내내 SSE 없이도
//   편집→새 분기 생성→페이저 전환 인터랙션을 그대로 재현한다.
function MessageBranchPreview() {
  const [branches, setBranches] = useState(["원본 질문입니다."]);
  const [replies] = useState(["이것이 첫 번째 응답입니다."]);
  const [activeIndex, setActiveIndex] = useState(0);

  return (
    <ul className="space-y-3">
      <MessageItem
        role="user"
        content={branches[activeIndex] ?? ""}
        streaming={false}
        error={false}
        {...(branches.length > 1
          ? { branch: { index: activeIndex + 1, count: branches.length } }
          : {})}
        onEditSubmit={(nextContent) => {
          setBranches((prev) => {
            const next = [...prev, nextContent];
            setActiveIndex(next.length - 1);
            return next;
          });
        }}
        onSwitchBranch={(direction) => {
          setActiveIndex((idx) =>
            direction === "prev"
              ? Math.max(0, idx - 1)
              : Math.min(branches.length - 1, idx + 1),
          );
        }}
      />
      <MessageItem
        role="assistant"
        content={
          replies[activeIndex] ?? "새 분기에 대한 응답을 기다리는 중입니다."
        }
        streaming={false}
        error={false}
      />
    </ul>
  );
}

function MemoryPanelPreview() {
  const [open, setOpen] = useState(true);
  return open ? (
    <MemoryPanel onClose={() => setOpen(false)} />
  ) : (
    <button
      type="button"
      onClick={() => setOpen(true)}
      className="rounded-md border border-border px-3 py-1.5 text-sm text-fg-muted hover:border-primary hover:text-fg"
    >
      메모리 패널 다시 열기
    </button>
  );
}

// P10-T6-13 — 모델/모드 피커 프리뷰 데모 데이터.
const AVAILABLE_MODELS = ["claude-opus-4-7", "claude-sonnet-4-6"];
const AVAILABLE_TOOLS = ["knowledge_search", "web_search"];

// P13-T6-04 — F05 핸드오프: 카테고리 탭(전체/에이전트/도구/커넥터/파일/지식) + 정책 배지
//   (읽기 전용/승인 필요) 데모용으로 5개 kind 를 모두 포함하고 policy 예시를 채운다.
const MENTION_ENTITIES = [
  { id: "agent-quality", kind: "agent" as const, label: "품질 리포트" },
  {
    id: "tool-knowledge-search",
    kind: "tool" as const,
    label: "knowledge_search",
    policy: "readonly" as const,
  },
  {
    id: "connector-work-order",
    kind: "connector" as const,
    label: "work_order.update",
    policy: "approval" as const,
  },
  { id: "kb-product-spec", kind: "knowledge" as const, label: "product-spec" },
];

const MD = `# 렌더 검증

**볼드**, _이탤릭_, 그리고 \`인라인 코드\`.

\`\`\`ts
const answer: number = 42;
function greet(name: string) {
  return \`안녕 \${name}\`;
}
\`\`\`

| 열 A | 열 B |
| --- | --- |
| 1 | 2 |

인라인 수식 $E = mc^2$ 그리고 블록:

$$\\int_0^1 x^2\\,dx = \\tfrac13$$
`;

// P10-T6-17 — 에러/신뢰 프리뷰 데모: 재시도 가능/불가능 error 배너, 토스트, 오프라인 배너.
function ErrorBannerPreview() {
  return (
    <ul className="space-y-3">
      <MessageItem
        role="assistant"
        content="요청이 너무 많습니다"
        error
        retryable
        errorCategory="rate-limit"
        streaming={false}
        onRegenerate={() => showToast("info", "재시도를 눌렀습니다")}
      />
      <MessageItem
        role="assistant"
        content="크레딧이 부족합니다"
        error
        retryable={false}
        streaming={false}
      />
    </ul>
  );
}

function ToastPreview() {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => showToast("error", "전송에 실패했습니다")}
          className="rounded-md border border-border px-3 py-1.5 text-sm text-fg-muted hover:border-primary hover:text-fg"
        >
          에러 토스트
        </button>
        <button
          type="button"
          onClick={() => showToast("success", "저장되었습니다")}
          className="rounded-md border border-border px-3 py-1.5 text-sm text-fg-muted hover:border-primary hover:text-fg"
        >
          성공 토스트
        </button>
        <button
          type="button"
          onClick={() => showToast("info", "새 버전이 있습니다")}
          className="rounded-md border border-border px-3 py-1.5 text-sm text-fg-muted hover:border-primary hover:text-fg"
        >
          정보 토스트
        </button>
      </div>
      <ToastContainer />
    </div>
  );
}

function OfflineBannerPreview() {
  const online = useOnlineStatus();
  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => window.dispatchEvent(new Event("offline"))}
          className="rounded-md border border-border px-3 py-1.5 text-sm text-fg-muted hover:border-primary hover:text-fg"
        >
          오프라인으로 전환
        </button>
        <button
          type="button"
          onClick={() => window.dispatchEvent(new Event("online"))}
          className="rounded-md border border-border px-3 py-1.5 text-sm text-fg-muted hover:border-primary hover:text-fg"
        >
          온라인으로 복귀
        </button>
      </div>
      {!online && (
        <div
          data-testid="offline-banner"
          role="status"
          className="rounded-lg border border-accent/30 bg-accent/10 px-4 py-2 text-center text-xs text-accent"
        >
          오프라인 상태입니다 — 연결이 복구되면 다시 전송할 수 있어요.
        </div>
      )}
    </div>
  );
}

// P13-T6-01 — AppShell(헤더·나비레일·세션사이드바·우패널) 핸드오프 정렬 프리뷰.
//   실 API 대신 useSessions/useCurrentUser 의 fetch 를 Playwright page.route() 로 목킹해
//   빈 상태가 아닌 실제 프레임 값으로 렌더 검증한다(e2e/app-shell.pw.ts).
function AppShellPreview() {
  return (
    <AppShell
      sidebar={<SessionList now={new Date("2026-07-15T09:00:00Z")} />}
      rightPanel={
        <div className="p-4 text-sm text-fg-muted">우패널 콘텐츠 예시</div>
      }
    >
      <div className="p-6 text-sm text-fg-muted">본문 예시 영역</div>
    </AppShell>
  );
}

const HOME_PREVIEW_SESSIONS = [
  {
    id: "hs1",
    title: "등속조인트 공정 불량 원인 분석",
    lastMessageAt: new Date("2026-07-15T11:50:00Z").toISOString(),
    projectId: null,
    archived: false,
  },
  {
    id: "hs2",
    title: "열관리 모듈 시험성적서 요약",
    lastMessageAt: new Date("2026-07-15T10:00:00Z").toISOString(),
    projectId: null,
    archived: false,
  },
  {
    id: "hs3",
    title: "협력사 RFQ 회신 초안",
    lastMessageAt: new Date("2026-07-15T07:00:00Z").toISOString(),
    projectId: null,
    archived: false,
  },
];

// P13-T6-02 — HomeContent 는 순수 프레젠테이션 컴포넌트라 실 라우터/fetch 없이 로컬 state 로
//   onNewChat/onQuickStart/onOpenSession 결과를 화면에 재현(e2e/home.pw.ts).
function HomeContentPreview() {
  const [lastAction, setLastAction] = useState("");
  return (
    <div>
      <div
        data-testid="home-last-action"
        className="mb-2 text-xs text-fg-muted"
      >
        마지막 동작: {lastAction || "(없음)"}
      </div>
      <HomeContent
        userName="김민수"
        onNewChat={() => setLastAction("새 채팅 시작")}
        onQuickStart={(prompt) => setLastAction(`빠른 시작: ${prompt}`)}
        onOpenSession={(id) => setLastAction(`세션 열기: ${id}`)}
        connectorsCount={6}
        skillsCount={13}
        agentsCount={4}
        recentSessions={HOME_PREVIEW_SESSIONS}
        now={new Date("2026-07-15T12:00:00Z").getTime()}
      />
    </div>
  );
}

// P13-T6-03 — 채팅(F04 히어로) 핸드오프 정렬 프리뷰: user primary-50 버블(radius 10) +
//   assistant 풀폭 문서형(버블 없음) + 좌측 Run Rail(발화 위치 인터리브된 툴카드에 눈금).
function ChatAgenticPreview() {
  return (
    <ul className="space-y-6">
      <MessageItem
        role="user"
        content="상반기 등속조인트 불량 원인을 QMS 최신 데이터와 교차 확인해서 표로 정리해줘."
        streaming={false}
        error={false}
      />
      <MessageItem
        role="assistant"
        content=""
        streaming={false}
        error={false}
        parts={[
          {
            type: "text",
            text: "품질관리규정 기준과 대조한 결과, 상반기 불량은 열처리 경도 편차에 집중되어 있습니다.",
          },
          {
            type: "tool",
            toolCallId: "preview-rail-1",
            name: "knowledge_search",
            args: { query: "CVJ 열처리 경도" },
            status: "done",
            result: "3개 청크 검색됨",
          },
          {
            type: "tool",
            toolCallId: "preview-rail-2",
            name: "defect.query",
            args: { part: "CVJ", period: "2026H1" },
            status: "running",
          },
          { type: "text", text: "QMS 최신 집계로 교차 확인 중입니다." },
        ]}
      />
    </ul>
  );
}

function Section({
  name,
  children,
}: {
  name: string;
  children: React.ReactNode;
}) {
  return (
    <section
      data-testid={`preview-${name}`}
      className="rounded-lg border border-border p-4"
    >
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-fg-muted">
        {name}
      </h2>
      {children}
    </section>
  );
}

export default function PreviewGallery() {
  return (
    <div className="mx-auto max-w-3xl space-y-6 bg-bg p-6 text-fg">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-primary">
          P10 컴포넌트 프리뷰
        </h1>
        <ThemeToggle />
      </div>

      <section
        data-testid="preview-app-shell"
        className="relative left-1/2 w-screen -translate-x-1/2 border-y border-border"
      >
        <h2 className="px-6 py-3 text-xs font-semibold uppercase tracking-wide text-fg-muted">
          app-shell
        </h2>
        <div className="h-[640px]">
          <AppShellPreview />
        </div>
      </section>

      <Section name="home">
        <HomeContentPreview />
      </Section>

      <Section name="chat-agentic">
        <ChatAgenticPreview />
      </Section>

      <Section name="markdown">
        <Markdown>{MD}</Markdown>
      </Section>

      <Section name="reasoning">
        <Reasoning
          content={"단계 1: 문제 파악\n단계 2: 근거 수집\n단계 3: 답변 구성"}
          streaming={false}
          durationSec={3}
        />
      </Section>

      <Section name="message-actions">
        <MessageActions role="assistant" content="복사 대상 텍스트" />
      </Section>

      <Section name="tool-call-renderer">
        <div className="space-y-3">
          <ToolCallRenderer
            toolCallId="preview-running"
            name="knowledge_search"
            args={{ query: "wchat" }}
            status="running"
          />
          <ToolCallRenderer
            toolCallId="preview-done"
            name="mcp:srv-1:search"
            args={{ query: "wchat rollout" }}
            status="done"
            result="검색 결과 3건: A, B, C"
          />
          <ToolCallRenderer
            toolCallId="preview-error"
            name="bash"
            args={{ cmd: "ls -la" }}
            status="error"
            result={{ error: { code: "TOOL_NOT_FOUND", message: "no" } }}
            onRetry={() => {}}
          />
        </div>
      </Section>

      <Section name="citation">
        <CitationPreview />
      </Section>

      <Section name="hitl-prompt">
        <HitlPrompt
          request={{
            toolCallId: "preview-hitl-1",
            toolName: "send_email",
            args: { to: "a@b.com", subject: "안녕하세요" },
            rationale: "외부로 이메일을 발송합니다.",
            expiresAt: "2026-07-14T00:05:00.000Z",
          }}
          onRespond={() => {}}
        />
      </Section>

      <Section name="artifact-canvas">
        <ArtifactCanvasPreview />
      </Section>

      <Section name="chat-input">
        <ChatInput
          sessionId="preview-session"
          isStreaming={false}
          onSend={() => {}}
          onStop={() => {}}
          slashCommands={SLASH_COMMANDS}
          onSlashCommand={() => {}}
          mentionEntities={MENTION_ENTITIES}
          availableModels={AVAILABLE_MODELS}
          availableTools={AVAILABLE_TOOLS}
          contextUsagePercent={8}
        />
      </Section>

      <Section name="message-branch">
        <MessageBranchPreview />
      </Section>

      <Section name="project-picker">
        <ProjectPickerPreview />
      </Section>

      <Section name="memory-panel">
        <MemoryPanelPreview />
      </Section>

      <Section name="error-banner">
        <ErrorBannerPreview />
      </Section>

      <Section name="toast">
        <ToastPreview />
      </Section>

      <Section name="offline-banner">
        <OfflineBannerPreview />
      </Section>

      <Section name="share-export-menu">
        <div className="flex justify-end">
          <ShareExportMenu
            title="WChat 대화"
            messages={[
              { role: "user", content: "이번 분기 매출 요약해줘" },
              {
                role: "assistant",
                content: "이번 분기 매출은 전분기 대비 12% 상승했습니다.",
              },
            ]}
            artifacts={ARTIFACTS}
          />
        </div>
      </Section>
    </div>
  );
}
