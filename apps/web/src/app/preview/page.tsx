"use client";

// app/preview/page.tsx — P10 브라우저 검증용 컴포넌트 갤러리 (dev 전용, 인증/서버 불필요).
//   Playwright(e2e/*.pw.ts)가 이 라우트를 headless 로 열어 실제 렌더/CSS/인터랙션을 검증.
//   각 FE 태스크는 자기 컴포넌트를 data-testid="preview-<name>" 섹션으로 여기에 추가한다.
import React, { useState } from "react";
import { ThemeToggle } from "../../components/layout/ThemeToggle";
import { AppShell } from "../../components/layout/AppShell";
import { SessionList } from "../../components/sessions/SessionList";
import { CommandPalette } from "../../components/sessions/CommandPalette";
import { Markdown } from "../../components/chat/Markdown";
import { Reasoning } from "../../components/chat/Reasoning";
import { MessageActions } from "../../components/chat/MessageActions";
import { ToolCallRenderer } from "../../components/chat/ToolCallRenderer";
import { StatusChip } from "../../components/chat/StatusChip";
import { ActivityPanel } from "../../components/chat/ActivityPanel";
import { HitlPrompt } from "../../components/chat/HitlPrompt";
import { ChatInput } from "../../components/chat/ChatInput";
import {
  ChatView,
  MessageItem,
  CompareColumns,
} from "../../components/chat/ChatView";
import type { CompareGroup } from "../../hooks/useSessionStream";
import { ProjectPicker } from "../../components/chat/ProjectPicker";
import { MemoryPanel } from "../../components/chat/MemoryPanel";
import { ShareExportMenu } from "../../components/chat/ShareExportMenu";
import { SharePublicView } from "../../components/share/SharePublicView";
import { ConversationSharePublicView } from "../../components/share/ConversationSharePublicView";
import { LoginForm } from "../../components/auth/LoginForm";
import { SignupForm } from "../../components/auth/SignupForm";
import { HomeContent } from "../../components/home/HomeContent";
import { ProjectDetail } from "../../components/projects/ProjectDetail";
import { McpServersManager } from "../../components/settings/McpServersManager";
import { SkillsManager } from "../../components/settings/SkillsManager";
import { AgentGallery } from "../../components/agents/AgentGallery";
import { ConnectionsManager } from "../../components/settings/ConnectionsManager";
import { MemoryManager } from "../../components/settings/MemoryManager";
import { QuotaPanel } from "../../components/settings/QuotaPanel";
import { AdminDashboard } from "../../components/admin/AdminDashboard";
import { ToolMetricsTable } from "../../components/admin/ToolMetricsTable";
import { AdminUsersManager } from "../../components/admin/AdminUsersManager";
import { GroupsManager } from "../../components/admin/GroupsManager";
import { GrantsManager } from "../../components/admin/GrantsManager";
import { AnalyticsDashboard } from "../../components/admin/AnalyticsDashboard";
import { AuditLogTable } from "../../components/admin/AuditLogTable";
import { AdminSettingsScreen } from "../../components/admin/settings/AdminSettingsScreen";
import { ToastContainer } from "../../components/layout/ToastContainer";
import { InstallPwaButton } from "../../components/InstallPwaButton";
import {
  ArtifactCanvas,
  type ArtifactCanvasArtifact,
} from "../../components/artifacts/ArtifactCanvas";
import { ArtifactPanel } from "../../components/artifacts/ArtifactPanel";
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

// P13-T6-05 — HitlPrompt(F06)는 z-hitl 딤 모달(fixed inset-0)로 재구현되어 항상 마운트하면
// 갤러리의 다른 섹션을 가려버린다. ArtifactCanvasPreview/MemoryPanelPreview 와 동일하게
// 기본 닫힘 + 토글 버튼으로 감싸 다른 프리뷰/e2e 스펙과 충돌하지 않게 한다.
function HitlPromptPreview() {
  const [open, setOpen] = useState(false);
  return open ? (
    <HitlPrompt
      request={{
        toolCallId: "preview-hitl-1",
        toolName: "send_email",
        args: { to: "a@b.com", subject: "안녕하세요" },
        rationale: "외부로 이메일을 발송합니다.",
        expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      }}
      onRespond={() => setOpen(false)}
    />
  ) : (
    <button
      type="button"
      data-testid="hitl-prompt-preview-trigger"
      onClick={() => setOpen(true)}
      className="rounded-md border border-border px-3 py-1.5 text-sm text-fg-muted hover:border-primary hover:text-fg"
    >
      HITL 카드 열기
    </button>
  );
}

// P20-T1-07 — CommandPalette(⌘K 검색)는 lib/sessionSearch.searchSessions 로 실 fetch 하므로
// HitlPromptPreview 와 동일하게 토글 오픈으로 격리한다(전용 e2e 가 page.route() 로
// /api/v1/sessions/search 를 목킹해 접두어 힌트칩+쿼리 그대로 전달을 검증한다).
function CommandPalettePreview() {
  const [open, setOpen] = useState(false);
  return open ? (
    <CommandPalette open={true} onClose={() => setOpen(false)} />
  ) : (
    <button
      type="button"
      data-testid="command-palette-preview-trigger"
      onClick={() => setOpen(true)}
      className="rounded-md border border-border px-3 py-1.5 text-sm text-fg-muted hover:border-primary hover:text-fg"
    >
      검색 팔레트 열기
    </button>
  );
}

// P13-T6-10 — ProjectDetail(F09)은 useProject/useDocuments 로 내부 fetch 하며 404 시
//   next/navigation.notFound() 를 throw 한다. 갤러리에 무조건 마운트하면 dev 서버에
//   백엔드가 없을 때(다른 e2e 스펙이 이 경로를 목킹하지 않고 /preview 를 여는 경우) 전체
//   갤러리가 깨지므로 HitlPromptPreview 와 동일하게 토글 오픈으로 격리한다.
//   전용 e2e(project-documents.pw.ts)만 page.route() 로 /api/v1/projects,
//   /api/v1/documents 를 목킹한 뒤 이 버튼을 클릭한다.
function ProjectDetailPreview() {
  const [open, setOpen] = useState(false);
  return open ? (
    <ProjectDetail projectId="preview-project-1" />
  ) : (
    <button
      type="button"
      data-testid="project-detail-preview-trigger"
      onClick={() => setOpen(true)}
      className="rounded-md border border-border px-3 py-1.5 text-sm text-fg-muted hover:border-primary hover:text-fg"
    >
      프로젝트 상세 열기
    </button>
  );
}

// P13-T6-11 — McpServersManager/SkillsManager 는 각각 useMcpServers/useSkills 로 마운트 시
//   내부 fetch 한다. ProjectDetailPreview 와 동일하게 토글 오픈으로 격리해 dev 서버에 백엔드가
//   없어도 갤러리 전체가 깨지지 않게 한다. 전용 e2e(mcp-servers-manager.pw.ts,
//   skills-manager.pw.ts)만 page.route() 로 API 를 목킹한 뒤 트리거를 클릭한다.
function McpServersManagerPreview() {
  const [open, setOpen] = useState(false);
  return open ? (
    <McpServersManager />
  ) : (
    <button
      type="button"
      data-testid="mcp-servers-manager-preview-trigger"
      onClick={() => setOpen(true)}
      className="rounded-md border border-border px-3 py-1.5 text-sm text-fg-muted hover:border-primary hover:text-fg"
    >
      커넥터 관리 열기
    </button>
  );
}

function SkillsManagerPreview() {
  const [open, setOpen] = useState(false);
  return open ? (
    <SkillsManager />
  ) : (
    <button
      type="button"
      data-testid="skills-manager-preview-trigger"
      onClick={() => setOpen(true)}
      className="rounded-md border border-border px-3 py-1.5 text-sm text-fg-muted hover:border-primary hover:text-fg"
    >
      스킬 관리 열기
    </button>
  );
}

// P22-T6-10 — AgentGallery 도 useAgents 로 마운트 시 /api/v1/agents 를 fetch 한다.
//   위 두 프리뷰와 동일한 토글 격리 패턴. 전용 e2e(agent-gallery.pw.ts)만 page.route()
//   로 API 를 목킹한 뒤 트리거를 클릭한다.
function AgentGalleryPreview() {
  const [open, setOpen] = useState(false);
  return open ? (
    <AgentGallery />
  ) : (
    <button
      type="button"
      data-testid="agent-gallery-preview-trigger"
      onClick={() => setOpen(true)}
      className="rounded-md border border-border px-3 py-1.5 text-sm text-fg-muted hover:border-primary hover:text-fg"
    >
      에이전트 갤러리 열기
    </button>
  );
}

// P22-T6-14 — ConnectionsManager 도 마운트 시 /api/v1/connections 를 fetch 한다. 위와 동일한
//   토글 격리 패턴. 전용 e2e(connections.pw.ts)만 page.route() 로 API 를 목킹한 뒤 트리거를 클릭.
function ConnectionsManagerPreview() {
  const [open, setOpen] = useState(false);
  return open ? (
    <ConnectionsManager />
  ) : (
    <button
      type="button"
      data-testid="connections-manager-preview-trigger"
      onClick={() => setOpen(true)}
      className="rounded-md border border-border px-3 py-1.5 text-sm text-fg-muted hover:border-primary hover:text-fg"
    >
      연결 관리 열기
    </button>
  );
}

// P13-T6-12 — MemoryManager/QuotaPanel 은 각각 useMemories/useQuota 로 마운트 시 내부
//   fetch 한다. McpServersManagerPreview 와 동일하게 토글 오픈으로 격리해 dev 서버에 백엔드가
//   없어도 갤러리 전체가 깨지지 않게 한다. 전용 e2e(memory-manager.pw.ts, quota-panel.pw.ts)만
//   page.route() 로 API 를 목킹한 뒤 트리거를 클릭한다.
function MemoryManagerPreview() {
  const [open, setOpen] = useState(false);
  return open ? (
    <MemoryManager />
  ) : (
    <button
      type="button"
      data-testid="memory-manager-preview-trigger"
      onClick={() => setOpen(true)}
      className="rounded-md border border-border px-3 py-1.5 text-sm text-fg-muted hover:border-primary hover:text-fg"
    >
      메모리 설정 열기
    </button>
  );
}

function QuotaPanelPreview() {
  const [open, setOpen] = useState(false);
  return open ? (
    <QuotaPanel />
  ) : (
    <button
      type="button"
      data-testid="quota-panel-preview-trigger"
      onClick={() => setOpen(true)}
      className="rounded-md border border-border px-3 py-1.5 text-sm text-fg-muted hover:border-primary hover:text-fg"
    >
      사용량 열기
    </button>
  );
}

// P13-T6-13 — AdminDashboard/ToolMetricsTable/AdminUsersManager 도 마운트 시 내부 fetch
//   하므로 QuotaPanelPreview 와 동일하게 토글 오픈으로 격리한다.
function AdminDashboardPreview() {
  const [open, setOpen] = useState(false);
  return open ? (
    <AdminDashboard />
  ) : (
    <button
      type="button"
      data-testid="admin-dashboard-preview-trigger"
      onClick={() => setOpen(true)}
      className="rounded-md border border-border px-3 py-1.5 text-sm text-fg-muted hover:border-primary hover:text-fg"
    >
      관리 대시보드 열기
    </button>
  );
}

function ToolMetricsTablePreview() {
  const [open, setOpen] = useState(false);
  return open ? (
    <ToolMetricsTable />
  ) : (
    <button
      type="button"
      data-testid="tool-metrics-table-preview-trigger"
      onClick={() => setOpen(true)}
      className="rounded-md border border-border px-3 py-1.5 text-sm text-fg-muted hover:border-primary hover:text-fg"
    >
      도구 지표 열기
    </button>
  );
}

function AdminUsersManagerPreview() {
  const [open, setOpen] = useState(false);
  return open ? (
    <AdminUsersManager />
  ) : (
    <button
      type="button"
      data-testid="admin-users-manager-preview-trigger"
      onClick={() => setOpen(true)}
      className="rounded-md border border-border px-3 py-1.5 text-sm text-fg-muted hover:border-primary hover:text-fg"
    >
      사용자 관리 열기
    </button>
  );
}

function GroupsManagerPreview() {
  const [open, setOpen] = useState(false);
  return open ? (
    <GroupsManager />
  ) : (
    <button
      type="button"
      data-testid="groups-manager-preview-trigger"
      onClick={() => setOpen(true)}
      className="rounded-md border border-border px-3 py-1.5 text-sm text-fg-muted hover:border-primary hover:text-fg"
    >
      그룹 관리 열기
    </button>
  );
}

function GrantsManagerPreview() {
  const [open, setOpen] = useState(false);
  return open ? (
    <GrantsManager />
  ) : (
    <button
      type="button"
      data-testid="grants-manager-preview-trigger"
      onClick={() => setOpen(true)}
      className="rounded-md border border-border px-3 py-1.5 text-sm text-fg-muted hover:border-primary hover:text-fg"
    >
      접근 권한 관리 열기
    </button>
  );
}

function AnalyticsDashboardPreview() {
  const [open, setOpen] = useState(false);
  return open ? (
    <AnalyticsDashboard />
  ) : (
    <button
      type="button"
      data-testid="analytics-dashboard-preview-trigger"
      onClick={() => setOpen(true)}
      className="rounded-md border border-border px-3 py-1.5 text-sm text-fg-muted hover:border-primary hover:text-fg"
    >
      사용량 분석 열기
    </button>
  );
}

function AuditLogTablePreview() {
  const [open, setOpen] = useState(false);
  return open ? (
    <AuditLogTable />
  ) : (
    <button
      type="button"
      data-testid="audit-log-table-preview-trigger"
      onClick={() => setOpen(true)}
      className="rounded-md border border-border px-3 py-1.5 text-sm text-fg-muted hover:border-primary hover:text-fg"
    >
      감사 로그 열기
    </button>
  );
}

function AdminSettingsScreenPreview() {
  const [open, setOpen] = useState(false);
  return open ? (
    <AdminSettingsScreen />
  ) : (
    <button
      type="button"
      data-testid="admin-settings-screen-preview-trigger"
      onClick={() => setOpen(true)}
      className="rounded-md border border-border px-3 py-1.5 text-sm text-fg-muted hover:border-primary hover:text-fg"
    >
      관리자 설정 열기
    </button>
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

// P13-T6-07 — F07(우패널 '활동' 탭) 프리뷰 데이터: 완료 2·실행 중 1·대기 1 워커로
//   프레임의 병렬 진행 예시(2 done/1 running/1 queued)를 재현.
const ACTIVITY_PROGRESS = {
  stage: "researching" as const,
  label: "2/4 하위질문 조사 완료",
  tasks: [
    {
      id: "sq-0",
      title: "글로벌 히트펌프 시장 규모·성장률",
      status: "done" as const,
      sourceCount: 9,
    },
    {
      id: "sq-1",
      title: "주요 OEM 열관리 아키텍처 동향",
      status: "done" as const,
      sourceCount: 7,
    },
    {
      id: "sq-2",
      title: "국내외 부품사 경쟁 구도",
      status: "running" as const,
      sourceCount: 2,
    },
    {
      id: "sq-3",
      title: "규제·보조금 영향",
      status: "queued" as const,
    },
  ],
};

function ActivityPanelPreview() {
  const [stopped, setStopped] = useState(false);
  return (
    <div className="flex h-[640px] overflow-hidden rounded-lg border border-border">
      <ActivityPanel
        progress={ACTIVITY_PROGRESS}
        onStop={() => setStopped(true)}
      />
      <p
        data-testid="activity-panel-stopped"
        className={stopped ? "px-3 py-2 text-xs text-fg-muted" : "sr-only"}
      >
        {stopped ? "중지 요청됨" : "중지 미요청"}
      </p>
    </div>
  );
}

// P13-T6-08 — F4/§6 CitationChip 핸드오프: 우패널 '출처' 탭 데모용 인용 1건.
const PREVIEW_CITATIONS = [
  {
    index: 1,
    source: "project" as const,
    filename: "열관리모듈_시험성적서.pdf",
    page: 7,
    snippet: "시험 결과 열관리 모듈의 평균 방열 효율은 92.4% 로 측정되었다.",
  },
];

// P13-T6-09 — design-reference §6 CitationChip: 클릭 시 우패널 '출처' 탭 원문 하이라이트가
// primary-100 배경으로 2초간 유지되다 페이드아웃된다(ChatView 의 실제 auto-clear 와 동일 패턴).
function useFadingCitationFocus() {
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null);
  React.useEffect(() => {
    if (focusedIndex === null) return;
    const timer = setTimeout(() => setFocusedIndex(null), 2000);
    return () => clearTimeout(timer);
  }, [focusedIndex]);
  return { focusedIndex, setFocusedIndex };
}

function ArtifactCanvasPreview() {
  const [open, setOpen] = useState(true);
  const [activeIndex, setActiveIndex] = useState(1);
  const { focusedIndex, setFocusedIndex } = useFadingCitationFocus();
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mb-3 rounded-md border border-border px-3 py-1.5 text-sm text-fg-muted hover:border-primary hover:text-fg"
      >
        패널 다시 열기
      </button>
      <button
        type="button"
        data-testid="citation-focus-trigger"
        onClick={() => setFocusedIndex(1)}
        className="mb-3 ml-2 rounded-md border border-border px-3 py-1.5 text-sm text-fg-muted hover:border-primary hover:text-fg"
      >
        출처 하이라이트 트리거
      </button>
      {open && (
        <div className="relative h-[420px] overflow-hidden rounded-lg border border-border">
          <ArtifactCanvas
            artifacts={ARTIFACTS}
            activeIndex={activeIndex}
            onActiveIndexChange={setActiveIndex}
            onClose={() => setOpen(false)}
            citations={PREVIEW_CITATIONS}
            focusedCitationIndex={focusedIndex}
            activityProgress={ACTIVITY_PROGRESS}
          />
        </div>
      )}
    </div>
  );
}

// P20-T6-03 — sandbox="allow-scripts" iframe(스크립트 실행 허용, allow-same-origin 미병기)이
//   실제 브라우저에서 인터랙티브 HTML 아티팩트의 스크립트를 실행하는지 검증하는 전용 프리뷰.
//   e2e/artifact-html-sandbox.pw.ts 가 이 artifactId 의 content 를 page.route() 로 목킹한다.
function ArtifactHtmlSandboxPreview() {
  return (
    <div className="h-[280px] overflow-hidden rounded-lg border border-border">
      <ArtifactPanel
        artifact={{
          id: "preview-artifact-html-1",
          type: "html",
          filename: "demo.html",
          sizeBytes: 256,
          storageKind: "inline",
          downloadUrl: null,
          createdAt: new Date(0).toISOString(),
        }}
      />
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

// P21-T6-04(UX-16) — 세션 전환 시 이전 대화가 그대로 남던 버그의 실앱 재현 하네스.
//   실제 라우팅(App Router 클라이언트 내비게이션)과 동일하게 ChatView 를 언마운트하지 않고
//   sessionId prop 만 바꿔 전환한다(버튼 클릭 = 사이드바에서 다른 세션 클릭과 동일 시나리오).
function SessionSwitchPreview() {
  const [sessionId, setSessionId] = useState("preview-session-a");
  return (
    <div className="flex h-[420px] flex-col gap-2">
      <div className="flex gap-2">
        <button
          type="button"
          data-testid="session-switch-a"
          onClick={() => setSessionId("preview-session-a")}
          className="rounded-md border border-border px-3 py-1 text-sm"
        >
          세션 A 열기
        </button>
        <button
          type="button"
          data-testid="session-switch-b"
          onClick={() => setSessionId("preview-session-b")}
          className="rounded-md border border-border px-3 py-1 text-sm"
        >
          세션 B 열기
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden rounded-md border border-border">
        <ChatView sessionId={sessionId} />
      </div>
    </div>
  );
}

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

// P22-T6-05 — 응답 생성 중 메시지 큐잉(Open WebUI 파리티) 실브라우저 검증 하네스.
//   MessageBranchPreview/SessionSwitchPreview 와 동일하게 useSessionStream 의 큐 로직을
//   로컬 state 로 흉내내 SSE 백엔드 없이도 실제 ChatInput 의 큐 인터랙션(생성 중 Enter→칩 큐잉,
//   취소, 종료 시 FIFO 자동 디스패치)을 결정론적으로 재현한다(e2e/message-queue.pw.ts).
function MessageQueuePreview() {
  type Turn = {
    id: string;
    role: "user" | "assistant";
    content: string;
    streaming: boolean;
  };
  const [turns, setTurns] = useState<Turn[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [queued, setQueued] = useState<{ id: string; content: string }[]>([]);
  const idRef = React.useRef(0);

  // 새 턴 디스패치: 낙관적 유저 버블 + 스트리밍 중 assistant 버블(실 useSessionStream 과 동형).
  function dispatch(content: string) {
    const uid = `mq-u-${idRef.current++}`;
    const aid = `mq-a-${idRef.current++}`;
    setTurns((t) => [
      ...t,
      { id: uid, role: "user", content, streaming: false },
      {
        id: aid,
        role: "assistant",
        content: `“${content}” 응답 생성 중…`,
        streaming: true,
      },
    ]);
    setIsStreaming(true);
  }

  // 생성 중이면 abort 하지 않고 큐잉(FIFO), 아니면 즉시 디스패치(send() 계약과 동형).
  function handleSend(content: string) {
    if (isStreaming) {
      setQueued((q) => [...q, { id: `mq-q-${idRef.current++}`, content }]);
      return;
    }
    dispatch(content);
  }

  // 현재 스트림 종료 → streamTurn.finally 의 drainQueueRef 처럼 큐 헤드를 FIFO 로 자동 디스패치.
  function finishResponse() {
    setTurns((t) =>
      t.map((m) =>
        m.streaming
          ? {
              ...m,
              streaming: false,
              content: m.content.replace("응답 생성 중…", "응답 완료"),
            }
          : m,
      ),
    );
    setIsStreaming(false);
    if (queued.length > 0) {
      const [head, ...rest] = queued;
      setQueued(rest);
      if (head) dispatch(head.content);
    }
  }

  return (
    <div className="space-y-3">
      <ul data-testid="mq-messages" className="space-y-2">
        {turns.map((m) => (
          <li
            key={m.id}
            data-testid={`mq-turn-${m.role}`}
            data-streaming={m.streaming}
            className="rounded-md border border-border px-3 py-2 text-sm text-fg"
          >
            <span className="mr-2 text-xs uppercase text-fg-muted">
              {m.role}
            </span>
            {m.content}
          </li>
        ))}
      </ul>
      {isStreaming && (
        <button
          type="button"
          data-testid="mq-finish-response"
          onClick={finishResponse}
          className="rounded-md border border-border px-3 py-1.5 text-sm text-fg-muted hover:border-primary hover:text-fg"
        >
          응답 완료(스트림 종료)
        </button>
      )}
      <ChatInput
        sessionId="preview-queue"
        isStreaming={isStreaming}
        onSend={(content) => handleSend(content)}
        onStop={() => {}}
        queuedMessages={queued}
        onRemoveQueued={(id) =>
          setQueued((q) => q.filter((item) => item.id !== id))
        }
      />
    </div>
  );
}

// P22-T6-06 — 멀티모델 병렬 비교(Open WebUI 파리티) 실브라우저 검증 하네스.
//   MessageQueuePreview 와 동일하게 useSessionStream 의 팬아웃 로직을 로컬 state 로 흉내내
//   SSE 백엔드 없이도 실제 ChatInput 의 비교 토글(⚖️ 비교 → 모델 체크박스 2+ 선택 → 전송)과
//   실제 CompareColumns 렌더(병렬 컬럼·컬럼별 재생성 형제 페이저)를 결정론적으로 재현한다
//   (e2e/compare-columns.pw.ts). 시각/인터랙션은 Open WebUI 참조, 스타일은 시맨틱 토큰.
const COMPARE_PREVIEW_MODELS = ["model-a", "model-b"];

function CompareColumnsPreview() {
  const [groups, setGroups] = useState<CompareGroup[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const idRef = React.useRef(0);

  // onSendCompare: 선택 모델마다 스트리밍 중 컬럼(빈 답변) 하나로 그룹을 만든다.
  function handleSendCompare(content: string, models: string[]) {
    const gid = `cmp-${idRef.current++}`;
    setGroups((prev) => [
      ...prev,
      {
        id: gid,
        userContent: content,
        columns: models.map((m) => ({
          model: m,
          activeIndex: 0,
          answers: [
            {
              id: `${gid}-${m}-${idRef.current++}`,
              content: "",
              streaming: true,
            },
          ],
        })),
      },
    ]);
    setIsStreaming(true);
  }

  // 스트림 종료: 모든 컬럼의 활성 답변에 모델명이 박힌 콘텐츠를 채우고 streaming 을 내린다.
  function finishStreams() {
    setGroups((prev) =>
      prev.map((g) => ({
        ...g,
        columns: g.columns.map((col) => ({
          ...col,
          answers: col.answers.map((a, i) =>
            i === col.activeIndex && a.streaming
              ? { ...a, content: `${col.model} 응답`, streaming: false }
              : a,
          ),
        })),
      })),
    );
    setIsStreaming(false);
  }

  function regenerate(groupId: string, model: string) {
    const aid = `re-${idRef.current++}`;
    setGroups((prev) =>
      prev.map((g) =>
        g.id !== groupId
          ? g
          : {
              ...g,
              columns: g.columns.map((col) =>
                col.model !== model
                  ? col
                  : {
                      ...col,
                      answers: [
                        ...col.answers,
                        {
                          id: aid,
                          content: `${model} 재생성`,
                          streaming: false,
                        },
                      ],
                      activeIndex: col.answers.length,
                    },
              ),
            },
      ),
    );
  }

  function switchBranch(
    groupId: string,
    model: string,
    direction: "prev" | "next",
  ) {
    setGroups((prev) =>
      prev.map((g) =>
        g.id !== groupId
          ? g
          : {
              ...g,
              columns: g.columns.map((col) => {
                if (col.model !== model) return col;
                const next =
                  direction === "prev"
                    ? col.activeIndex - 1
                    : col.activeIndex + 1;
                if (next < 0 || next >= col.answers.length) return col;
                return { ...col, activeIndex: next };
              }),
            },
      ),
    );
  }

  return (
    <div className="space-y-3">
      <CompareColumns
        groups={groups}
        isStreaming={isStreaming}
        onRegenerate={regenerate}
        onSwitchBranch={switchBranch}
      />
      {isStreaming && (
        <button
          type="button"
          data-testid="compare-finish"
          onClick={finishStreams}
          className="rounded-md border border-border px-3 py-1.5 text-sm text-fg-muted hover:border-primary hover:text-fg"
        >
          스트림 종료(응답 채움)
        </button>
      )}
      <ChatInput
        sessionId="preview-compare"
        isStreaming={isStreaming}
        onSend={() => {}}
        onSendCompare={handleSendCompare}
        onStop={() => {}}
        availableModels={COMPARE_PREVIEW_MODELS}
      />
    </div>
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

// P13-T6-14 — 공유(F16)+인증 핸드오프 정렬 프리뷰. SharePublicView 는 useShare 훅이
//   실 fetch 를 수행하므로, Playwright(e2e/share-auth.pw.ts)가 page.route 로
//   /api/v1/share/:token 응답을 가로채 정상/410 두 상태를 결정론적으로 재현한다.
function SharePublicViewPreview() {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <div className="flex justify-center rounded-md bg-bg p-4">
        <SharePublicView token="preview-share-ok" />
      </div>
      <div className="flex justify-center rounded-md bg-bg p-4">
        <SharePublicView token="preview-share-expired" />
      </div>
    </div>
  );
}

// P20-T1-08 — 대화 스냅샷 공유 프리뷰. ConversationSharePublicView 는 useConversationShare
//   훅이 실 fetch 를 수행하므로, Playwright(e2e/conversation-share.pw.ts)가 page.route 로
//   /api/v1/conversation-shares/:token 응답을 가로채 정상/410 두 상태를 결정론적으로 재현한다.
function ConversationSharePublicViewPreview() {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <div className="flex justify-center rounded-md bg-bg p-4">
        <ConversationSharePublicView token="preview-conversation-ok" />
      </div>
      <div className="flex justify-center rounded-md bg-bg p-4">
        <ConversationSharePublicView token="preview-conversation-gone" />
      </div>
    </div>
  );
}

function LoginFormPreview() {
  return (
    <div className="flex justify-center">
      <LoginForm />
    </div>
  );
}

function SignupFormPreview() {
  return (
    <div className="flex justify-center">
      <SignupForm />
    </div>
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

      <Section name="install-pwa">
        <p className="mb-2 text-xs text-fg-muted">
          beforeinstallprompt 이벤트가 발화되기 전까지는 숨겨진다(설치 가능
          시에만 노출).
        </p>
        <InstallPwaButton />
      </Section>

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
        <MessageActions
          role="assistant"
          content="복사 대상 텍스트"
          meta={{
            model: "fake-model",
            provider: "fake",
            inputTokens: 128,
            outputTokens: 256,
            elapsedMs: 1834,
          }}
        />
      </Section>

      <Section name="status-chip">
        <div className="flex flex-wrap gap-2">
          <StatusChip status="queued" />
          <StatusChip status="running" />
          <StatusChip status="done" />
          <StatusChip status="error" />
          <StatusChip status="pending-approval" />
        </div>
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

      <Section name="activity-panel">
        <ActivityPanelPreview />
      </Section>

      <Section name="citation">
        <CitationPreview />
      </Section>

      <Section name="hitl-prompt">
        <HitlPromptPreview />
      </Section>

      <Section name="command-palette">
        <CommandPalettePreview />
      </Section>

      <Section name="project-documents">
        <ProjectDetailPreview />
      </Section>

      <Section name="artifact-canvas">
        <ArtifactCanvasPreview />
      </Section>

      <Section name="artifact-html-sandbox">
        <ArtifactHtmlSandboxPreview />
      </Section>

      <Section name="mcp-servers-manager">
        <McpServersManagerPreview />
      </Section>

      <Section name="skills-manager">
        <SkillsManagerPreview />
      </Section>

      <Section name="agent-gallery">
        <AgentGalleryPreview />
      </Section>

      <Section name="connections-manager">
        <ConnectionsManagerPreview />
      </Section>

      <Section name="memory-manager">
        <MemoryManagerPreview />
      </Section>

      <Section name="quota-panel">
        <QuotaPanelPreview />
      </Section>

      <Section name="admin-dashboard">
        <AdminDashboardPreview />
      </Section>

      <Section name="tool-metrics-table">
        <ToolMetricsTablePreview />
      </Section>

      <Section name="admin-users-manager">
        <AdminUsersManagerPreview />
      </Section>

      <Section name="groups-manager">
        <GroupsManagerPreview />
      </Section>

      <Section name="grants-manager">
        <GrantsManagerPreview />
      </Section>

      <Section name="admin-analytics">
        <AnalyticsDashboardPreview />
      </Section>

      <Section name="admin-audit-logs">
        <AuditLogTablePreview />
      </Section>

      <Section name="admin-settings-screen">
        <AdminSettingsScreenPreview />
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

      <Section name="message-queue">
        <MessageQueuePreview />
      </Section>

      <Section name="compare-columns">
        <CompareColumnsPreview />
      </Section>

      <Section name="message-attachments">
        {/* P22-T6-04 — 유저 버블의 이미지 첨부는 파일명 대신 썸네일(<img>)로,
            비이미지는 파일명 칩으로 렌더된다(멀티모달 파리티). */}
        <ul className="space-y-3">
          <MessageItem
            role="user"
            content="이 사진들 분석해줘"
            streaming={false}
            error={false}
            attachments={[
              {
                uploadId: "preview-att-img-1",
                filename: "photo.png",
                mimeType: "image/png",
                previewUrl:
                  "data:image/svg+xml;utf8," +
                  encodeURIComponent(
                    "<svg xmlns='http://www.w3.org/2000/svg' width='80' height='80'><rect width='80' height='80' fill='%2300287A'/></svg>",
                  ),
              },
              {
                uploadId: "preview-att-doc-1",
                filename: "spec.pdf",
                mimeType: "application/pdf",
              },
            ]}
          />
        </ul>
      </Section>

      <Section name="session-switch">
        <SessionSwitchPreview />
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
            sessionId="preview-session"
          />
        </div>
      </Section>

      <Section name="share-public-view">
        <SharePublicViewPreview />
      </Section>

      <Section name="conversation-share-public-view">
        <ConversationSharePublicViewPreview />
      </Section>

      <Section name="login-form">
        <LoginFormPreview />
      </Section>

      <Section name="signup-form">
        <SignupFormPreview />
      </Section>
    </div>
  );
}
