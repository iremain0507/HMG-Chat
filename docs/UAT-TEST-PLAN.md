# WChat — 엔터프라이즈 챗봇 사용자 인수 테스트(UAT) 플랜

> 우리 설계문서(rebuild_plan·DESIGN.md·design-reference F01–F17) + Open WebUI 를 딥리서치해 도출한 브라우저 실행형 사용자 여정 테스트. `localhost:3000`, dev-login(owner) 기준. 모든 시나리오는 navigate/click/type/hover/screenshot 로 실제 브라우저에서 실행한다.

## 개요

Browser-executable UAT plan for WChat (localhost:3000, dev-login as owner). 23+ prioritized user-journey scenarios cover onboarding, chat+streaming, stop/regenerate, edit/branch, session-history persistence, tool use (web_search/deep_research/code + Run Rail + HITL), RAG upload+citation, projects, admin access & functions, user settings, sharing/export, keyboard shortcuts, tooltips/hover, empty/loading/error+retry, mobile F17, and a11y. Scenarios are designed to reproduce the three ad-hoc findings (admin sub-pages have no UI entry, chat history not visible off /chat, missing nav/icon tooltips) and to surface the shared root cause: the AppShell/NavRail/SessionList shell is mounted only on the /chat route group (root layout is a bare <body>), so global nav, history sidebar, and rail tooltips vanish everywhere else; plus a dead /agents rail link, an orphaned /settings/quota, a missing /settings/profile, localStorage-only pins, and unremoved P15 '미적용' admin hints. 10 gap hypotheses (verified file:line) become the fix-loop backlog. Each scenario names the design frame/feature it validates and can be driven with navigate/click/type/hover/screenshot against the 28 existing e2e frames as ground truth.

## 갭 백로그 (doc-vs-code, file:line 검증) — P16 수정 대상

| #   | 심각도 | 갭                                                                                                                                                                                                                                                                                                                                      | 근거                                                                                                                                                                                 | 예상 수정                                                                                                                                                                                          |
| --- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | P1     | Admin sub-pages (/admin/users, /admin/settings, /admin/tool-metrics) have ZERO UI entry point — reachable only by typing the URL. The main dashboard shows their paths as inert monospace caption text, not links.                                                                                                                      | grep of src/components/admin for next/link\|<Link\|href → NONE; AdminDashboard.tsx:82-84, AdminUsersManager.tsx:41-43, ToolMetricsTable.tsx:23-25, AdminSettingsScreen.tsx:189-191 r | Add an admin sub-nav (tabs or a sidebar section) linking 대시보드/사용자/도구 메트릭/설정 as next/link routes on /admin and cross-linked across the sub-pages; make the caption strings actual <Li |
| 2   | P1     | The global shell (AppShell + NavRail + SessionList history sidebar) is mounted ONLY on the (chat) route group; the root layout is a bare <body>. So on home, projects, all settings, and all admin pages there is no persistent nav rail and no history sidebar — the shared root cause behind 'no tooltips' and 'history not visible'. | AppShell imported only by app/(chat)/layout.tsx:11 (and dev-only preview/page.tsx:8); app/layout.tsx:11 renders <body>{children}</body> with no nav wrapper; every non-chat page ren | Introduce an authenticated route group layout (or move AppShell into the root/authenticated layout) that wraps home, projects, settings, and admin with NavRail + header + (where ap               |
| 3   | P2     | Chat history is persisted server-side and browsable, but the SessionList history sidebar (search + date groups) is visible only inside /chat/*. Home shows just a truncated inline recent-5 slice — users perceive history as 'not showing / not saved'.                                                                                | SessionList mounted only via app/(chat)/layout.tsx:11; HomeContent.tsx:170-202 renders an inline recent list sliced to 5 at :85; useSessions.ts:34 confirms GET /api/v1/sessions wor | Once the shell is global (gap 2), the history sidebar appears everywhere; additionally give home a 'full history' entry (link to a sessions view or open the sidebar) so users can s               |
| 4   | P2     | Icon-only controls outside the NavRail lack hover tooltips: AppShell header buttons (⌘K search, panel toggle, hamburger, resize handle), ThemeToggle, and SessionCard pin/rename/delete actions set aria-label but no title=, so mouse users get no tooltip. NavRail (which DOES set title) is hidden off /chat.                        | AppShell.tsx:99-148 and :179-185 use aria-label only; ThemeToggle.tsx:65-74 aria-label only; SessionCard.tsx:71-101 aria-label only; NavRail.tsx:70-75/84-88 correctly set title but | Add title= (or a shared Tooltip component) to all icon-only buttons in AppShell header, ThemeToggle, and SessionCard actions; and make the tooltip-bearing NavRail globally visible                |
| 5   | P2     | NavRail 'AGENTS' item links to /agents, but no such route exists — clicking it 404s. On home the agents count is plain text with no link at all.                                                                                                                                                                                        | NavRail.tsx:30 href '/agents'; ls src/app/agents → No such file or directory; HomeContent.tsx ~:157-159 renders 에이전트 as non-linked text                                          | Either create an /agents library route (DP §4/F11 call for it) or repoint the rail/home agents entry to the existing surface (e.g. /settings/skills) until the agents page ships; re               |
| 6   | P2     | /settings/quota (F14 usage/cost page) is orphaned — no navigation element links to it anywhere; only its own caption references the path. Reachable solely by manual URL.                                                                                                                                                               | grep for 'settings/quota' across src → only QuotaPanel.tsx:48 (its own caption); no NavRail/home/settings-index link                                                                 | Add a settings navigation (settings index or sub-nav) that lists memories/skills/mcp/quota/profile, and link quota from the capability strip or user menu.                                         |
| 7   | P2     | /settings/profile is specified (name + customInstructions) but no page.tsx exists in the tree, so the route 404s.                                                                                                                                                                                                                       | W18 §18.1 specifies /settings/profile; ls src/app/settings shows only mcp, memories, quota, skills — no profile dir                                                                  | Create app/settings/profile/page.tsx with name + customInstructions form wired to the user profile endpoint, and link it from the settings nav/user menu.                                          |
| 8   | P3     | Session pinning is localStorage-only, not persisted server-side — pins do not survive a different device/browser or cleared storage, diverging from a server-backed pinned group.                                                                                                                                                       | lib/pinnedSessions.ts getPinnedSessionIds() reads localStorage; SessionList.tsx:74 and :102-104 source pins locally                                                                  | Persist pin state on the session record (PATCH /sessions/:id with a pinned flag) so the 📌Pinned group is consistent across devices; keep localStorage only as an optimistic cache.                |
| 9   | P3     | There is no unified /settings index; the NavRail 설정 item hard-codes /settings/memories as if it were the settings home, so users cannot discover the full settings surface (mcp/skills/quota/profile) from one place.                                                                                                                 | NavRail.tsx:35 href '/settings/memories'; no top-level app/settings/page.tsx exists                                                                                                  | Add a /settings index page (or a settings sub-nav within a settings layout) listing all settings sections; point the rail 설정 item at it.                                                         |
| 10  | P2     | The admin org-settings console still advertises temperature/topP/enableSignup/defaultUserRole as not-yet-applied ('미적용 / env 관리' hints) because P15-T6-01 is not passing — admins may set values that are silently ignored at runtime.                                                                                             | Design gap note: P15 items (temperature/topP forwarding, enableSignup/defaultUserRole runtime, hint removal) NOT passing in feature_list.json; AdminSettingsScreen renders those hin | Complete P15 wiring (forward temperature/topP to generation; apply enableSignup/defaultUserRole at runtime) and remove the '미적용' hint text once the fields take effect; until then,             |

## 테스트 시나리오 (26)

### TS-01 — Auth pages render shell-less, centered, theme-aware (login + signup)

`P2` · `a11y` · J1 New-user onboarding / auth · 검증: F14/F16 auth; W18 §18.5.6

| #   | 액션                                                                            | 기대 결과                                                                                                                           |
| --- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Navigate to /login                                                              | Centered narrow form, NO 3-column shell (no nav rail, no session sidebar, no header wordmark region); email+password fields present |
| 2   | Look for a magic-link toggle on the login form                                  | A magic-link option/toggle is offered alongside password login (W18 login row)                                                      |
| 3   | Navigate to /signup and type a non-corporate email (e.g. a@gmail.com) then blur | Inline validation rejects it; only *@ORG_DOMAIN accepted (DP §1 compliance)                                                         |
| 4   | Submit signup with a valid corporate email                                      | 'check your email' success state shown, not an app redirect                                                                         |
| 5   | Toggle theme (or set data-theme=dark) on the login page                         | Auth page restyles for dark mode with no SSR flash; contrast preserved                                                              |
| 6   | Screenshot /login and /signup in light and dark                                 | Matches shell-less centered layout in both themes                                                                                   |

### TS-02 — Home zero-state (F03) renders the full invitation, not a redirect

`P1` · `nav` · J2 First landing / home zero-state · 검증: F03; DP §5 F3; FL P13-T6-02

| #   | 액션                                                              | 기대 결과                                                                                                                   |
| --- | ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| 1   | Dev-login as owner, navigate to /                                 | Home renders F03 zero-state (NOT a redirect to /chat); centered ~720px column                                               |
| 2   | Read greeting + subcopy                                           | Greeting '안녕하세요, …님' (30px/700) + subcopy '사내 지식과 도구를 불러 업무를 시작하세요'                                 |
| 3   | Locate the large composer and the Quick-start 2×2 cards           | Composer present; 4 quick-start cards (문서 요약 / WIA 브랜드 PPT [featured] / 사내 지식 검색 / @딥리서치) visible          |
| 4   | Locate the capability strip                                       | Strip shows 커넥터·에이전트·스킬 counts; 커넥터 links /settings/mcp and 스킬 links /settings/skills                         |
| 5   | Hover and try to click the 에이전트 count in the capability strip | GAP CHECK: 에이전트 is plain text with no link (HomeContent.tsx ~:157-159) — expected to be a link to an agents destination |
| 6   | Scroll to recent sessions                                         | A recent-5 sessions list renders (or an empty invitation if none)                                                           |

### TS-03 — Persistent global navigation exists on EVERY authenticated route

`P1` · `nav` · Cross-cutting AppShell / navigation structure · 검증: 3-column AppShell; DP §4; DR AppShell line 49

| #   | 액션                                                                                        | 기대 결과                                                                                                                           |
| --- | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Enter a chat at /chat/<id> and confirm the 64px NavRail + 280px session sidebar are visible | Shell present inside /chat/* (홈·프로젝트·에이전트·커넥터·설정 rail items)                                                          |
| 2   | Navigate to / (home)                                                                        | GAP CHECK: NavRail and session sidebar are ABSENT — root layout renders bare <main>, only a custom home header exists               |
| 3   | Navigate to /projects, then /settings/memories, then /admin                                 | GAP CHECK: none of these render the persistent NavRail or history sidebar; user can only move via home cards or browser back        |
| 4   | From /projects, attempt to reach /settings or /admin using on-page navigation only          | No global rail available; confirms shell is mounted only on the (chat) route group (AppShell imported by (chat)/layout.tsx:11 only) |
| 5   | Screenshot home, projects, settings, admin                                                  | Visual proof that global nav is missing outside /chat                                                                               |

### TS-04 — Start a chat from home: session created, streaming, optimistic user bubble

`P1` · `chat` · J2→J3 Start a chat (F04 hero) · 검증: F04; W18 §18.5.2; DP §5 F4

| #   | 액션                                                | 기대 결과                                                                                      |
| --- | --------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| 1   | On /, type a prompt in the composer and press Enter | POST /sessions then POST /sessions/:id/messages fire; redirect to /chat/<new-id>               |
| 2   | Observe the user message immediately                | Right-aligned primary-50 bubble (radius 10) appears optimistically before any server response  |
| 3   | Observe the assistant turn as it starts             | Full-width document form (NO bubble); shimmer ~3 lines before first token, then typing cursor  |
| 4   | Watch the assistant left edge during generation     | Run Rail (2px vertical rail) renders with ticks colored by state; running tick pulses primary  |
| 5   | Wait for completion                                 | Markdown body renders; send button returns; message hover actions (복사/재생성/👍👎) available |

### TS-05 — Stop mid-stream keeps partial output and marks it truncated

`P1` · `chat` · J3 chat control · 검증: F04 item 9; DP UX-principle 6; DR line 60

| #   | 액션                                       | 기대 결과                                                                         |
| --- | ------------------------------------------ | --------------------------------------------------------------------------------- |
| 1   | Send a prompt that yields a long answer    | During streaming the send button is REPLACED by a Stop button (always reachable)  |
| 2   | Click Stop while tokens are still arriving | Generation halts promptly (AbortSignal); partial text is preserved, not discarded |
| 3   | Inspect the stopped message                | Last message marked '[잘림]' (truncated); Run Rail shows the aborted state        |
| 4   | Confirm composer is usable again           | Send button restored; draft preserved; user can send a follow-up                  |

### TS-06 — Regenerate, copy, and feedback message actions

`P2` · `chat` · J3 message hover actions · 검증: FL P10-T6-03; OpenWebUI Journey B

| #   | 액션                                               | 기대 결과                                                                                  |
| --- | -------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| 1   | Hover a completed assistant message                | Action row reveals 복사 (markdown source) / 재생성 / 👍 / 👎                               |
| 2   | Click 재생성                                       | An alternative response is produced (a new sibling on the same user turn)                  |
| 3   | Click 복사 then paste elsewhere                    | Markdown source (not rendered HTML) is copied to clipboard                                 |
| 4   | Click 👍 then 👎                                   | Feedback state toggles and is recorded; visual selected state updates                      |
| 5   | Hover an assistant message containing a code block | Code block has syntax highlight + copy + wrap toggle; wide tables scroll (overflow-x:auto) |

### TS-07 — Edit a user message creates a branch with sibling pager

`P2` · `chat` · Edit/branch (tree message store) · 검증: F08; DP §5 F8; FL P10-T6-15

| #   | 액션                                        | 기대 결과                                                                                                              |
| --- | ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| 1   | Hover a prior user message and click [편집] | Message becomes editable inline                                                                                        |
| 2   | Change the text and resubmit                | A new branch is created (tree store: parent pointer + active path); a fresh assistant answer streams on the new branch |
| 3   | Look under the edited turn                  | Sibling pager '‹ 2 / 3 ›' (mono tabular-nums) appears; active path renders                                             |
| 4   | Click the pager arrows                      | Switching siblings re-renders the corresponding downstream conversation path                                           |

### TS-08 — SESSION HISTORY persistence: create → leave → return → saved, listed, revisitable

`P1` · `history` · J4 Session history & revisit (persistence contract) · 검증: API16 sessions/messages; W18 §18.5.1; DR line 49

| #   | 액션                                                                        | 기대 결과                                                                                         |
| --- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| 1   | Create a new chat and exchange 2-3 messages; note the URL /chat/<id>        | POST /sessions created a real server row; messages persisted                                      |
| 2   | Confirm the session now appears in the left session sidebar                 | Session listed under 오늘 group with an auto/derived title (GET /sessions)                        |
| 3   | Navigate away to /projects then back to /chat/<id> (or hard-reload the URL) | GET /sessions/:id + GET /sessions/:id/messages re-fetch; full message history re-renders in order |
| 4   | Log out and log back in as owner, reopen /chat/<id>                         | History survives re-login (server-side persistence, not local state)                              |
| 5   | Open the session sidebar search and type part of the title                  | Session is findable; date grouping 📌Pinned→오늘→어제→이전 7일 respected                          |

### TS-09 — Session rename, pin, delete — with persistence checks

`P1` · `history` · J4 micro-interactions · 검증: FL P10-T6-02; W18 §18.6.2; DR line 49

| #   | 액션                                                                                 | 기대 결과                                                                                                                                            |
| --- | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Hover a session row in the sidebar                                                   | 이름변경 · 고정(pin) · 삭제 actions reveal on hover                                                                                                  |
| 2   | Rename via 이름변경, edit, blur                                                      | Optimistic rename; PATCH /sessions/:id persists; reload keeps the new title                                                                          |
| 3   | Pin the session, then reload the page in the SAME browser                            | Pin moves it to 📌 group and persists on reload                                                                                                      |
| 4   | Open the app in a different browser/profile (or clear localStorage) as the same user | GAP CHECK: pin does NOT survive (pins are localStorage-only via lib/pinnedSessions.ts), unlike server-persisted rename                               |
| 5   | Delete a session; if it is the open one, observe redirect                            | DELETE /sessions/:id → 204, cascade-deletes messages; open-session delete redirects home (no broken view); confirmation prompt on destructive action |

### TS-10 — Chat history discoverability from home (the 'history not visible' report)

`P2` · `history` · J4 discoverability · 검증: HomeContent recent-5 vs full SessionList; DR line 50

| #   | 액션                                                                        | 기대 결과                                                                                                                                   |
| --- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Create 8+ sessions across several days, then go to /                        | Home shows only a truncated inline '최근 세션' list of the latest 5 (HomeContent.tsx ~:170-202, sliced at :85)                              |
| 2   | On home, try to search or scroll older chat history                         | GAP CHECK: no full history sidebar and no search on home — SessionList is mounted only in (chat)/layout.tsx:11                              |
| 3   | Confirm the only way to browse/search full history is to first enter a chat | User must open /chat/* before the 280px history sidebar with search + date groups appears — matches the ad-hoc 'history not showing' report |

### TS-11 — Tool use: @mention picker → tool call cards + Run Rail (web_search / code)

`P1` · `tools` · J5 Using tools · 검증: F04/F05; DP §6 MentionMenu & ToolCallCard; FL P10-T6-07

| #   | 액션                                                                              | 기대 결과                                                                                                                                                                                   |
| --- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | In the composer type '@'                                                          | 360px MentionMenu popover opens with tabs [전체\|에이전트\|도구\|커넥터\|파일\|지식]; rows show policy badges (읽기 전용 neutral / 승인 필요 warning)                                       |
| 2   | Use ↑↓ then ↵ to pick a read-only tool (e.g. web_search); send a query needing it | Read-only tool runs with NO approval prompt                                                                                                                                                 |
| 3   | Observe the tool call in the transcript                                           | ToolCallCard interleaved at the utterance position (not batched at bottom): tool icon + name (+ connector › tool for MCP) + StatusChip + elapsed time in mono; body collapsed with '펼치기' |
| 4   | Click 펼치기 on the ToolCallCard                                                  | Input/result summary expands                                                                                                                                                                |
| 5   | Hover a Run Rail tick, then click it                                              | Hover shows event-name tooltip; click jumps to that step in the 활동 (Activity) tab of the right panel                                                                                      |
| 6   | Type '/' in composer                                                              | Slash commands appear: /요약 /표로 정리 /브랜드PPT /딥리서치 /번역                                                                                                                          |

### TS-12 — Deep research multi-agent Activity panel (F07)

`P2` · `tools` · J5 Activity / multi-agent · 검증: F07; DP §5 F7; FL P13-T6-07

| #   | 액션                                                         | 기대 결과                                                                                                                                    |
| --- | ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Send a message mentioning @딥리서치 with a research question | A running deep-research card renders in the body; right panel 활동 tab opens                                                                 |
| 2   | Inspect the Activity tab                                     | Plan summary + 4 worker cards (each StatusChip + '검색 N · 출처 N' mono) + step trace 계획→병렬 검색→압축→종합; sticky [실행 중지] at bottom |
| 3   | Confirm intermediate tool calls stay inside workers          | Parent turn shows only summary + citations, not every worker's intermediate tool call                                                        |
| 4   | Click [실행 중지]                                            | The multi-agent run cancels; partial results retained                                                                                        |

### TS-13 — HITL approval card for a side-effect tool (F06)

`P1` · `tools` · J8 HITL approval · 검증: F06; DP §5 F6 & §6 HitlCard; FL P13-T6-05

| #   | 액션                                                                                               | 기대 결과                                                                                                                                                                   |
| --- | -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Trigger a write/delete/external-send tool (e.g. @mention a '승인 필요' tool and request an action) | Inline HITL card at z-300 (always on top) with dimmed background; warning icon + title '도구 실행 승인이 필요합니다'                                                        |
| 2   | Read the card body                                                                                 | Plain-language summary (tool name · target · irreversibility notice); inline-editable JSON args; countdown '04:32 후 자동 거부' in mono; buttons [거부][수정 후 승인][승인] |
| 3   | While the card is pending, try to send another message                                             | Typing allowed but Send is LOCKED until resolved                                                                                                                            |
| 4   | Check screen-reader semantics on the card                                                          | Card is aria-live=assertive (announced)                                                                                                                                     |
| 5   | Let the countdown expire (or fast-forward)                                                         | Auto-deny then collapse to '시간 초과 — 자동 거부됨'                                                                                                                        |
| 6   | Re-trigger and click [승인]                                                                        | Tool executes; StatusChip transitions 승인 필요→실행 중→완료                                                                                                                |

### TS-14 — RAG chat attachment: 2-step upload → citations → source panel highlight

`P1` · `rag` · J6 Chat attachment (ephemeral RAG) · 검증: F04/F05; W18 §18.5.2/§18.6.3; FL P10-T6-11, P13-T6-09

| #   | 액션                                                                            | 기대 결과                                                                                                                                               |
| --- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | In a chat, attach a PDF via the composer (click or drag-drop into the dropzone) | Step 1: POST /uploads (multipart) on file pick → uploadId returned; progress spinner + removable chip; type/size validated; dropzone highlights on drag |
| 2   | Send a question about the document                                              | Step 2: message sent with attachments:[{uploadId}]; server auto-indexes into a session-scoped ephemeral index                                           |
| 3   | Read the streamed answer                                                        | Inline citation [N] chips appear at claim positions; footer '## Reference' list like '[1] doc.pdf p.7'                                                  |
| 4   | Hover a [N] chip                                                                | Snippet popover: file · page · 3-line snippet                                                                                                           |
| 5   | Click the [N] chip                                                              | Right panel 출처 tab activates; the source block highlights primary-100 with a 2s fade                                                                  |
| 6   | Paste an image into the composer                                                | Image attaches as a removable chip                                                                                                                      |

### TS-15 — Project knowledge (persistent RAG): upload + indexing states

`P2` · `rag` · J6 Project knowledge / J7 Projects · 검증: F09; W18 §18.5.3; FL P13-T6-10

| #   | 액션                                                          | 기대 결과                                                                                                   |
| --- | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| 1   | Open /projects/:id and upload a document to project knowledge | Documents table shows the new row entering an 'indexing' state                                              |
| 2   | Observe indexing progression                                  | States render: indexing 64% (progress bar) → indexed (success dot); a failed doc shows failed + [다시 시도] |
| 3   | Confirm progress source                                       | Progress driven by GET /notifications SSE document_indexed event (or polling fallback)                      |
| 4   | Click [다시 시도] on a failed doc                             | Re-index is triggered; state returns to indexing                                                            |

### TS-16 — Projects list + detail + cross-org isolation (404)

`P2` · `nav` · J7 Projects · 검증: F09; W18 §18.5.3; FL P3-T6-01

| #   | 액션                                                                  | 기대 결과                                                                                                                                                               |
| --- | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Navigate to /projects                                                 | Project list with visibility filter (private/team/org)                                                                                                                  |
| 2   | Open a project detail /projects/:id                                   | Summary row (owner · 문서 N · 멤버 N · 세션 N), documents table, members list with owner/editor/viewer role dropdowns + invite, and primary CTA [이 프로젝트로 새 세션] |
| 3   | Click [이 프로젝트로 새 세션]                                         | New session created scoped to that project; session sidebar (once in /chat) shows only that project's sessions                                                          |
| 4   | Attempt to open another org's private/team project id directly by URL | 404 (existence-leak prevention), not 403 with details                                                                                                                   |

### TS-17 — Admin access gate + reach the admin dashboard FROM the UI

`P1` · `admin` · J11 Admin console access · 검증: F15; W18 §18.1; FL P9-T6-01

| #   | 액션                                                                     | 기대 결과                                                                                                     |
| --- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| 1   | As owner/admin, look for an admin entry point                            | 관리 item in NavRail (only while inside /chat/*) and a '관리자' card on home both route to /admin             |
| 2   | From a non-chat page (e.g. /projects) try to reach admin via on-page nav | GAP CHECK: no admin entry visible because NavRail is absent outside /chat; only home card or manual URL works |
| 3   | Open /admin as owner                                                     | F15 dashboard: 3 KPI cards (users / active sessions / 24h errors) with deltas in mono                         |
| 4   | Dev-login (or simulate) as a plain member and open /admin                | Non-admin is redirected/403; AdminGuard blocks render; no 관리 card/rail item shown                           |

### TS-18 — Admin sub-pages reachable from the UI (users / settings / tool-metrics) — the reported gap

`P1` · `admin` · J11 Admin navigation · 검증: F15 sub-screens; W18 §18.5.6

| #   | 액션                                                                             | 기대 결과                                                                                                                                                                                                                    |
| --- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | On /admin, look for links/buttons to '사용자 관리' / '조직 설정' / '도구 메트릭' | GAP CHECK: no clickable navigation exists — src/components/admin has zero <Link>/<a>/href; the '/admin/users', '/admin/tool-metrics', '/admin/settings' strings are inert monospace captions (AdminDashboard.tsx:82-84 etc.) |
| 2   | Click the '/admin/tool-metrics' text on the dashboard                            | Nothing navigates (it is caption text, not a route)                                                                                                                                                                          |
| 3   | Manually type /admin/users, /admin/settings, /admin/tool-metrics                 | Each page renders fine directly — proving the pages exist but have no UI entry point (matches the human tester's finding)                                                                                                    |
| 4   | Verify no cross-links between admin sub-pages either                             | From /admin/users there is no link to /admin/settings or back to /admin — confirms missing admin IA                                                                                                                          |

### TS-19 — Admin functions: user role change/suspend + 7-tab org settings save

`P2` · `admin` · J11 Admin functions · 검증: F15 users/settings; FL P9-T6-01, P14-T6-01/02/03

| #   | 액션                                                                                         | 기대 결과                                                                                                                       |
| --- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Open /admin/users                                                                            | Dense table (email/orgId/role/status/lastLogin) with role-change dropdown + suspend toggle                                      |
| 2   | Change a user's role via the dropdown and toggle suspend                                     | Role/status update persists (PUT); table reflects the change; confirmation on destructive suspend                               |
| 3   | Open /admin/tool-metrics                                                                     | Dense table: tool name / call count / error rate / p50 latency / 7-day sparkline                                                |
| 4   | Open /admin/settings and edit a field in the 'Models & Generation' hero tab (e.g. maxTokens) | 7-tab org-settings console; dirty-tracking marks the field; sticky Save bar appears                                             |
| 5   | Inspect temperature / topP / enableSignup / defaultUserRole fields                           | GAP CHECK: these still show '미적용 / env 관리' hints because P15-T6-01 is NOT passing — settings advertised as not-yet-applied |
| 6   | Click Save; then force a server error path                                                   | PUT saves with success toast; on failure, rollback + danger toast (no silent loss)                                              |

### TS-20 — User settings pages: memories / skills / mcp / quota + missing profile

`P2` · `settings` · J10 Settings (per-user) · 검증: F10/F11/F13/F14; W18 §18.1

| #   | 액션                                                                           | 기대 결과                                                                                                                                                                       |
| --- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Open /settings/memories (F13)                                                  | Banner '저장된 메모리는 모든 대화에 자동 적용됩니다'; category tabs [전체\|user\|feedback\|project\|reference]; cards with 📌 pin, content, source+date, [편집][삭제]; add/sort |
| 2   | Open /settings/skills (F11) and click a skill card                             | Skill cards (name/version/description, 'WIA 브랜드 PPT v3' highlighted); click opens slide-over with allowed tools + policies + @name hint + [새 세션에서 사용]                 |
| 3   | Open /settings/mcp (F10)                                                       | Connector card grid (status dot 정상/오류/재승인, scope badge, 도구 N개 hover popover, last-sync, [새로고침][비활성화]); security badges; 3-step register modal                 |
| 4   | Try to reach /settings/quota (F14) using only on-page navigation from anywhere | GAP CHECK: /settings/quota is orphaned — linked from no nav element (only its own QuotaPanel.tsx:48 caption); reachable only by URL                                             |
| 5   | Navigate directly to /settings/quota                                           | Page renders: this-month progress bar, 30-day line chart, per-model breakdown, 80% threshold line; self-scoped only                                                             |
| 6   | Navigate to /settings/profile                                                  | GAP CHECK: no page exists (no app/settings/profile/page.tsx) though W18 §18.1 specifies name + customInstructions — expect 404/not-found                                        |

### TS-21 — Sharing & export: artifact share token page + expired/revoked + conversation export

`P2` · `sharing` · J9 Artifacts + sharing · 검증: F16 share; W18 §18.5.5; FL P13-T6-08, P10-T6-16

| #   | 액션                                                                                    | 기대 결과                                                                                                          |
| --- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| 1   | In a chat, trigger an artifact_created event (e.g. /브랜드PPT)                          | Right panel 아티팩트 tab auto-opens + toast; preview/code toggle; version pager ‹v3/5›; download + share buttons   |
| 2   | Create a share link and open /share/<token> (ideally in an anonymous/incognito context) | Anonymous shell-less centered page: filename, size, PDF preview with page pager '1 / 12', [다운로드], '…까지 유효' |
| 3   | Open an expired share token                                                             | 410 page: big clock + '이 링크는 만료되었습니다 — 새 링크는 작성자에게 요청하세요'                                 |
| 4   | Open a revoked share token                                                              | ❌ page (revoked state)                                                                                            |
| 5   | Use ShareExportMenu on a conversation and export                                        | Conversation share is explicit opt-in + review; export offered as markdown/JSON                                    |

### TS-22 — Keyboard shortcuts & command palette (⌘K / ⌘N / ⌘\ / ⌘B / ⌘/)

`P2` · `a11y` · Cross-cutting micro-interactions · 검증: W18 §18.6.5; DR line 65; DP UX-principle 9

| #   | 액션                                          | 기대 결과                                                                                                                                  |
| --- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | In /chat, press ⌘K                            | Command palette / session search opens; Esc closes it                                                                                      |
| 2   | Press ⌘N                                      | New session created (or new-session flow starts)                                                                                           |
| 3   | Press ⌘\                                      | Right context (artifact) panel toggles open/closed                                                                                         |
| 4   | Press ⌘B                                      | Session sidebar collapses/expands                                                                                                          |
| 5   | Press ⌘/                                      | A keyboard-shortcut help/cheatsheet surface appears (discoverability)                                                                      |
| 6   | In the composer press Enter, then Shift+Enter | Enter sends; Shift+Enter inserts a newline without sending                                                                                 |
| 7   | From home (no shell), press ⌘K / ⌘N           | GAP CHECK: verify whether global shortcuts work off /chat — likely bound only within AppShell, so they may be inert on home/settings/admin |

### TS-23 — Tooltips & hover affordances on nav, header, and session controls (the reported gap)

`P1` · `a11y` · Cross-cutting micro-interactions / a11y · 검증: DP §4; DR line 66; FL P10-T6-06

| #   | 액션                                                                                                   | 기대 결과                                                                                                                                               |
| --- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Inside /chat, hover each NavRail icon (홈/프로젝트/에이전트/커넥터/설정/관리)                          | Native tooltip appears (NavRail sets title + aria-label, NavRail.tsx:70-75/84-88) — tooltips DO work here                                               |
| 2   | Go to home/projects/settings and hover the equivalent icons                                            | GAP CHECK: no rail is present at all, so the icons the user actually hovers (header/home controls) have no tooltips — reproduces 'no tooltips on hover' |
| 3   | Hover the AppShell header icon buttons (⌘K search, panel toggle, mobile hamburger, right-panel resize) | GAP CHECK: no hover tooltip — these have aria-label only, no title= (AppShell.tsx:99-148,179-185)                                                       |
| 4   | Hover the ThemeToggle button                                                                           | GAP CHECK: no hover tooltip — aria-label only, no title= (ThemeToggle.tsx)                                                                              |
| 5   | Hover a SessionCard's pin/rename/delete action buttons                                                 | GAP CHECK: no hover tooltip — aria-label only, no title=                                                                                                |
| 6   | Run an a11y check (accessible names) on all icon-only controls                                         | All have accessible names for screen readers even where mouse tooltips are missing — confirms the gap is title=, not aria                               |

### TS-24 — Empty / loading / error states + retry + toasts

`P2` · `error` · Errors / trust (F resilience) · 검증: DP §7; DR line 64; FL P10-T6-17

| #   | 액션                                                          | 기대 결과                                                                                                                                      |
| --- | ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Open a brand-new account/session list                         | Empty states render invitations (zero chats greeting, empty search, empty knowledge base) — not blank/stuck                                    |
| 2   | Force a failed generation (e.g. offline the network mid-send) | Cause-specific error banner appears; the chat does NOT get stuck on 'Loading'; input draft preserved                                           |
| 3   | Trigger a retryable error                                     | Retry affordance shown only for retryable codes; 429 shows a backoff countdown in mono; credit-exhausted shows no retry + next-action guidance |
| 4   | Go offline then back online                                   | Offline banner + auto-reconnect with exponential backoff                                                                                       |
| 5   | Trigger success and error actions                             | Toast system fires info/success/warning/danger, auto-dismiss ~5s, non-blocking, deduped                                                        |

### TS-25 — Mobile / responsive (F17, 390px)

`P2` · `mobile` · J12 Mobile · 검증: F17; DP §5 F17; FL P13-T6-15, P10-T6-01

| #   | 액션                                      | 기대 결과                                                                                                        |
| --- | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| 1   | Resize the window to 390px and open /chat | Nav rail collapses to a 1px left indicator; composer fixed to bottom; sidebar becomes a slide-over drawer        |
| 2   | Open the session sidebar on mobile        | Slide-over drawer opens (off-canvas), dismissible                                                                |
| 3   | Type '@' on mobile                        | MentionMenu presents as a bottom sheet                                                                           |
| 4   | Open an artifact on mobile                | Artifact shows as a full-screen sheet with a top grabber                                                         |
| 5   | Load home/projects/admin at 390px         | Pages are usable and don't overflow horizontally; but note the same off-/chat missing-nav gap persists on mobile |

### TS-26 — Accessibility & theming: focus management, aria, dark/light, contrast

`P2` · `a11y` · Cross-cutting a11y · 검증: W18 §18.10; DP §7; FL P10-T6-01

| #   | 액션                                                                               | 기대 결과                                                                                                                        |
| --- | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Tab through home, chat, and a modal (HITL or share) using only the keyboard        | Logical focus order; focus is trapped in modals; Esc returns focus; visible focus rings                                          |
| 2   | Toggle theme via the ThemeToggle and via data-theme on root                        | data-theme stamped on root overrides prefers-color-scheme both directions; no SSR flash on reload                                |
| 3   | Run an automated contrast check on primary/accent/neutral tokens in light and dark | Text/background pairs meet WCAG AA; accent red (#C8102E) used only for Stop/강조, not body text                                  |
| 4   | Inspect StatusChip under prefers-reduced-motion                                    | Only the running dot pulses normally; static under reduced-motion; 22px radius-full 6px dot vocabulary consistent app-wide       |
| 5   | Verify autoscroll behavior                                                         | No forced autoscroll; follow only when already at bottom; '최신으로 ↓' pill appears when scrolled away; reduced-motion respected |
