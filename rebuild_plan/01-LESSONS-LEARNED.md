# 01 · Lessons & Learned — 금지 시도 → 추천 시도

> v2 의 **가장 중요한 단일 문서**. 원본 30 MR 의 시행착오를 18개의 페어로 정리. 모든 추천은 lint/test/CI/template/hook 등으로 강제할 수 있는 형태로 명시한다.

## 형식

각 항목 구조:
- **🚫 Anti-pattern** — 원본에서 발생한 잘못된 시도 (출처 MR/파일 명시)
- **✅ Recommended** — v2 에서 처음부터 할 방식
- **⚙️ How to enforce** — 자동화로 강제하는 방법
- **🔗 References** — 관련 MR/ADR/문서

---

## L01 · Sprint 명명 일관성

### 🚫 Anti-pattern
- 2026-03: `Sprint J-13`, `Sprint J-13 Phase 5`, `Sprint J-16`, `Sprint J-18`
- 2026-04~05: `sprint-2`, `sprint-7`, `sprint-8`, `sprint-9`

같은 시기 MR title 에서 두 체계 혼재 → 시계열 추적 불가.

### ✅ Recommended
단일 명명 규칙 고정: `v<major>.<minor>-S<NN>-<kebab-name>`

예: `v1.0-S04-knowledge` (Phase 4 = Knowledge), `v1.0-S06-share` (Phase 6 = Share). 정확한 Phase↔Sprint key 매핑은 [08-SPRINT-PLAN.md § Sprint key 매핑](08-SPRINT-PLAN.md) 단일 출처.

### ⚙️ How to enforce
- `.husky/commit-msg` 정규식 검사
- GitLab CI 의 `mr-title-lint` job
- `docs/plans/` 디렉토리명도 동일 규칙

### 🔗 References
원본 MR !1, !2, !5, !7, !17.

---

## L02 · 가설/탐색 vs 프로덕션 MR 분리

### 🚫 Anti-pattern
RAG/Knowledge 도메인의 3 MR 이 폐기 후 통합 MR 로:
- MR !3 RAG MCP Citation Phase 5 → closed
- MR !5 도구 액션 라벨 한글화 → closed
- MR !6 Knowledge Parser TS 포팅 → closed
- → 모두 MR !7 로 흡수

탐색·실패가 main 후보 MR 로 올라옴 → review/CI 자원 소모.

### ✅ Recommended
명시적 2단계:
1. **Spike 단계** (`spike/<topic>` 브랜치) — MR 안 만들고 push 만. 시간 박스 3일. 산출물: `docs/spikes/<date>-<topic>.md`
2. **Production MR** (`feat/<scope>` 브랜치) — Spike 결과 토대로 작은 vertical slice

### ⚙️ How to enforce
- branch protection: `spike/*` 는 main 으로 MR 못 만들게
- CI 의 `mr-source-branch-check` job: source_branch 가 `spike/*` 면 자동 close

### 🔗 References
원본 MR !3, !5, !6 → !7.

---

## L03 · 마이그레이션 NOT NULL ↔ nullable 반복

### 🚫 Anti-pattern
원본 MR !23 (artifact share):
- 처음 `artifacts.session_id` NOT NULL
- 공유 링크 도입하니 세션 삭제돼도 공유 유지 필요 → NULL 허용 + ON DELETE SET NULL
- 직후 MR !24: typecheck 누락 fix (2 MR 분리)

### ✅ Recommended
- 새 컬럼은 기본 nullable
- NOT NULL 이 진짜 필요한 경우만 명시, ADR 에 이유 기록
- 동일 PR 안에서 typecheck 통과 의무

### ⚙️ How to enforce
- 마이그레이션 PR 의 `tsc --noEmit` 같은 MR CI 에서 강제
- PR template 의 "Why NOT NULL? (if applicable)" 필드

### 🔗 References
원본 MR !23 + !24, 마이그레이션 0041.

---

## L04 · 의존성 충돌 (PDF.js 8일 사건)

### 🚫 Anti-pattern
MR !10 — 서버와 웹이 다른 PDF.js 버전 install → SSR 시 충돌, **8일** 소요.

### ✅ Recommended
Monorepo single-version policy:
- 핵심 공유 의존성은 root `package.json` 의 `pnpm.overrides` 로 단일 버전
- 패키지별 dependencies 에서 같은 패키지를 다른 버전 명시한 경우 CI reject
- native 모듈은 `packages/shared/wrappers/` 의 thin wrapper 로 isolate

### ⚙️ How to enforce
- root pnpm.overrides 명시
- CI 의 `dependency-coherence` job: 한 패키지가 여러 버전 install 됐는지 fail

### 🔗 References
원본 MR !10, ADR-07.

---

## L05 · 사용자 메모리 격상 (Phase 1 → 2 → 권한 격상)

### 🚫 Anti-pattern
3 MR 에 걸쳐 단계적 도입:
- MR !14 Phase 1: 추출·저장·UI
- MR !18 Phase 2: 시스템 프롬프트 주입
- MR !19: 사용자 메모리 섹션을 "영구 지시사항" 으로 격상

→ 처음부터 권한 등급을 잘못 설계, 모델이 일반 텍스트로 취급해서 무시됨.

### ✅ Recommended
4계층 권한 모델 처음부터:
1. **System** — 변경 불가
2. **Project** — 조직/프로젝트 관리자 설정
3. **User** — 사용자 영구 지시사항 (메모리)
4. **Tool** — tool result metadata

각 등급 충돌 시 우선순위를 `BASE.md` 에 명시.

### ⚙️ How to enforce
- `prompt-builder.ts` 입력이 4계층 enum 으로 typed
- prompt eval test: 충돌 시 상위 등급 우선

### 🔗 References
원본 MR !14, !18, !19. ADR-11, !15, !16.

---

## L06 · 비동기 잡 중단 (HITL/Stop race)

### 🚫 Anti-pattern
원본 commit 122ba01 / fe0aadb / 89150ba 연속으로 stop 관련 fix. queued mode 에서 클라이언트 stop 눌러도 서버 잡 계속 실행 — abort signal 이 sub-call 까지 전파 안 됨.

### ✅ Recommended
모든 외부 호출/장기 잡에 abort signal 의무:
- 메시지 잡 생성 시 abort controller 생성, signal 을 모든 sub-call (LLM/tool/DB) 에 forward
- 클라이언트 stop → DELETE active-run → controller.abort() 호출 → 모든 hook cancel
- HITL/Choice 대기 시에도 abort signal 우선, race(abortSignal, hitlPromise)

### ⚙️ How to enforce
- `apps/server/src/lib/job-runner.ts` API 가 `signal: AbortSignal` 의무 인자
- 테스트: HITL 대기 중 abort 호출 시 promise reject 검증
- Integration: queued mode stop → `sessions_active_runs.status='cancelled'` 검증

### 🔗 References
원본 commits 122ba01, fe0aadb, 89150ba.

---

## L07 · 에러 로그 노이즈 95% 사건

### 🚫 Anti-pattern
MR !11 — error_logs 의 95% 가 노이즈. 401 응답에도 client 가 polling 계속해 retry storm.

### ✅ Recommended
구조화 로그 v1 부터:
- Level: debug | info | warn | error | fatal
- Category: auth | tool | db | mcp | sandbox | rate-limit | external-api | parser
- 401/403: 재시도 금지, circuit breaker
- error_logs schema 에 level, category 컬럼 + 인덱스

### ⚙️ How to enforce
- `apps/server/src/lib/logger.ts` 가 typed object 만 받음, string-only call 금지
- ESLint rule: `console.log/error` 금지
- 운영 알림: category 별 error rate spike 감지

### 🔗 References
원본 MR !11, ADR-08.

---

## L08 · Identity 파편화

### 🚫 Anti-pattern
원본 source project 의 git log 에서 **한 명의 주개발자가 4-5개 ident** 로 커밋한 흔적:

| ident 카테고리 | 커밋 수 | 형태 |
|---|---|---|
| 개인 도메인 ident (gmail/naver 등) | 575 | `<영문 username> <개인 메일>` |
| 사내 도메인 ident | 35 | `<풀네임 + 직급 + 조직명> <사번@org_domain>` |
| 머신/환경별 ident | 22 | `JH_MAC`, `JH` 같은 짧은 별칭 |
| bot 계정 | 3 | `project_<id>_bot@noreply.<gitlab>` |

= 같은 사람의 작업이 통계상 별개 사람으로 잡혀 책임/기여도 추적 불가.

### ✅ Recommended
- 사내 커밋은 `*@{{ORG_DOMAIN}}` 도메인의 verified email
- 봇 푸시는 `project_<id>_bot@noreply.<gitlab>` 명시적 봇 ident
- repo 단위 git config 강제 (setup script)

### ⚙️ How to enforce
- `.husky/pre-commit` 의 author email 도메인 검사
- GitLab "Restrict commits by author" regex
- clone 후 `scripts/setup-git.sh` 자동 실행

### 🔗 References
REPORT.md `## 정체성 파편화` 섹션.

---

## L09 · 스킬 버저닝 (semver 위반)

### 🚫 Anti-pattern
- `{{BRAND_PPTX_SKILL_NAME}}-v0.1` → `v0.2` → `v03` (점 없음) → `v0.7.0`
- semver 위반 (0.21 vs 0.7 비교 불가), 디렉토리 inconsistent

### ✅ Recommended
- semver strict (x.y.z), 디렉토리는 단일 (`skills/{{BRAND_PPTX_SKILL_NAME}}/`)
- 버전은 `SKILL.md` frontmatter 와 `package.json` 에만
- 여러 버전 병행 운영 필요 시 `skills/{{BRAND_PPTX_SKILL_NAME}}@1.0.0/` 명시
- 각 스킬에 `CHANGELOG.md` 의무 (Keep a Changelog 형식)

### ⚙️ How to enforce
- `tools/lint-skills.ts` — version frontmatter 패턴 검사
- CI job `skill-version-check`

### 🔗 References
REPORT.md 의 `skills/{{BRAND_PPTX_SKILL_NAME}}-v03 (899)` 핫스팟.

---

## L10 · 셀프 머지 (리뷰 게이트 부재)

### 🚫 Anti-pattern
원본 30 MR 통계:
- 지정 reviewer 0건
- GitLab Approval 0건
- Inline DiffNote 0건
- 외부 유저 코멘트 1건 (전체)

주개발자 작성 → 주개발자 머지 23건 = 셀프 머지.

### ✅ Recommended
자동 게이트 적용:
- GitLab branch protection: 최소 1 approval required
- Approver 풀: (1) 다른 인간 개발자 (2) AI reviewer agent (3) 자기 자신 + self-review checklist 의무
- 모든 MR description 에 PR template 반영

### ⚙️ How to enforce
- GitLab Settings → Approvals required = 1
- AI reviewer 가 CI 에서 PR 코멘트 자동 생성, 점수 < 7 이면 머지 불가
- Self-review checklist 12개 체크박스 의무

### 🔗 References
REPORT.md `## 사실상 1인 개발 워크플로` 섹션.

---

## L11 · Docker socket → E2B 전환 (2000줄 제거)

### 🚫 Anti-pattern
원본은 EC2 + Docker socket 으로 시작 → 보안/스케일 한계 → ADR-17 에서 E2B 마이그레이션, **약 2000줄 제거**.

### ✅ Recommended
Sandbox 를 처음부터 interface 로 추상화:
- `SandboxTransport` interface (start/exec/writeFile/readFile/stop)
- 구현: E2BTransport (prod), LocalDockerTransport (dev only), MockTransport (test)

### ⚙️ How to enforce
- `apps/server/src/tools/sandbox/transport.ts` 가 interface 만 export
- ESLint rule: production code 에서 `dockerode` 직접 import 금지
- 테스트는 MockTransport 만 사용 (실 E2B 호출 금지)

### 🔗 References
원본 ADR-17, MR !17.

---

## L12 · 로컬 Docker 의존 (개발 환경)

### 🚫 Anti-pattern
초기엔 모든 개발자가 로컬 Postgres + Redis Docker 실행 → 환경 차이 디버깅 비용. 추후 SSM 터널 전환.

### ✅ Recommended
처음부터 SSM 터널 + 공유 dev RDS/Redis:
- `pnpm tunnel` 한 줄로 SSM tunnel open
- 로컬: Node 22 + pnpm + Docker (E2B sandbox 로컬 테스트용만)

### ⚙️ How to enforce
- `pnpm dev` 가 tunnel 안 떠 있으면 즉시 에러
- README quickstart 3줄: install / tunnel / dev

### 🔗 References
docs/ops/DEV-ENVIRONMENT-STRATEGY.md.

---

## L13 · CI 가 build/test/lint 뿐

### 🚫 Anti-pattern
원본 CI 파이프라인 (`.github/workflows/ci.yml` — 원본은 사내 GitLab 임에도 GitHub Actions YAML 사용) 은 build/test/lint 만. 배포는 `infra/aws/deploy.sh` 수동.

> 참고: v2 는 사내 GitLab Runner 사용 → `.gitlab-ci.yml`. 본문은 [15-CI-PIPELINE.md](15-CI-PIPELINE.md).

### ✅ Recommended
3-tier pipeline:
1. PR pipeline: typecheck + lint + unit test + migration dry-run + agent-review
2. main merge pipeline: + integration test + e2e (옵션) + security scan + docker build & ECR push
3. release pipeline (tag): + ECS task definition register + service update + smoke test + 자동 rollback

### ⚙️ How to enforce
- GitLab Runner 설정에 deploy job
- `deploy.sh` 는 CI 만 호출, 수동 실행 시 fail (`AWS_PROFILE` 미설정 검출)

### 🔗 References
원본 `.github/workflows/ci.yml`, `infra/aws/deploy.sh`.

---

## L14 · 도메인 충돌 흔적 없음 (좋은 점, 유지 + 강화)

### ✅ 원본의 잘된 점
2명이 평행 작업했지만 코드 충돌 없음 — 도메인 별 명확 분리.

### ✅ Recommended
명시적 도메인 ownership:
- `CODEOWNERS` 파일에 각 디렉토리의 owner 팀
- 다른 팀 디렉토리 수정 시 자동 review request
- 팀 간 인터페이스는 `packages/shared/` 또는 API contract 만

### ⚙️ How to enforce
- `.gitlab/CODEOWNERS` 정의
- "Code Owners as eligible approvers" 활성화
- `tools/cross-domain-import-check.ts`

### 🔗 References
REPORT.md 작성자 통계.

---

## L15 · MR description 품질 (좋은 점, 유지 + 자동화)

### ✅ 원본의 잘된 점
30 MR 의 description 평균 ~1000자, p90 ~2200자. Context/Decision/Validation 슬롯 일관 — 사실상 ADR.

### ✅ Recommended
- PR template 의무 (6섹션: Context/Decision/Validation/Migration/Notes/Checklist)
- 스크립트가 매주 자동으로 `docs/decisions/` 에 ADR 카드 생성
- `docs/decisions/INDEX.md` 자동 maintained

### ⚙️ How to enforce
- `.gitlab/merge_request_templates/default.md`
- 머지 직전 description 본문 < 80자면 머지 불가
- 매주 cron: GitLab API → ADR 카드 PR 자동 생성

### 🔗 References
analysis/REPORT_DECISIONS.md 의 27 ADR.

---

## L16 · MCP 통합 (좋은 점, 강화)

### ✅ 원본의 잘된 점
MCP 가 v1 부터 1급 시민. SSRF 보호, VPC CIDR 화이트리스트.

### ✅ Recommended (강화)
- MCP 서버를 org + project + user 3 단위로 등록
- MCP 도구 호출에 시간/비용 quota
- MCP server schema 변경 시 자동 알림 (지난 schema 와 diff)

### ⚙️ How to enforce
- 도구 schema diff 비교 cron + GitLab webhook
- MCP 도구 호출에 RateLimiter middleware

### 🔗 References
원본 README.md, `apps/server/src/mcp/`.

---

## L17 · 무거운 의존성 격리

### 🚫 Anti-pattern
원본 server 컨테이너 안에 LibreOffice + 한글 fonts + PptxGenJS + Office PDF converter 모두 내장 → 이미지 ~1GB+.

### ✅ Recommended
전용 worker 서비스 (`@{{PROJECT_SLUG}}/converter-worker`) 분리:
- 별도 Fargate task. 입력 S3 key + 변환 type, 출력 S3 key
- server 는 HTTP/SQS 로 worker 호출
- LibreOffice/fonts 는 worker 이미지에만

### ⚙️ How to enforce
- `apps/server/Dockerfile` 에 LibreOffice 설치 검출 시 build fail
- `apps/server/src/lib/office-pdf-converter.ts` 가 HTTP client 만

### 🔗 References
원본 Dockerfile.server, docker/fonts/.

---

## L18 · ADR 자동 추적

### ✅ 원본의 잘된 점
27개 ADR 이 MR description 안에 사실상 존재.

### 🚫 Anti-pattern
별도 `docs/decisions/` 디렉토리 없음 → 시간 지나면 MR 안 깊이 묻혀 검색 어려움. sprint 명명 불일치로 ADR ↔ sprint 매핑 불명확.

### ✅ Recommended
v2 부터:
- 모든 ADR 은 `docs/decisions/ADR-NNNN-<kebab-name>.md` 에도 동시 존재
- MR description 마지막에 `ADR: docs/decisions/ADR-0021-artifact-share-link.md` 자동 링크 (PR bot) — 번호는 03-ARCHITECTURE § ADR 카탈로그 기준
- ADR 카드는 sprint 명명과 1:1

### ⚙️ How to enforce
- PR bot (GitLab webhook + service): 머지 시 description 파싱 → ADR md 자동 생성 + 머지 commit 포함
- `docs/decisions/INDEX.md` 자동 업데이트

### 🔗 References
analysis/REPORT_DECISIONS.md.

---

## 정리표

| # | 영역 | 핵심 변화 | 강제 도구 |
|---|---|---|---|
| L01 | Sprint 명명 | 단일 규칙 `v<X.Y>-S<NN>-<name>` | commit-msg hook + CI |
| L02 | Spike vs Production | 명시적 분리 | branch protection |
| L03 | DB 마이그레이션 | nullable-first | PR template + DB review |
| L04 | 의존성 | single-version policy | pnpm overrides + CI |
| L05 | 권한 모델 | 4계층 | typed prompt builder |
| L06 | Abort | AbortSignal 의무 | typecheck + test |
| L07 | 로그 | 구조화 + category/level | logger API + ESLint |
| L08 | Identity | `*@{{ORG_DOMAIN}}` 강제 | pre-commit hook |
| L09 | 스킬 버저닝 | semver strict | skill linter |
| L10 | 셀프 머지 금지 | 자동 게이트 + AI reviewer | GitLab approval + CI |
| L11 | Sandbox | Interface-first | transport interface + ESLint |
| L12 | Dev env | SSM 터널 | tunnel check |
| L13 | CI/CD | 완전 자동화 | CI deploy job |
| L14 | 도메인 분리 | CODEOWNERS | cross-import-check |
| L15 | PR 품질 | 6섹션 template | MR template + bot |
| L16 | MCP | 3-level scope + quota | RateLimiter |
| L17 | 무거운 의존성 | converter worker 분리 | Dockerfile lint |
| L18 | ADR 자동화 | `docs/decisions/` | PR bot |

다음 문서 ([02-PRODUCT-VISION.md](02-PRODUCT-VISION.md)) 부터 이 18개 원칙을 코드/구조/스프린트 단위로 구체화한다.
