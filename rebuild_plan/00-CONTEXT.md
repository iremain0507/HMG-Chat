# 00 · 컨텍스트

## 왜 이 문서를 작성하는가

{{PROJECT_NAME}} 는 **{{ORG_FULL_NAME_KO}}의 사내 멀티테넌트 AI 에이전트 플랫폼** 이다. 2026-03 ~ 2026-05 약 2.5개월간 약 1.5명의 개발자 (주 개발자 1인 + 보조 1인) 가 30개 MR / 695 커밋으로 v1 을 만들었다.

빠르게 만들어진 제품인 만큼 **시행착오의 흔적** 이 코드와 의사결정에 남아있다 (Knowledge/RAG 의 3건 폐기 MR, NOT NULL ↔ nullable 마이그레이션 반복, PDF.js 8일 디버깅, Sprint 명명 체계 도중 변경 등).

본 plan 은 그 시행착오를 학습하여 **같은 제품을 처음부터 다시 만든다면 어떻게 구조화할까** 를 정리한다. 결과적으로:

- 원본의 **모든 기능** 을 유지 (chat, knowledge, artifact share, memory, skill, MCP, HITL, ...)
- 시행착오는 **금지/추천 매트릭스** 로 압축
- 개발은 6개 **agent teams** 의 평행 트랙 + 단일 sprint 마스터 플랜
- 모든 기능은 **TDD-first** 로 진행 (테스트 없이 머지 불가)
- 문서가 곧 ADR — 별도 ADR 디렉토리 자동 생성

## 종합한 데이터 출처

### 1. 원본 코드베이스 (clone 상태)
- `apps/server/` — Hono + Drizzle 백엔드, 약 120 테스트 파일
- `apps/web/` — Next.js 15 + React Context 프론트엔드
- `packages/shared/` — types.ts(1016줄), tool-schemas, constants
- `apps/server/src/db/migrations/` — 16+ SQL 마이그레이션 (실제 production 은 0041 까지)
- `skills/` — {{BRAND_PPTX_SKILL_NAME}} 등 13+ 스킬 디렉토리
- `infra/aws/` — setup-infra.sh, deploy.sh, task definitions
- `.claude/`, `.codex/`, `.husky/`, `.github/workflows/`

### 2. 원본 프로젝트 문서
- `CLAUDE.md` — Claude Code 가이드, 개발 운영 원칙
- `AGENTS.md` — Codex/서브에이전트 사용 지침
- `README.md` — 프로젝트 개요, 설치, MCP 설정
- `docs/plans/` — 22개 스프린트 폴더 (overview.md + phase-N.md)
- `docs/ops/` — CONFIG-REFERENCE.md, DEPLOYMENT-TROUBLESHOOTING.md 등
- `docs/architecture/` — deployment-system.md, sandbox-autoscaling.md
- `docs/reference/` — knowledge-base-guide.md, claude-code-lessons-learned.md

### 3. 본 세션에서 생성한 분석 산출물 (선택 자료, [build_prompt.md Phase A Q5](build_prompt.md) 의 옵션 1/3 일 때만 제공)

원본 source project 사례를 학습/참조하려는 경우 별도 디렉토리 `analysis/` 에 다음 자료가 있다 (본 plan 과 분리). 새 조직 적용 시 (옵션 2) 에는 무관/미사용:

- `analysis/REPORT.md` — 30 MR 종합 (통계 + description 전문)
- `analysis/REPORT_SPRINTS.md` — 스프린트/테마 그룹핑
- `analysis/REPORT_DECISIONS.md` — 27 ADR 카탈로그
- `analysis/CHANGELOG.md` — 일자별 변화
- `analysis/cache/` — GitLab API 원본 (JSON)

본 plan 은 위 자료 없이도 **self-contained** (모든 lessons 이 01-LESSONS-LEARNED 로 흡수됨).

### 4. 정량 통계 (2026-03-01 ~ 2026-05-13)
| 항목 | 값 |
|---|---|
| 총 커밋 | 695 |
| 총 MR | 30 (merged 25 / closed 3 / opened 2) |
| ADR | 27 (description 자동 추출) |
| 활동 개발자 | 2명 (4-5개 ident 파편화) |
| MR 평균 머지 시간 (p50) | 0.1 시간 (~6분) |
| 당일 머지 비율 | 88% |
| 외부 reviewer 코멘트 | 1건 (전체) |
| Inline diff review | 0건 |
| 마이그레이션 | 16+ (실제 0001 ~ 0041) |
| 테스트 파일 | 149+ (server: 120+, web 별도) |
| 코드 핫스팟 변경 | apps/server(2316), skills/{{BRAND_PPTX_SKILL_NAME}}-v03(899), apps/web(885) |

## v2 가 동일하게 유지하는 것

- **제품 시야**: {{ORG_NAME_KO}} 사내 AI 에이전트 인프라
- **핵심 도메인**: chat / knowledge / artifact / memory / skill / MCP / share
- **외부 의존**: Anthropic + (OpenAI/Gemini) + Tavily + Voyage + E2B + AWS (RDS/S3/ECS)
- **언어/스타일**: 한국어 우선 (커밋·문서·UI)
- **monorepo**: pnpm + Turbo

## v2 가 바꾸는 것

- **개발 워크플로**: 셀프 머지 → 자동 CI 게이트 + agent reviewer
- **권한 모델**: 처음부터 4계층 (System/Project/User/Tool) 명시
- **Sandbox**: Docker socket 옵션 없음 — E2B-only 부터 시작
- **의존성**: 모노레포 single-version policy (PDF.js 같은 충돌 원천 차단)
- **로그/관측**: 처음부터 구조화 로그 + 카테고리 + 레벨 + circuit breaker
- **테스트**: TDD-first 강제, coverage gate (>= 80% server, >= 60% web)
- **DB**: 새 컬럼은 기본 nullable, NOT NULL 은 별도 백필 + 마이그레이션
- **명명 규칙**: sprint key (`v1.0-S04-knowledge`, [08-SPRINT-PLAN.md § Sprint key 매핑](08-SPRINT-PLAN.md) 단일 출처) 처음부터 고정
- **identity**: pre-commit hook 으로 author email 도메인 강제 (`*@{{ORG_DOMAIN}}`)

## 본 plan 의 범위 밖

- 비즈니스 모델 / 라이선싱
- 사내 SSO 통합 세부 ({{ORG_NAME}} IdP 와의 OAuth flow)
- 모델 학습 / 파인튜닝
- 사내 컴플라이언스 정책 (legal review)

이런 항목은 **별도 인터뷰** 가 필요한 외부 입력이며, 본 plan 은 그것들이 결정된 상태를 가정한다 (자세한 unknowns 는 [13-GLOSSARY.md](13-GLOSSARY.md) 의 "Open Questions" 섹션).
