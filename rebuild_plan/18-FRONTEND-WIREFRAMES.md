# 18 · Frontend Wireframes & UI/UX 명세

> 프론트엔드 (`apps/web`, Next.js 15 App Router + React 19 + Tailwind v4) 의 화면 구조 / 컴포넌트 트리 / Context / 상태관리 / 디자인 토큰 단일 출처.
>
> 원본 코드 (시나리오 1) 가 있으면 디자인 정확 재현이 가능하지만 — 본 plan 만으로도 **기능적으로 동등하고 UX 패턴이 일관된 v2 UI** 를 작성할 수 있도록 모든 의사결정 명시.

## 18.1 · 화면 인벤토리

| Route | Page | 인증 | 책임 | API 의존 |
|---|---|---|---|---|
| `/login` | `app/(auth)/login/page.tsx` | none | 이메일 + magic-link 또는 password 로그인 | `POST /auth/login`, `POST /auth/magic-link` |
| `/signup` | `app/(auth)/signup/page.tsx` | none | 신규 사용자 가입 | `POST /auth/signup` |
| (`/auth/verify` 페이지 없음 — server 302 redirect 흐름) | — | none | 이메일 magic-link 가 `https://{host}/api/v1/auth/magic-link/verify?token=...` 로 직접 가리킴. server 가 cookie set + 302 redirect (/chat 또는 /login?error=...). 별도 frontend 페이지 불요. | (16 § GET /auth/magic-link/verify — 302) |
| `/` (홈) | `app/(chat)/page.tsx` | cookie | 세션 목록 + 새 세션 시작 | `GET /sessions` |
| `/chat/[sessionId]` | `app/(chat)/chat/[sessionId]/page.tsx` | cookie | **핵심 대화 화면** | `GET /sessions/:id`, `POST /sessions/:id/messages` (SSE), `DELETE /sessions/:id/active-run` |
| `/projects` | `app/projects/page.tsx` | cookie | 프로젝트 목록 (visibility 매트릭스) | `GET /projects` |
| `/projects/[projectId]` | `app/projects/[id]/page.tsx` | cookie | 프로젝트 상세 (문서 + 멤버 + 세션) | `GET /projects/:id`, `GET /projects/:id/documents`, `GET /projects/:id/members` |
| `/projects/[projectId]/documents/upload` | modal | cookie | 문서 업로드 + 인덱싱 진행 표시 | `POST /projects/:id/documents` (202 JSON) → `GET /notifications` (SSE 의 `document_indexed` event) **또는** `GET /projects/:id/documents/:docId` polling (SSE 미지원 환경 fallback) |
| `/settings/profile` | `app/settings/profile/page.tsx` | cookie | 본인 프로필 + customInstructions | `GET/PATCH /auth/me` |
| `/settings/memories` | `app/settings/memories/page.tsx` | cookie | UserMemory CRUD (4 카테고리) | `GET/POST/PATCH/DELETE /memories` |
| `/settings/skills` | `app/settings/skills/page.tsx` | cookie | 사용 가능 스킬 목록 | `GET /skills` |
| `/settings/mcp` | `app/settings/mcp/page.tsx` | cookie | MCP server 등록/관리 | `GET/POST/DELETE /mcp-servers` |
| `/settings/quota` | `app/settings/quota/page.tsx` | cookie | 사용량 + 예산 | `GET /quota`, `GET /usage/me` (self-scoped) |
| `/share/[token]` | `app/share/[token]/page.tsx` | **none** | 익명 artifact 조회 (만료 시 410) | `GET /api/v1/share/:token` (metadata) → `GET /api/v1/share/:token/content` (binary) |
| `/admin` | `app/admin/page.tsx` | admin role | 운영 대시보드 | `GET /admin/*` |
| `/admin/users` | ... | admin | 사용자 관리 | `GET/PATCH /admin/users` |
| `/admin/tool-metrics` | ... | admin | 도구 사용 통계 | `GET /admin/tool-metrics` |

**소계**: 16 routes + 1 modal (`/documents/upload`). v1.0 GA 시점. ("16개 route" 는 modal 제외 — modal 은 별도 page 경로 없이 부모 페이지 위에서 열림.)

## 18.2 · 디자인 토큰 (`apps/web/src/app/globals.css`)

```css
/* Tailwind v4 의 theme directive — CSS variable 직접 정의 */
@theme {
  /* 색상 — 라이트 + 다크 두 테마 */
  --color-primary-50:  oklch(0.97 0.02 240);
  --color-primary-500: oklch(0.55 0.18 240);   /* 메인 액션 색 */
  --color-primary-700: oklch(0.40 0.20 240);
  --color-accent:      oklch(0.65 0.20 280);   /* 보조 (예: skill 활성 표시) */
  --color-success:     oklch(0.65 0.18 145);
  --color-warning:     oklch(0.75 0.18 70);
  --color-danger:      oklch(0.55 0.22 25);
  --color-surface-0:   oklch(1.0   0    0);    /* 페이지 배경 */
  --color-surface-1:   oklch(0.98  0    0);    /* 카드 배경 */
  --color-surface-2:   oklch(0.95  0    0);    /* 호버 배경 */
  --color-border:      oklch(0.88  0    0);
  --color-text-primary:   oklch(0.20 0 0);
  --color-text-secondary: oklch(0.45 0 0);
  --color-text-muted:     oklch(0.60 0 0);

  /* 다크 테마 — :root[data-theme="dark"] */

  /* 간격 (4px grid) */
  --spacing-xs: 0.25rem;   /* 4px */
  --spacing-sm: 0.5rem;    /* 8px */
  --spacing-md: 1rem;      /* 16px */
  --spacing-lg: 1.5rem;    /* 24px */
  --spacing-xl: 2rem;      /* 32px */

  /* 폰트 — 한국어 우선 */
  --font-sans: "Pretendard", "Noto Sans KR", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  --font-mono: "JetBrains Mono", "D2Coding", ui-monospace, monospace;

  /* 타이포 스케일 */
  --text-xs:   0.75rem;
  --text-sm:   0.875rem;
  --text-base: 1rem;
  --text-lg:   1.125rem;
  --text-xl:   1.25rem;
  --text-2xl:  1.5rem;
  --text-3xl:  1.875rem;

  /* radius, shadow, z-index */
  --radius-sm: 0.25rem;
  --radius-md: 0.5rem;
  --radius-lg: 0.75rem;
  --shadow-sm: 0 1px 2px rgb(0 0 0 / 0.05);
  --shadow-md: 0 4px 8px rgb(0 0 0 / 0.08);
  --shadow-lg: 0 12px 24px rgb(0 0 0 / 0.10);

  --z-modal:  100;
  --z-toast:  200;
  --z-hitl:   300;        /* HITL 승인 UI — 가장 위 */
}

:root[data-theme="dark"] {
  --color-surface-0: oklch(0.15 0 0);
  --color-surface-1: oklch(0.20 0 0);
  --color-surface-2: oklch(0.25 0 0);
  --color-border:    oklch(0.30 0 0);
  --color-text-primary:   oklch(0.95 0 0);
  --color-text-secondary: oklch(0.75 0 0);
  --color-text-muted:     oklch(0.55 0 0);
}
```

## 18.3 · React Context 구조 (3개)

전역 상태는 Context 3개 — Redux/Zustand 없이 단순화 ([04-TECH-STACK.md § Frontend](04-TECH-STACK.md)).

### 18.3.1 · `AppContext` (전역 사용자/설정/테마)

```typescript
// apps/web/src/context/AppContext.tsx
// ⚠️ frontend 는 @{{PROJECT_SLUG}}/interfaces (DB Record) 를 import 하지 않는다.
//    이유: interfaces 는 Date 객체 / DB row 매핑 — wire format 과 다름.
//    대신 generated OpenAPI types 를 사용: `apps/web/src/lib/api-types.generated.ts`
//    또는 shared Zod schema 의 `z.infer<>` re-export: `@{{PROJECT_SLUG}}/shared`
import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import type { components } from "../lib/api-types.generated";
// /auth/me 응답이 AuthUser/AuthOrganization (admin 전용 status/lastLoginAt 제외 형) → AppContext 도 본 타입 사용.
// 16 § AuthMeResponse 와 단일 출처. admin user CRUD UI 만 generated User 타입 (admin endpoint 전용).
type AuthUser = components["schemas"]["AuthUser"];
type AuthOrganization = components["schemas"]["AuthOrganization"];

interface AppContextValue {
  user: AuthUser | null;
  org: AuthOrganization | null;
  theme: "light" | "dark" | "system";
  setTheme: (t: "light" | "dark" | "system") => void;
  config: ClientConfig | null;             // GET /config 응답 (availableModels, features 등)
  isAuthenticated: boolean;
  logout: () => Promise<void>;
  refetchMe: () => Promise<void>;
}

export const AppContext = createContext<AppContextValue | null>(null);
export const useApp = () => {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be inside AppProvider");
  return ctx;
};

// Provider — root layout 에서 한 번만
export function AppProvider({ children }: { children: ReactNode }) {
  // GET /auth/me + GET /config 부트스트랩
  // theme 은 localStorage + prefers-color-scheme
  // ...
}
```

### 18.3.2 · `SessionContext` (현재 활성 세션)

```typescript
// /chat/[sessionId] 라우트 안에서만 활성
interface SessionContextValue {
  session: Session | null;
  messages: Message[];
  isStreaming: boolean;
  currentToolCall: ToolCall | null;      // 진행 중 도구 호출 표시
  hitlPending: HitlRequest[];            // 대기 중 HITL 요청
  sendMessage: (content: string, attachments?: Upload[]) => Promise<void>;
  stopStream: () => Promise<void>;       // DELETE /sessions/:id/active-run
  respondHitl: (toolCallId: string, decision: "approved"|"denied") => Promise<void>;
}
```

### 18.3.3 · `ArtifactContext` (artifact 패널 상태)

```typescript
interface ArtifactContextValue {
  current: Artifact | null;
  isPanelOpen: boolean;
  open: (artifactId: string) => Promise<void>;
  close: () => void;
  share: (artifactId: string, ttlDays?: number) => Promise<{ url: string }>;
}
```

이 3개 외에는 **모두 local state** (useState/useReducer). 작은 fetch 는 React Query 또는 SWR 옵션 (둘 다 OK, plan 에서는 SWR 권장 — 단순).

## 18.4 · 컴포넌트 디렉토리 트리

```
apps/web/src/
├── app/                           # Next.js App Router
│   ├── layout.tsx                 # <AppProvider> + 폰트 + 토스트
│   ├── globals.css                # 디자인 토큰 (§ 18.2)
│   ├── error.tsx                  # 전역 에러 boundary
│   ├── (auth)/
│   │   ├── layout.tsx             # 인증 페이지 공통 레이아웃 (centered card)
│   │   ├── login/page.tsx
│   │   └── signup/page.tsx
│   │   # verify/page.tsx 없음 — magic-link 는 server 302 (§ 18.1 routes 표). UI 별도 처리 X.
│   ├── (chat)/
│   │   ├── layout.tsx             # 좌 sidebar + main + 우 artifact panel
│   │   ├── page.tsx               # 홈 (세션 목록)
│   │   └── chat/[sessionId]/page.tsx   # 핵심 대화
│   ├── projects/
│   │   ├── page.tsx               # 프로젝트 목록
│   │   └── [projectId]/
│   │       ├── page.tsx           # 프로젝트 상세
│   │       ├── documents/page.tsx
│   │       └── members/page.tsx
│   ├── settings/
│   │   ├── layout.tsx             # 좌 nav + main
│   │   ├── profile/page.tsx
│   │   ├── memories/page.tsx
│   │   ├── skills/page.tsx
│   │   ├── mcp/page.tsx
│   │   └── quota/page.tsx
│   ├── share/[token]/page.tsx     # 익명
│   └── admin/                     # admin role 만
│       └── ...
│
├── components/
│   ├── chat/
│   │   ├── MessageList.tsx        # 메시지 리스트 (virtualized)
│   │   ├── MessageBubble.tsx      # 단일 메시지 (user/assistant/tool)
│   │   ├── MarkdownRenderer.tsx   # remark-citations + syntax highlight
│   │   ├── ToolCallRenderer.tsx   # 도구 호출 표시 (시작/진행/결과)
│   │   ├── ChatInput.tsx          # 입력 + 파일 첨부 + 전송
│   │   ├── StreamingIndicator.tsx
│   │   ├── StopButton.tsx
│   │   └── HitlPrompt.tsx         # HITL 승인 카드
│   │
│   ├── artifacts/
│   │   ├── ArtifactPanel.tsx      # 우측 패널 (resizable)
│   │   ├── ArtifactHeader.tsx     # 파일명 + 공유 + 다운로드
│   │   ├── PdfRenderer.tsx        # react-pdf
│   │   ├── PptxRenderer.tsx       # converter-worker → PDF → react-pdf
│   │   ├── MarkdownArtifact.tsx
│   │   ├── HtmlArtifact.tsx       # sandboxed iframe
│   │   ├── ImageArtifact.tsx
│   │   └── ShareDialog.tsx        # 공유 링크 발급 모달
│   │
│   ├── sessions/
│   │   ├── SessionList.tsx        # 사이드바의 최근 세션
│   │   ├── SessionCard.tsx
│   │   └── NewSessionButton.tsx
│   │
│   ├── projects/
│   │   ├── ProjectList.tsx
│   │   ├── ProjectCard.tsx        # visibility 배지 (private/team/org)
│   │   ├── ProjectDetail.tsx
│   │   ├── DocumentList.tsx
│   │   ├── DocumentUploader.tsx   # multipart + 진행 표시
│   │   ├── MemberManagement.tsx
│   │   └── ProjectCreateDialog.tsx
│   │
│   ├── settings/
│   │   ├── ProfileForm.tsx
│   │   ├── MemoryManager.tsx      # 4 카테고리 탭
│   │   ├── MemoryCard.tsx         # 핀/편집/삭제
│   │   ├── SkillList.tsx
│   │   ├── McpServerForm.tsx
│   │   └── QuotaProgress.tsx      # progress bar + 비용
│   │
│   ├── layout/
│   │   ├── Header.tsx             # 상단 — logo + user dropdown
│   │   ├── Sidebar.tsx            # 좌측 nav + 세션 리스트
│   │   ├── ThemeToggle.tsx
│   │   └── NavLink.tsx
│   │
│   ├── ui/                        # 기본 primitives (shadcn/ui 변형 또는 자체)
│   │   ├── Button.tsx
│   │   ├── Input.tsx
│   │   ├── Card.tsx
│   │   ├── Dialog.tsx
│   │   ├── DropdownMenu.tsx
│   │   ├── Toast.tsx
│   │   ├── Tabs.tsx
│   │   ├── Tooltip.tsx
│   │   ├── Skeleton.tsx
│   │   └── ProgressBar.tsx
│   │
│   ├── auth/
│   │   ├── LoginForm.tsx
│   │   ├── SignupForm.tsx
│   │   └── DomainHint.tsx         # @{{ORG_DOMAIN}} 만 허용 안내
│   │
│   └── icons/                     # lucide-react re-export + 커스텀
│
├── context/                       # § 18.3
│   ├── AppContext.tsx
│   ├── SessionContext.tsx
│   └── ArtifactContext.tsx
│
├── hooks/
│   ├── useAuth.ts
│   ├── useSession.ts
│   ├── useSessionStream.ts        # SSE EventSource
│   ├── useProjects.ts
│   ├── useArtifacts.ts
│   ├── useMemories.ts
│   ├── useSkills.ts
│   ├── useMcpServers.ts
│   ├── useNotifications.ts        # SSE /notifications
│   ├── usePolling.ts              # SSE fallback
│   ├── useKeyboardShortcut.ts
│   ├── useLocalStorage.ts
│   └── useDebounce.ts
│
└── lib/
    ├── api-client.ts              # fetch wrapper (cookie credentials 포함)
    ├── api-types.generated.ts     # OpenAPI → TS gen ([16 § OpenAPI](16-API-CONTRACT.md))
    ├── markdown-utils.ts
    ├── citation-plugin.ts         # remark plugin
    ├── formats.ts                 # 시간/바이트 포맷
    ├── sse.ts                     # EventSource wrapper + abort
    └── analytics.ts
```

## 18.5 · 핵심 화면 와이어프레임 (ASCII)

### 18.5.1 · `/chat/[sessionId]` (핵심)

```
┌─────────────────────────────────────────────────────────────────────────┐
│  {{PROJECT_NAME}}  [Project ▾]  ────────────────────────────────  [@user]  [⚙]    │ Header (sticky)
├──────────┬──────────────────────────────────────┬───────────────────────┤
│          │                                       │                       │
│ +새 세션  │   세션 제목 (편집 가능)               │  Artifact Panel       │
│ ──────   │   ─────────────────────────           │  ┌─────────────────┐ │
│ 📌 핀     │                                       │  │ filename.pptx   │ │
│ ─────    │   👤 "이 PDF 요약해줘" + 📎file       │  │ [공유] [⬇]      │ │
│ 오늘     │                                       │  ├─────────────────┤ │
│  💬 ...  │   🤖 (streaming)                      │  │                 │ │
│  💬 ...  │   ┌───────────────────────────┐       │  │  [PDF preview]  │ │
│ 어제     │   │ knowledge_search          │       │  │                 │ │
│  💬 ...  │   │ ✓ 3 chunks                │       │  │   page 1 / 12   │ │
│ 이전 7일 │   └───────────────────────────┘       │  │   [<] [>]       │ │
│  💬 ...  │                                       │  │                 │ │
│          │   본문... [1] ... [2] ...             │  └─────────────────┘ │
│          │                                       │                       │
│          │   ## Reference                        │                       │
│          │   [1] doc.pdf p.3                     │                       │
│          │   [2] doc.pdf p.7                     │                       │
│          │                                       │                       │
│          │   ─────────────────────────           │                       │
│          │   ⚠️ HITL: bash 명령 실행 승인?        │                       │
│          │   `rm -rf /tmp/*`                     │                       │
│          │   [거부]  [수정]  [승인]              │                       │
│          │                                       │                       │
├──────────┴──────────────────────────────────────┴───────────────────────┤
│   📎  ┌────────────────────────────────┐  [Stop]  [⏎ 전송]              │
│       │ 메시지 입력 (markdown 지원)     │                                │
│       └────────────────────────────────┘                                │
└─────────────────────────────────────────────────────────────────────────┘
```

**핵심 상호작용**:
- 좌 sidebar: 세션 리스트 (날짜 그룹, 핀 우선, virtualized)
- 중앙 main: MessageList + ToolCallRenderer + HitlPrompt + ChatInput
- 우 artifact panel: resizable (드래그), 토글 (단축키 `Cmd+\`)
- streaming 중: Stop 버튼 표시. 끝나면 hidden.
- 도구 호출: 카드 형식 (도구명 + spinner + 결과 요약)
- HITL: 흐름 중지, 모달 또는 inline 카드 (우선순위 z-300)
- citation `[N]`: 클릭 → 우측 panel 에서 해당 source 강조
- 메시지 호버: 복사/재실행/삭제

**상태 flow** ([16-API-CONTRACT § stop event reason 4값 의미](16-API-CONTRACT.md) 와 단일 출처):
1. mount → `useSession(sessionId)` → `GET /sessions/:id` + `GET /sessions/:id/messages` (cursor pagination)
2. 입력 후 `sendMessage`: optimistic append → `POST /sessions/:id/messages` (SSE) → 매 chunk 마다 messages[last] update
3. **SSE reducer가 처리하는 12 ChatEvent type** ([14-INTERFACES § ChatEvent](14-INTERFACES.md) 와 1:1):
   - `message_start` → 빈 message append (id 확정)
   - `message_replace` → 같은 messageId 의 content 를 contentSoFar 로 교체 (resume stream 시작 시)
   - `text_delta` → messages[last].content += text
   - `tool_use` → ToolCallRenderer 추가, `currentToolCall` 세팅
   - `tool_result` → ToolCallRenderer content 갱신, `currentToolCall` clear
   - `hitl_request` → `hitlPending` 에 추가, modal 표시
   - `hitl_resolved` → `hitlPending` 에서 제거. decision='approved' → tool_use 대기, 'denied' → 모델 후속 응답 대기
   - `hitl_timeout` → `hitlPending` 에서 제거, "응답 시간 초과" 안내
   - `citation` → messages[last].citations[index] = ref
   - `artifact_created` → ArtifactContext.open(artifactId), 우측 panel 자동 표시
   - `stop` → **reason 별 분기**:
     - `end_turn` / `max_tokens` / `aborted` → **terminal**: isStreaming=false, message 확정, 입력창 활성화
     - `tool_use` → **non-terminal**: isStreaming 유지, "도구 실행 중..." spinner 표시. 자동으로 `EventSource(/sessions/:id/messages/:messageId/stream)` 재연결 ([16 § resume endpoint](16-API-CONTRACT.md))
   - `error` → messages[last].error = info, isStreaming=false
4. user 가 Stop: `DELETE /sessions/:id/active-run` → SSE abort signal → 마지막 message 잘림 처리 (`[잘림]` marker)

> **반복 질문 차단**: 라운드 22~25 검토에서 "frontend reducer 가 모든 stop 을 terminal 처리, tool_use stop 과 충돌" 가 반복 지적. **본 reducer 의 stop 분기 (reason='tool_use' → non-terminal) 가 단일 출처** — UI 가 stop 받자마자 input 활성화하지 않고 후속 stream 대기.

### 18.5.2 · `/` (홈 — 세션 목록)

```
┌─────────────────────────────────────────────────────────────────────────┐
│  {{PROJECT_NAME}}                                                  [@user]  [⚙]   │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│   안녕하세요, ${user.name}!                                              │
│                                                                          │
│   ┌─────────────────────────────────────────────────────────────────┐  │
│   │  무엇을 도와드릴까요?                                             │  │
│   │  ┌─────────────────────────────────────────────────────────┐    │  │
│   │  │ 메시지 입력...                                            │    │  │
│   │  └─────────────────────────────────────────────────────────┘    │  │
│   │  [📎 첨부]  [Project ▾]                          [⏎ 시작]      │  │
│   └─────────────────────────────────────────────────────────────────┘  │
│                                                                          │
│   ## 빠른 시작                                                          │
│   ┌───────────┐ ┌───────────┐ ┌───────────┐ ┌───────────┐              │
│   │ 📊 보고서  │ │ 🔍 검색    │ │ 📝 요약   │ │ 💡 브레인 │              │
│   │  작성     │ │           │ │           │ │  스토밍   │              │
│   └───────────┘ └───────────┘ └───────────┘ └───────────┘              │
│                                                                          │
│   ## 최근 세션                                                          │
│   ┌─────────────────────────────────────────────────────────────────┐  │
│   │ 💬  3시간 전 — 회의록 요약 작성                                  │  │
│   ├─────────────────────────────────────────────────────────────────┤  │
│   │ 💬  어제 — PPTX 제안서 v0.3                                      │  │
│   ├─────────────────────────────────────────────────────────────────┤  │
│   │ 💬  3일 전 — 사내 정책 검색                                      │  │
│   └─────────────────────────────────────────────────────────────────┘  │
│   [더 보기]                                                              │
└─────────────────────────────────────────────────────────────────────────┘
```

새 메시지 입력 + Enter → `POST /sessions` → `POST /sessions/:id/messages` → `/chat/<new-id>` 로 redirect.

> **채팅 첨부 흐름 (반복 질문 차단)**: 파일 첨부 시 client 는 **항상 2-step**:
> 1. **`POST /uploads` (multipart)** → 응답 `{ data: { id: <uploadId>, ... } }` 로 `uploadId` 받음. server 는 S3 upload + uploads row insert (sha256 dedup).
> 2. **`POST /sessions/:id/messages` body 의 `attachments: [{ uploadId }]`** 로 메시지 전송. server 가 자동으로 PDF/PPTX/DOCX/XLSX/MD 를 ephemeral RAG 인덱싱 → SSE citation event 로 답변에 [N] 마커 부착.
>
> **UI 표시**:
> - ChatInput 의 📎 버튼 → file picker → **선택 즉시 `POST /uploads` 호출 + 진행 spinner**. 응답 받으면 uploadId 보관.
> - send 시점에 보관된 uploadId 들을 attachments 배열로 보냄.
> - 라운드 25~27 LLM 검토에서 "UI flow 가 1-step 으로 보임" 가 반복 지적 → 본 2-step 이 단일 출처. 16-API § POST /sessions/:id/messages 의 `attachments?: Array<{ uploadId: string }>` 필드와 1:1.

### 18.5.3 · `/projects/[projectId]`

```
┌─────────────────────────────────────────────────────────────────────────┐
│  ← Projects   /  영업 RFP 분석  [private]  [편집] [삭제]                │
├─────────────────────────────────────────────────────────────────────────┤
│  소유자: @hong  ·  생성: 2026-04-01  ·  team: 영업본부 AI팀             │
│  [📄 문서 12]  [👥 멤버 5]  [💬 세션 23]  [⚙ 설정]                      │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│   ## 문서                                              [+ 업로드]        │
│   ┌─────────────────────────────────────────────────────────────────┐  │
│   │ ✓ ABC社_RFP_v2.pdf       12 페이지   3분전   indexed   ⋮          │  │
│   │ ✓ 시장조사_2026Q1.xlsx    8 시트   1일전   indexed   ⋮          │  │
│   │ ⏳ proposal_draft.docx               방금     indexing  ⋮         │  │
│   │ ❌ broken.pdf                          어제   failed (재시도)     │  │
│   └─────────────────────────────────────────────────────────────────┘  │
│                                                                          │
│   ## 멤버                                              [+ 초대]          │
│   ┌─────────────────────────────────────────────────────────────────┐  │
│   │ @hong       owner    [편집]                                      │  │
│   │ @kim        editor   [편집]                                      │  │
│   │ @lee        viewer   [편집]                                      │  │
│   └─────────────────────────────────────────────────────────────────┘  │
│                                                                          │
│   [💬 새 세션 (이 프로젝트 컨텍스트로)]                                 │
└─────────────────────────────────────────────────────────────────────────┘
```

문서 업로드: 모달 + 드래그 드롭 + 진행 progress + indexing 상태 polling.

### 18.5.4 · `/settings/memories`

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Settings   /   Memories                                                │
├─────────────────────────────────────────────────────────────────────────┤
│  ⓘ 저장된 메모리는 모든 대화에 자동 적용됩니다.                          │
│                                                                          │
│   [ 전체 ] [ 👤 user ] [ 💬 feedback ] [ 📁 project ] [ 🔗 reference ]  │
│                                                  [정렬: 최신 ▾]  [+ 추가]│
│   ┌─────────────────────────────────────────────────────────────────┐  │
│   │ 📌 user       나는 영업본부 소속, 직무는 RFP 분석.               │  │
│   │              자동 추출 · 2026-04-05 · [편집] [삭제]              │  │
│   ├─────────────────────────────────────────────────────────────────┤  │
│   │    feedback   응답은 5문장 이내로 요약해주세요.                  │  │
│   │              수동 · 2026-04-10 · [편집] [삭제]                  │  │
│   ├─────────────────────────────────────────────────────────────────┤  │
│   │ 📌 reference  사내 가이드: https://wiki.acme.com/rfp-guide       │  │
│   │              수동 · 2026-04-15 · [편집] [삭제]                  │  │
│   └─────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
```

핀(📌) 메모리는 prompt 에 우선 주입 (`pinned=true`). 카테고리 탭으로 filter.

### 18.5.5 · `/share/[token]` (익명)

```
┌─────────────────────────────────────────────────────────────────────────┐
│                            {{ORG_NAME}} Share                            │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│                         📄 분석_보고서_v3.pdf                            │
│                            12 페이지 · 2.4 MB                            │
│                                                                          │
│   ┌─────────────────────────────────────────────────────────────────┐  │
│   │                                                                  │  │
│   │                                                                  │  │
│   │                       [PDF preview]                              │  │
│   │                                                                  │  │
│   │                       page 1 / 12                                │  │
│   │                                                                  │  │
│   └─────────────────────────────────────────────────────────────────┘  │
│   [< 이전]    [⬇ 다운로드]    [다음 >]                                  │
│                                                                          │
│   ⓘ 이 링크는 2026-06-12 까지 유효합니다.                                │
└─────────────────────────────────────────────────────────────────────────┘
```

만료 시: 큰 410 ⏰ 페이지 + "이 링크는 만료되었습니다 — 새 링크는 작성자에게".
revoked 시: 큰 ❌ + "이 링크는 취소되었습니다".

### 18.5.6~18.5.16 · 나머지 11개 화면 (구조적 spec — ASCII art 미포함)

> 상세 ASCII art 가 없어도 구현자가 일관된 레이아웃을 만들 수 있도록 **공통 패턴 + 각 화면의 핵심 hook + 컴포넌트 골격** 만 명시. 18.6 의 공통 UX 패턴 (로딩/빈 상태/에러, optimistic update, 키보드 단축키, a11y) 가 모든 화면에 적용.

**공통 레이아웃 contract**: 모든 인증 필요 화면은 `apps/web/src/components/layout/AppShell.tsx` 안에 mount. AppShell = 좌측 navigation rail (홈/프로젝트/설정/관리) + 상단 user menu + 본문 영역. 익명 화면 (`/login`, `/signup`, `/share/[token]`) 은 AppShell 미사용 — 중앙 정렬 좁은 폼. **magic-link verify 는 server 가 302 redirect 만 하므로 frontend 페이지 없음** (라운드 28 단일 출처).

| Route | 인증 | 핵심 hook / data | 컴포넌트 골격 |
|---|---|---|---|
| `/login` | none | `useLogin()` → POST /auth/login | 좁은 폼 (email + password), magic-link 토글 버튼, error toast |
| `/signup` | none | `useSignup()` → POST /auth/signup | 좁은 폼 (email + name), domain 검증 inline, 성공 시 "이메일 확인" 상태 화면 |
| (`/auth/verify` 페이지 없음) | — | server 302 흐름 | email 의 magic-link URL = `/api/v1/auth/magic-link/verify?token=` → server cookie set + 302 → `/` 또는 `/login?error=expired\|used`. UI 가 별도 처리 없음. |
| `/projects` | cookie | `useProjects()` → GET /projects | 좌측 visibility filter (private/team/org) + 우측 카드 그리드 + "새 프로젝트" 버튼 → modal |
| `/settings/profile` | cookie | `useMe()` (SWR) → GET/PATCH /auth/me | 우측 본문 폼 (name, customInstructions), saving indicator |
| `/settings/skills` | cookie | `useSkills()` → GET /skills | 좌측 scope filter + 우측 스킬 카드 (name/description/version), 카드 클릭 → 우측 panel slide-in (SKILL.md preview) |
| `/settings/mcp` | cookie | `useMcpServers()` → GET/POST/DELETE /mcp-servers | 테이블 (name/url/scope/discovered-tools 개수) + "추가" 버튼 → modal, refresh 버튼 |
| `/settings/quota` | cookie | `useQuota()` + `useUsageMe()` → GET /quota, /usage/me | progress bar (used / budget, %) + line chart (last 30d) + 비용 breakdown — 본인 데이터만 (admin 의 /usage 와 분리) |
| `/admin` | admin role | `useAdminDashboard()` → GET /admin/* | 카드 3개: users, sessions, errors. 각 카드 카운트 + 최근 변동 (24h) |
| `/admin/users` | admin | `useAdminUsers()` → GET/PATCH /admin/users | 테이블 (email/orgId/role/status/lastLogin) + role 변경 dropdown + suspend 토글 |
| `/admin/tool-metrics` | admin | `useToolMetrics()` → GET /admin/tool-metrics | 테이블 (tool name / count / error rate / p50 latency) + 7일 시계열 차트 |

각 화면 구현 시 18.6 의 5 UX 패턴 (loading/empty/error/optimistic/SSE) 적용. 와이어프레임 ASCII 가 필요한 디테일은 18.5.1~18.5.5 의 chat/home/projects/memories/share 와 동일 컨벤션 따름. 본 표가 16개 route 전체의 contract 단일 출처.

## 18.6 · UX 패턴 (모든 화면 공통)

### 18.6.1 · 로딩 / 빈 상태 / 에러

```
loading:  Skeleton 컴포넌트 (실 컨텐츠 동일 레이아웃, animate-pulse)
empty:    중앙 아이콘 + 한 줄 안내 + CTA 버튼
error:    inline 카드 (red border) + 재시도 버튼 + "이슈 보고" 링크
offline:  toast (Wi-Fi 아이콘) + 자동 재연결 시도 (exponential backoff)
```

### 18.6.2 · Optimistic update

- 메시지 전송: optimistic append → SSE 이벤트로 확정/롤백
- 메모리 추가: optimistic → 실패 시 toast + 원복
- 세션 제목 편집: blur 시 optimistic → 실패 시 원복

### 18.6.3 · Stream 처리

```typescript
// hooks/useSessionStream.ts
const useSessionStream = (sessionId: string) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // attachments 의 uploadId[] 는 16-API-CONTRACT § POST /sessions/:id/messages 의 attachments 필드와 동일.
  // 채팅에 PDF/PPTX 등을 첨부하면 server 가 자동으로 ephemeral_chunks RAG 인덱싱 → citation event 발행.
  const send = async (content: string, attachments?: Array<{ uploadId: string }>) => {
    abortRef.current = new AbortController();
    setIsStreaming(true);
    optimisticAppend({ role: "user", content, attachments });
    try {
      const res = await fetch(`/api/v1/sessions/${sessionId}/messages`, {
        method: "POST",
        signal: abortRef.current.signal,
        credentials: "include",
        headers: { "Content-Type": "application/json", "Accept": "text/event-stream" },
        body: JSON.stringify({ content, attachments }),       // attachments: uploadId[]
      });
      // SSE 파싱 — TextDecoderStream + ReadableStream. 14-INTERFACES § ChatEvent 의 12 event:
      //   message_start, message_replace, text_delta, tool_use, tool_result,
      //   hitl_request, hitl_resolved, hitl_timeout, citation, artifact_created, stop, error.
      // 본 reducer 의 stop 분기 (§ 18.5.1 상태 flow 와 단일 출처):
      //   reason='end_turn'/'max_tokens'/'aborted' → terminal (setIsStreaming(false))
      //   reason='tool_use' → non-terminal: 자동으로 GET /sessions/:id/messages/:messageId/stream 재연결
      //                       → 첫 event = message_replace (현재까지 누적 content), 이후 tool_result + text_delta
      //                       → 결국 stop reason='end_turn' 도달 시점에만 terminal.
    } catch (e) {
      if (e.name === "AbortError") { /* 사용자 stop */ }
      else { toast.error(e.message); rollback(); }
    }
    // setIsStreaming(false) 를 finally 에서 호출 X — reducer 가 stop reason 보고 결정.
  };

  const stop = async () => {
    abortRef.current?.abort();
    await fetch(`/api/v1/sessions/${sessionId}/active-run`, {
      method: "DELETE", credentials: "include",
    });
  };

  return { messages, isStreaming, send, stop };
};
```

### 18.6.4 · SSE 재연결 (notifications)

`/api/v1/notifications` 의 SSE 가 끊기면 5초 후 자동 재연결, 3회 실패 시 polling fallback.

### 18.6.5 · 키보드 단축키

| 키 | 동작 |
|---|---|
| `Cmd/Ctrl + K` | 세션 검색 (command palette) |
| `Cmd/Ctrl + Enter` | 메시지 전송 (입력 중) |
| `Esc` | 입력 취소 / 모달 닫기 |
| `Cmd/Ctrl + \` | Artifact panel 토글 |
| `Cmd/Ctrl + N` | 새 세션 |
| `Cmd/Ctrl + /` | 단축키 도움말 |
| `Cmd/Ctrl + B` | Sidebar 토글 |
| `j` / `k` | 메시지 목록 위/아래 (focus 모드) |

### 18.6.6 · 접근성 (a11y)

- 모든 interactive: `tabindex` + `aria-label`
- 모달: `role="dialog"` + focus trap + Esc 닫기
- streaming text: `aria-live="polite"` (스크린리더가 chunk 마다 읽지 않게)
- HITL prompt: `aria-live="assertive"` (사용자 액션 필수)
- 색상 contrast: WCAG AA (디자인 토큰의 surface↔text 페어 모두 만족)
- 키보드 only navigation 가능 (마우스 없이도 전체 흐름)

## 18.7 · 상태 관리 패턴

### Per-route 데이터 흐름

```
/chat/[sessionId]:
  AppContext (전역) ─┐
  SessionContext ────┤── useSessionStream(sessionId) ──► messages, isStreaming
  ArtifactContext   ─┘
                                       │
                              ┌────────┴───────┐
                              │                │
                         MessageList     ToolCallRenderer
                         (virtualized)   (도구 호출 카드)
                              │
                              └─► ArtifactContext.open() (artifact 첨부 시)
```

### 데이터 fetching 규약

- **Server component (App Router)**: 초기 데이터 (예: `GET /sessions/:id`) 는 page.tsx 에서 server fetch (cookie 자동 전달)
- **Client component**: 사용자 액션 (POST/PATCH/DELETE) 또는 SSE 는 client fetch
- **Cache**: SWR 으로 `GET /auth/me`, `GET /config`, `GET /projects` 캐싱 (15초 dedupe)
- **Revalidation**: 사용자 액션 후 `mutate()` 호출

## 18.8 · 다국어 (i18n) — v1.1 검토

v1.0 은 한국어 우선 (UI 문자열 모두 한국어 hardcoded). v1.1+ 에서 `next-intl` 도입 검토. 본 plan 에서는 모든 사용자 facing string 을 `lib/strings.ts` 한 곳에 모음 (추후 i18n 마이그레이션 친화):

```typescript
// apps/web/src/lib/strings.ts
export const strings = {
  common: {
    submit: "전송",
    cancel: "취소",
    delete: "삭제",
    edit: "편집",
    save: "저장",
    loading: "불러오는 중...",
    error: "오류가 발생했습니다",
    retry: "다시 시도",
  },
  chat: {
    placeholder: "메시지 입력...",
    stop: "중지",
    streaming: "응답 생성 중...",
    hitl: "도구 실행 승인이 필요합니다",
  },
  share: {
    expired: "이 링크는 만료되었습니다",
    revoked: "이 링크는 취소되었습니다",
    daysLeft: (n: number) => `${n}일 후 만료`,
  },
  // ...
};
```

## 18.9 · 빌드 시 외부 의존 (이 plan 으로 cover 못 하는 부분)

| 항목 | 시나리오 1 (재빌드) | 시나리오 2 (새 조직) |
|---|---|---|
| 로고/브랜드 이미지 | `analysis/` 또는 원본 코드의 `apps/web/public/` | 새 조직 디자인 자산 받기 |
| 시각적 디테일 (color shade, 미세 spacing) | 원본 코드의 Tailwind config | 본 § 18.2 디자인 토큰 따라 새로 결정 |
| 마케팅 카피 | 원본 또는 새로 작성 | 새 조직 톤 가이드 |
| 일러스트레이션 | 원본 또는 stock | 새 자산 |
| 도메인 특화 화면 (예: {{BRAND_PPTX_SKILL_NAME}} 미리보기 옵션) | 원본 | 도메인 인터뷰 후 작성 |

본 plan 의 § 18.1~8 은 **기능적으로 동등한 UI** 의 골격을 100% cover. 시각적 정확도는 외부 자산 필요.

## 18.10 · 검증 — Phase 6 acceptance test 추가

[08-SPRINT-PLAN.md § Phase 5 (Artifact) / 6 (Share)](08-SPRINT-PLAN.md) 의 acceptance 에 추가:

- [ ] 모든 16개 route 가 unauthenticated 호출 시 적절히 redirect (401 → /login)
- [ ] /chat/[sessionId] 에서 streaming 중 Stop 클릭 → 1초 이내 stream 중지 + 마지막 메시지 잘림 표시
- [ ] HITL prompt 가 z-300 으로 다른 UI 위에 표시
- [ ] /share/[token] 만료 시 410 + 안내 페이지
- [ ] WCAG AA 색 contrast — `axe-core` 자동 검사 통과
- [ ] 키보드 only navigation: Tab 만으로 모든 핵심 action 도달 가능
- [ ] 다크/라이트 테마 전환 시 깜빡임 없음 (`data-theme` SSR 적용)
