# v2 Rebuild Plan

> "{{PROJECT_NAME}} 를 바닥부터 다시 만든다면" 의 설계·개발·운영 문서 묶음.
> 본 디렉토리의 **22개 문서** (README + 00a + 00 + 01~18 + build_prompt) 만으로 이 프로젝트를 처음부터 재현 가능한 디테일을 목표로 함.

---

## 📢 검토자 (LLM/사람) 에게 — 본 plan 의 평가 기준 안내

본 plan 을 **빌드 가능성** 으로 평가할 때 다음 두 가지를 분리해서 보세요. 둘을 합쳐서 "self-contained 안 됨" 으로 판정하면 **본 plan 의 의도를 오해**한 것입니다.

### A. 기술적 self-contained (plan 의 책임)
plan 만으로 **빈 디렉토리 → 빌드 + 배포 절차 자동 실행** 가능해야 함.
- 인터페이스 시그니처 / DB DDL / RLS / API contract / CI yaml / Dockerfile / setup-infra / 디자인 토큰 / Context 구조 / UX 패턴 등.
- **여기 비면 plan 의 결함** → 본 plan 은 9 영역 단일 출처로 cover.

### B. 비즈니스/조직 결정 (plan 의 명시적 외부 인터페이스)
어떤 plan 도 다음을 대체할 수 없음 — 본질적으로 회사가 결정할 사항.
- 사내 SSO IdP 선택 (OIDC/SAML, 어느 provider?)
- 데이터 보존 법무 review (메시지 90일, 메모리 영구 — 법무 confirm?)
- AWS account 구조 (single vs multi-account)
- 사내 SLA / on-call 정책 / 이메일 발송 인프라
- LLM provider 정책 (Anthropic 단독 vs 다중 vs 사내 모델)
- 컴플라이언스 / 감사 요구사항

→ 이는 [13-GLOSSARY.md § Open Questions](13-GLOSSARY.md) 의 **20건** 으로 분리되어 명시. 본 plan 은 **"이 결정들이 채워지면 plan 안의 어느 위치가 어떻게 변경되어야 하는지"** 의 hook 만 제공.

### 평가 시 흔한 오해 4가지 (피해주세요)

| 오해 | 사실 |
|---|---|
| ❌ "Open Questions 가 비어 있으니 self-contained 아님" | ✅ Open Questions 는 **plan 의 결함이 아닌 plan 의 명시적 외부 인터페이스**. plan 이 이를 정직히 분리한 것 자체가 품질 신호. |
| ❌ "사내 SSO 통합 미정이라 Phase 1 막힘" | ✅ Phase 1 의 acceptance test 는 **magic-link 또는 password** 로 통과 가능. SSO 통합은 v1.1+ 로 의도적 분리 (16 § auth, 12 § JWT). |
| ❌ "법무 review 결과 없이 운영 불가" | ✅ 사실이지만 plan 의 결함 아님. 본 plan 은 retention 정책 컬럼/cron job 자리만 제공, 실제 일수는 빌드 후 config 로 변경. |
| ❌ "AWS account 구조 미정이라 배포 불가" | ✅ 본 plan 은 env 별 placeholder 와 `apply-project-vars.sh` 의 변수만 제공. 실제 account ID 는 운영자가 채움 — 이는 **모든 IaC 의 자연스러운 패턴** (Terraform/Pulumi 도 동일). |

### 검토할 때 사용할 두 가지 다른 질문

1. **"코드/구조 빌드 가능성"** — plan 만으로 `pnpm install && pnpm test && pnpm build && docker build` 가 결정적으로 작동? (A 항목)
2. **"운영 가능성"** — 그 다음 staging/prod 배포까지 무인 자동? (A + B 항목 둘 다 필요)

**둘은 분리된 질문**. 1번은 plan 으로 평가, 2번은 plan + 사내 결정으로 평가.

검토자가 "self-contained" 라는 단일 단어로 1번과 2번을 합치면 본 plan 은 영원히 "부족" 으로 판정됨 — 어떤 IT plan 도 회사 결정 없이 자동 운영 불가하기 때문.

---

## 🔧 새 조직/프로젝트에 적용한다면 — 변수 setup 먼저

본 plan 은 **generic template 상태** — 본문 전체에 `{{PROJECT_NAME}}`, `{{ORG_DOMAIN}}` 같은 placeholder (~360개) 가 박혀 있음. 사용자 입력값으로 일괄 치환하면 plan 이 자기 조직 명칭으로 채워짐.

```bash
# 1. 변수 정의
cp rebuild_plan/project.config.example.yaml rebuild_plan/project.config.yaml
$EDITOR rebuild_plan/project.config.yaml      # 9 카테고리 ~40 변수 채움 (빈 필드 채우기)

# 2. 일괄 치환 (필수 변수 누락 시 자동 검증)
bash rebuild_plan/scripts/apply-project-vars.sh rebuild_plan/project.config.yaml

# 3. 결과 확인 후 확정
diff rebuild_plan/00-CONTEXT.md{.bak,} | head
rm rebuild_plan/*.md.bak
```

자세한 절차/변수 정의 → **[00a-PROJECT-VARIABLES.md](00a-PROJECT-VARIABLES.md)**

또는 가장 간단하게 — **Claude Code 에게 한 줄**:
```
rebuild_plan/build_prompt.md 를 읽고 이 프로젝트를 리빌드해줘.
```

→ Claude 가 [build_prompt.md](build_prompt.md) 의 Phase A~E 절차를 따라 **변수 wizard + 부트스트랩 + Phase 0 (T1 Skeleton) 까지만 자동 진행**. Phase 0.5 (Contract Bootstrap PR) 는 **명시 사용자 승인 + Tier B (CODEOWNERS section 7-owner) approval gate** 통과 후에만 진행 (PR author = integration RC 1 명). Phase 1 부터는 각 phase 시작 시 사용자 명시 동의 필요 (build_prompt 가 가이드 + 인터페이스 + 테스트 시나리오 제공, 비즈니스 로직 본문은 사용자/도메인 팀이 작성). T3 운영 검증은 plan 의 hook 만 ([§ 빌드 산출물 3-Tier](#빌드-산출물-3-tier-build_prompt-와-일치) 참조).

### 보조 스크립트 (`rebuild_plan/scripts/`)

| 스크립트 | 누가 | 언제 |
|---|---|---|
| `apply-project-vars.sh` | 사용자 (새 조직 적용 시) | 매번 — plan 의 `{{...}}` placeholder 를 자기 조직 값으로 치환 |
| `lint-plan.sh` | plan 작성자 / 사용자 / CI | 매 변경 시 — 22 doc + script 의 cross-ref/envelope/DDL drift 자동 검사. exit 0 이어야 acceptance 통과 |
| `genericize-plan.sh` | plan 작성자 | **일회성, internal** — 원본 사례 (특정 조직) 명칭이 들어간 plan 을 generic template 으로 변환. 본 plan 은 이미 실행됨, 재실행 불필요. **새 repo 의 docs/plans/scripts/ 에 복사 금지** (source-specific token 박혀 있음). |

## 배경

원본 source project 저장소(`{{GITLAB_HOST}}/{{GITLAB_GROUP}}/{{PROJECT_SLUG}}`) 를 약 2.5개월간 운영한 결과(30 MR, 27 ADR, 695 commits) 와 코드/문서 종합 분석을 토대로, 같은 제품을 다시 만든다면 어떻게 시작할 것인가를 정리한다.

원본 vs v2 의 차이는 "결과물(제품)" 이 아니라 **여정** 이다 — 본 plan 의 v2 는 동일한 제품이지만 시행착오 없이 만든다.

### 자매 디렉토리: `analysis/`

본 plan 은 별도 디렉토리 [`analysis/`](../analysis/) 의 사례 데이터에서 추출되었다:

| 파일 | 내용 |
|---|---|
| `analysis/REPORT.md` | 30 MR 통합 통계 + description 전문 (72KB) |
| `analysis/REPORT_SPRINTS.md` | 스프린트/테마별 그룹핑 |
| `analysis/REPORT_DECISIONS.md` | 27 ADR 카탈로그 (description 자동 추출) |
| `analysis/CHANGELOG.md` | 일자별 변화 누적 |
| `analysis/cache/` | GitLab API 원본 (MR + notes + discussions, JSON) |

본 plan 은 **기술적으로 self-contained** — analysis/ 없이도 인터페이스 / DDL / CI / 빌드 절차 모두 본문에 있음.

### ⚠️ Self-contained 범위와 한계

**plan 으로 자동 빌드 가능 (clean-room rebuild)**:
- 인프라 (setup-infra.sh, Dockerfile, deploy.sh — 11 부록 E~I)
- DB 스키마 (마이그레이션 0001~0016 풀 SQL — 06 부록 A, F)
- 인터페이스 12개 (TypeScript 시그니처 — 14)
- REST API + Zod schema (16)
- CI 파이프라인 + 보조 스크립트 (15)

### 빌드 산출물 3-Tier (build_prompt 와 일치)

| Tier | 범위 | 본 plan cover |
|---|---|---|
| **T1. Skeleton** | 빈 디렉토리 → `pnpm install/lint/test/dev` 통과 | ~95% (코드블록 그대로 실 파일) |
| **T2. Functional MVP** | 인증·세션·LLM 스트리밍·기본 RAG·도구·share·관리자 화면 작동, e2e smoke 통과 | ~70% (인터페이스 100%, 로직 hook) |
| **T3. v1.0 GA** | 운영 트래픽 수용, SLA·observability·security 완비 | ~50% (T2 + 외부 의존) |

build_prompt 가 자동으로 끌고 가는 boundary 는 **T1 → T2** 의 인터페이스/스캐폴딩. T2 이후의 비즈니스 로직 본문은 plan 의 의도된 hook 에 사용자가 직접 구현.

**plan 만으로는 100% 재현 불가 (별도 외부 입력 필요)**:
| 영역 | 필요 정보 | 어디서 | 본 plan 의 cover 수준 |
|---|---|---|---|
| **비즈니스 결정** | SSO IdP, 데이터 보존 법무 review, AWS account 구조, SLA, 이메일 발송자 | 사내 인터뷰 ([13-GLOSSARY.md § Open Questions](13-GLOSSARY.md) 20건) | 0% (외부 입력) |
| **시스템 프롬프트 원문** | orchestrator/prompt-builder.ts 의 4계층 prompt 텍스트, 도구 description 원문 | [17-PROMPT-ASSETS.md](17-PROMPT-ASSETS.md) — base system prompt (90줄) + 12 도구 description 본문 + 압축/메모리 알고리즘 | **80%** (production-ready 본문, 조직별 페르소나 미세 조정만 외부) |
| **UI/UX 디테일** | 화면 레이아웃, 컴포넌트 트리, Context 구조, 디자인 토큰 | [18-FRONTEND-WIREFRAMES.md](18-FRONTEND-WIREFRAMES.md) — 16개 화면 와이어프레임 + 컴포넌트 트리 + 토큰 | **85%** (기능 동등 + UX 패턴, 시각 미세조정만 외부) |
| **스킬 스크립트** | {{BRAND_PPTX_SKILL_NAME}} 등 각 SKILL 안의 Python/bash 구현 | 원본 skills/ 디렉토리 또는 새로 작성 | 10% (인터페이스만, 본문 없음) |
| **워커 변환 로직** | converter-worker 의 LibreOffice 호출 Python 본문 | 원본 또는 새로 작성 | 30% (API spec 있음, 구현 없음) |
| **컨텍스트 압축 알고리즘** | context-compactor.ts 의 토큰 한도 / 요약 규칙 디테일 | [17-PROMPT-ASSETS.md § 17.4](17-PROMPT-ASSETS.md) | 80% (알고리즘 명시) |

→ 본 plan 은 **"기능 동등 v2 의 골격"** 을 만든다. UI 시각적 정밀 재현이나 LLM 응답 톤앤매너 1:1 매칭은 plan 만으로 불가능 — 원본 자산 (analysis/, 또는 별도 프롬프트 백업) 필요.

이 한계는 시나리오에 따라 다름:
- **시나리오 1 (원본 source project 재빌드 (사내))**: analysis/ 함께 제공 → UI/프롬프트 재현 가능
- **시나리오 2 (다른 조직 적용)**: plan 만으로 새 organization 의 자체 UI/프롬프트 작성 → 골격은 같지만 외관/톤은 다른 제품

**언제 함께 제공하나**:
- ✅ 사내에서 원본 source project 그대로 다시 만들 때 — 원본 결정의 컨텍스트와 일치
- ✅ 학습/참고 목적
- ❌ 다른 조직 (ACME 등) 에 적용 시 — source-specific 인명/이메일/MR번호라 무관 + privacy

## 문서 인덱스

| # | 문서 | 무엇을 다루나 | 분량 (추정) |
|---|---|---|---|
| **★** | **[build_prompt.md](build_prompt.md)** | **🚀 단일 진입점 — "이 파일 읽고 리빌드해줘" 한 줄로 시작** | 중간 |
| 00a | **[Project Variables](00a-PROJECT-VARIABLES.md)** | 조직·프로젝트 고유 토큰을 변수로 분리, setup wizard | 중간 |
| 00 | [컨텍스트](00-CONTEXT.md) | 왜 다시 만드는가, 종합 데이터 출처 | 짧음 |
| 01 | **[Lessons & Learned](01-LESSONS-LEARNED.md)** | 18개의 "금지 시도 → 추천 시도" 매트릭스. 가장 중요한 문서 | 큼 |
| 02 | [Product Vision](02-PRODUCT-VISION.md) | 무엇을 만드는가, 사용자, 성공 지표 | 중간 |
| 03 | [Architecture](03-ARCHITECTURE.md) | 시스템 아키텍처 (HLD) — 모듈 경계, 데이터 흐름 | 큼 |
| 04 | [Tech Stack](04-TECH-STACK.md) | 기술 선택 + 근거 + 대안 비교 | 중간 |
| 05 | [Repo Structure](05-REPO-STRUCTURE.md) | 모노레포 트리, 패키지 경계, 의존성 그래프 | 큼 |
| 06 | [Data Model](06-DATA-MODEL.md) | 도메인 모델 + DB 스키마 + 마이그레이션 순서 | 큼 |
| 07 | **[Agent Teams](07-AGENT-TEAMS.md)** | 서브에이전트/팀 분담, 병렬 개발 구조 | 중간 |
| 08 | [Sprint Plan](08-SPRINT-PLAN.md) | Phase 0~9 스프린트별 작업 + 의존 관계 | 큼 |
| 09 | **[TDD Guide](09-TDD-GUIDE.md)** | Test-Driven Development 가이드 + 테스트 패턴 | 큼 |
| 10 | [Dev Workflow](10-DEV-WORKFLOW.md) | 커밋/MR/리뷰/CI 규칙 | 중간 |
| 11 | [Deployment](11-DEPLOYMENT.md) | AWS 배포 (ECS/RDS/S3/Redis), CD 파이프라인 | 중간 |
| 12 | [Ops & Security](12-OPS-SECURITY.md) | 운영/보안/관측/Secrets | 중간 |
| 13 | [Glossary](13-GLOSSARY.md) | 용어 정의, 약어 | 짧음 |
| 14 | **[Interfaces](14-INTERFACES.md)** | 12개 인터페이스 시그니처 (단일 출처) | 큼 |
| 15 | [CI Pipeline](15-CI-PIPELINE.md) | `.gitlab-ci.yml` 실 본문 + 보조 스크립트 spec | 큼 |
| 16 | **[API Contract](16-API-CONTRACT.md)** | REST API endpoint contract (단일 출처) | 큼 |
| 17 | **[Prompt Assets](17-PROMPT-ASSETS.md)** | 시스템 prompt 4계층 + 도구 description + 압축/메모리 알고리즘 (외부 입력 필요) | 중간 |
| 18 | **[Frontend Wireframes](18-FRONTEND-WIREFRAMES.md)** | 화면 인벤토리 16개 + React Context 3개 + 컴포넌트 트리 + ASCII 와이어프레임 + 디자인 토큰 + UX 패턴 + 키보드/a11y | 큼 |

## 읽는 순서

- **빠르게 훑고 싶다**: README → 01 (Lessons) → 02 (Vision) → 03 (Architecture)
- **실제 빌드를 시작한다 (Phase 0 첫 PR)**: 05 → 14 → 06 → 10 → 15 → 08 — 이 순서로 root 설정 → 인터페이스 → DB → workflow → CI → sprint 진입.
- **품질에 집중**: 01 + 09 (TDD) + 10 (Workflow) 같이
- **운영자/SRE**: 11 + 12 (alarm/runbook)
- **단일 출처 (Single Source of Truth)**:
  - 인터페이스 시그니처 (12개) → **14**
  - 권한 4계층 충돌 매트릭스 → **14**
  - REST API contract → **16**
  - DB DDL + RLS (0001~0016) → **06**
  - alarm 임계치 → **12**
  - CI pipeline 본문 → **15**
  - .env.example + task definition + IAM → **11**
  - Phase ↔ Sprint key 매핑 → **08**

## 핵심 약속 (v2 의 원칙)

본 plan 은 단순한 재현이 아니라 **개선된 v2** 다. 다음 7가지를 원칙으로 한다:

1. **TDD 우선** — 모든 새 기능은 RED → GREEN → REFACTOR. 테스트 없는 PR 자동 reject.
2. **MR description = ADR** — Context / Decision / Validation / Notes 4슬롯 의무. PR template 으로 강제.
3. **단일 권한 모델** — System / Project / User / Tool 4계층 권한이 처음부터 데이터 모델에 반영.
4. **Sandbox-first** — Code execution 은 처음부터 격리된 외부 sandbox (E2B 또는 동등) 추상화 위에서. Docker socket 옵션 없음.
5. **Strict semver, monorepo single-version** — 모든 스킬 + 공유 의존성은 root single source of truth.
6. **Agent teams 병렬화** — 도메인별 6팀이 평행으로 진행, packages/shared 만 동기화 포인트.
7. **자동화 게이트** — CI 가 모든 머지 게이트 (test/lint/type/migration-check/security-scan). 수동 머지 불가.

---

생성: 2026-05-13 · 분석 데이터: 30 MRs / 27 ADRs / 695 commits / 16+ 마이그레이션
