# Handoff: WChat — 현대위아 Enterprise LLM Agent Chat UI

## Overview

사내 데이터·도구·에이전트를 안전하게 호출하는 멀티테넌트 에이전틱 챗 플랫폼 "WChat"의 UI 디자인 핸드오프.
핵심 가치: **에이전트의 행위가 보이고(툴카드·Run Rail), 검증 가능하고(인용·출처), 통제 가능한(HITL·Stop) 화면**.

## About the Design Files

이 번들의 HTML 파일들은 **HTML로 제작된 디자인 레퍼런스**(의도된 외형·동작을 보여주는 프로토타입)이며, 프로덕션 코드가 아닙니다.
할 일은 이 디자인을 **대상 코드베이스의 기존 환경에서 재구현**하는 것입니다. 이 프로젝트의 빌드 플랜(`uploads/build plan/`)이 있는 저장소라면:

- 프론트: Next.js `apps/web`, Tailwind 시맨틱 토큰(`globals.css @theme`), 하드코딩 hex 금지
- 이벤트: `14-INTERFACES.md`의 동결 `ChatEvent` 12변형(`message_start / message_replace / text_delta / tool_use / tool_result / hitl_request / hitl_resolved / hitl_timeout / citation / artifact_created / stop / error`)에 1:1로 렌더러를 배선
- 태스크 매핑: `19-UIUX-UPGRADE.md` P10-T6-01…18 (본 디자인은 그 단일 시각 사양)

환경이 없다면 React + Tailwind 권장.

## Fidelity

**High-fidelity.** 색·타이포·간격·상태가 최종값입니다. 픽셀 수준으로 재현하되, 값은 아래 토큰을 CSS 변수/Tailwind 토큰으로 등록해 사용하세요(임의 hex 금지).

## Files

| 파일                                        | 내용                                                                                                                      |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `WChat Frames.dc.html`                      | **정적 하이파이 프레임 17종** (F01–F17, 1440px, 캔버스). 각 프레임 하단에 UX 근거 주석 포함                               |
| `WChat App.dc.html`                         | **인터랙티브 프로토타입** — 4개 시나리오(분석/HITL/딥리서치/PPT 스킬) 시뮬레이션, @멘션, 모델 피커, 우패널 3탭, 다크 모드 |
| `support.js`                                | 프로토타입 실행용 런타임(참조용 — 재구현 대상 아님). HTML과 같은 폴더에 두면 브라우저에서 바로 열림                       |
| `claude-design-prompt_wchat_hyundai-wia.md` | 원본 디자인 사양서(§2.3 토큰 표, §5 프레임 스펙, §6 컴포넌트 해부가 정본)                                                 |

프레임 인덱스: F01 토큰 / F02 컴포넌트 / F03 홈 / **F04 에이전틱 라이브(히어로 — 시각 언어의 정본)** / F05 @멘션 / F06 HITL / F07 활동(멀티에이전트) / F08 편집·분기 / F09 프로젝트 / F10 커넥터(MCP) / F11 에이전트·스킬 / F12 다크 / F13 메모리 / F14 쿼터 / F15 관리자 / F16 공유 / F17 모바일 3종.

## Design Tokens (유일한 색 출처)

**Primary (WIA Blue)**: 50 `#EEF2FA` 선택·인용 배경 / 100 `#DBE3F4` hover / 200 `#B6C4E8` / 300 `#8AA0DB` 다크 인터랙티브 / 400 `#5C77C6` 포커스 링 / 500 `#2E4FA6` / **600 `#00287A` CTA·링크·활성(브랜드 앵커)** / 700 `#001F5F` hover / 800 `#001646` active / 900 `#000F30`
**Neutral**: 0 `#FFFFFF` / 50 `#F5F5F5` surface-1 / 100 `#EBEBEB` / **200 `#D9D9D9` 기본 보더** / **300 `#B3B3B3` 비활성** / 400 `#8C8C8C` placeholder / **500 `#666666` 보조 텍스트** / 700 `#333333` / 900 `#1A1A1A` 본문
**Semantic**: danger `#C8102E`/`#A50D26`/`#FCEBEE` · success `#1B7F4B`/`#E9F7EF` · warning `#F5C400`/`#FFF6CC`/text `#6B5300` · info = primary 재사용(신설 금지) · gold `#85714D`, silver `#8A8D8F`(배지 한정)
**Dark (navy-tinted)**: surface `#0B1020`/`#121A33`/`#1A2547` · border `#26325C` · text `#EAEEF7`/`#B7C0D8`/`#7D89A8` · interactive `#8AA0DB`(hover `#A6B8E6`) · danger `#F0564F`
**레드 규율**: 순수 `#FF0000`은 로고 자산 안에서만. UI 빨강은 `#C8102E`. 대면적·장식 사용 금지.

**Typography**: Pretendard(self-host, 시스템 폴백) / 수치·코드·경과시간은 JetBrains Mono + `font-variant-numeric: tabular-nums`. 스케일 12/13/**14(base)**/16/18/20/24/30, 본문 행간 1.6, `word-break: keep-all`, 채팅 본문 15px 허용.
**Spacing** 4px 그리드(4/8/12/16/24/32/48) · **Radius** 6(입력·칩)/10(카드)/14(모달)/full(아바타·도트) · **Shadow** sm `0 1px 2px rgba(0,0,0,.05)` / md `0 4px 8px .08`(팝오버) / lg `0 12px 24px .10`(모달) — 카드는 그림자 없이 1px 보더.
**z-index**: 모달 100 / 토스트 200 / **HITL 300(항상 최상)**. **포커스 링**: 2px `#5C77C6`, offset 2px, 전 인터랙티브 요소.
프로토타입의 CSS 변수 매핑(`--sf0/--sf1/--sf2/--bd/--tx/--tx2/--tx3/--pri/--priBg/--ok/--wn/--dg` 등)은 `WChat App.dc.html`의 `<style>` 블록 참조 — 라이트/다크가 `body.dark` 클래스 하나로 전환되는 구조 그대로 이식 권장.

## Screens / Views (요약 — 상세 치수는 프레임 파일이 정본)

**AppShell** — 헤더 48px(시그니처 플레이스홀더+디바이더+WChat, ⌘K, 테마·패널 토글) / 나비 레일 64px(홈·프로젝트·에이전트·커넥터·설정·관리, 하단 테마+아바타) / 세션 사이드바 280px(새 세션 ⌘N, 검색, 고정→오늘→어제→이전7일, hover 시 이름변경·고정·삭제) / 본문 / 우패널 400px(탭: 아티팩트·출처·활동, ⌘\ 토글, 드래그 리사이즈).
**홈(F03)** — 중앙 720px: 인사 30/700 → 대형 컴포저 → 빠른 시작 2×2 → 능력 스트립(`커넥터 6 · 에이전트 4 · 스킬 13` 링크) → 최근 세션 5.
**채팅(F04)** — user 우측 `#EEF2FA` 버블(radius 10) / assistant 풀폭 문서형(버블 없음) + 좌측 **Run Rail**(2px 레일 + 이벤트 눈금; 진행=primary 펄스, 완료=success, 오류=danger, 승인대기=warning; hover 툴팁, 클릭→활동 탭). 툴카드는 발화 위치 인터리브(하단 몰아 배치 금지). 인용 `[N]` 칩 + 하단 REFERENCE. 강제 오토스크롤 금지 — 이탈 시 "최신으로 ↓" pill.
**컴포저(F05)** — 첨부칩 행 → textarea(auto-grow ≤10줄) → 액션바 [＋][@][/] · 모델칩 · `에이전트|채팅` 토글 · 웹검색 토글 · 컨텍스트 게이지(mono) · 전송(스트리밍 중 Stop 교체). @멘션 팝오버 360px: 검색+탭(전체/에이전트/도구/커넥터/파일/지식)+정책 배지(`읽기 전용` neutral / `승인 필요` warning), ↑↓/↵/Esc.
**HITL(F06)** — z-300, 배경 딤, 카드: 경고 아이콘+제목+평문 요약(도구명·대상·비가역 고지)+JSON 인라인 편집+카운트다운 `04:32 후 자동 거부`(mono)+[거부/수정 후 승인/승인]. 읽기 전용 도구는 무프롬프트. 대기 중 입력 가능·전송만 잠금. 타임아웃=자동 거부 후 접힘.
**활동 탭(F07)** — 계획 요약 + 워커 카드 4(StatusChip + `검색 N · 출처 N` mono) + 스텝 트레이스(계획→병렬 검색→압축→종합) + 하단 고정 [실행 중지]. 중간 툴콜은 워커 내부 격리, 부모에는 요약+인용만.
**기타** — F08 편집→분기 `‹ 2 / 3 ›` 페이저(트리 스토어 day-one) / F09 문서 인덱싱 상태 테이블(indexed·indexing 64%·failed+재시도) / F10 커넥터 카드(상태 도트·스코프·도구 N개 팝오버·보안 배지 2종, 등록 3단계 모달) / F11 에이전트 카드+슬라이드오버(허용 도구+정책, `@이름` 호출 힌트, [새 세션에서 사용]) / F13 메모리 카드(출처·날짜 메타) / F14 쿼터(80% 임계선) / F15 밀도 높은 지표 테이블 / F16 공유·만료(410) / F17 모바일(레일→1px 인디케이터, 픽커→바텀시트, 아티팩트→풀시트).

## Interactions & Behavior

- **상태 어휘 단일화**: StatusChip 5종(대기/실행 중/완료/오류/승인 필요)을 전 화면 공용. running 도트만 펄스(1.2s, reduced-motion 시 정지).
- **스트리밍**: 전송 즉시 optimistic 표시 → 첫 토큰 전 shimmer 3줄 → 타이핑 커서. Stop 상시 도달(전송 버튼 교체). 중단 시 부분 출력 유지.
- **인용**: 문장 끝 `[N]` 칩 hover 스니펫 팝오버, 클릭 → 우패널 '출처' 탭 자동 활성 + 원문 블록 `#DBE3F4` 하이라이트 2초 페이드.
- **아티팩트**: `artifact_created` → 우패널 '아티팩트' 탭 자동 오픈 + 토스트. 미리보기/코드 토글, 버전 페이저 `‹v3/5›`, 다운로드·공유.
- **모션**: 150–200ms ease-out, 패널 슬라이드 240ms, `prefers-reduced-motion` 존중.
- **오류**: 원인별 복구 — 재시도 가능한 것에만 [다시 시도], 429는 백오프 카운트, 크레딧 소진은 재시도 없이 다음 행동 안내. 드래프트 항상 보존.
- **키보드**: ⌘K 팔레트 / ⌘N 새 세션 / ⌘\ 패널 / Enter 전송(Shift+Enter 줄바꿈) / Esc 메뉴 닫기.
- **접근성**: 채팅 로그 `role="log" aria-live="polite" aria-atomic="false"`(announce 디바운스), HITL `aria-live="assertive"`, 새 턴 포커스 탈취 금지, 아이콘 버튼 전부 accessible name, 대비 페어 준수(본문 ≥12:1, 보조 ≥5.7:1).

## State Management

- **메시지 = parts 배열**(reasoning | tool | text(+세그먼트·인용) | table | ref | hitl)로 스트림 순서대로 인터리브 렌더. `stop.reason==="tool_use"`는 비종결(입력 재활성화 금지, resume 재연결).
- **메시지 스토어 = 트리**(부모 포인터+활성 경로) — 편집/분기·아티팩트 버전의 전제.
- **단일 AbortController**: Stop → 스트리밍·툴·에이전트 체인 전체 취소. (프로토타입의 `runId` 가드+단일 pump 인터벌 패턴 참조 — 타이머 개별 관리 금지)
- 우패널 상태: `panelTab`(이벤트로 자동 전환), 세션별 sources/artifacts/workers/steps.
- HITL: `pending → resolved(approved|denied, modifiedArgs) | timeout(자동 거부)`, 대기 중 sendLock.

## Assets

- **현대위아 CI 시그니처**: 원본 자산 미포함 — 모든 화면에 정확한 비율의 플레이스홀더 박스(`HYUNDAI WIA 시그니처 원본 삽입`). **절대 재드로잉·변형 금지**, 공식 CI 자산으로 교체할 것 (hyundai-wia.com/about/ci.asp).
- 아이콘: lucide 계열 라인 아이콘(stroke 1.8) — 실제 구현은 `lucide-react` 사용 권장.
- 폰트: Pretendard(로컬 self-host 필수 — 외부 CDN 금지 정책), JetBrains Mono.
- 파레토 차트 등 미리보기는 데모 SVG — 실데이터 차트로 대체.

## Claude Code 사용법

1. 이 폴더를 대상 저장소에 복사 (예: `docs/design_handoff_wchat/`).
2. Claude Code에 예시 프롬프트:
   > "docs/design_handoff_wchat/README.md를 읽고, WChat Frames.dc.html(F04가 히어로)과 WChat App.dc.html을 디자인 정본으로 삼아 P10-T6-01(앱 셸)부터 구현해줘. 색은 전부 README의 토큰을 globals.css 변수로 등록해서 사용하고, ChatEvent 12변형 렌더러를 parts 기반으로 배선해줘."
3. 프레임/프로토타입 HTML은 브라우저로 열어 수치 확인용으로 참조(개발자도구로 실측 가능). 구현 순서는 P0(F1–F7) → P1 → P2 권장.
