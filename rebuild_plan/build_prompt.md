# Build Prompt — v1.0 을 위한 실행 계획 (T1 스캐폴딩 → T2 MVP 가이드)

> 사용자가 `build_prompt.md 를 읽고 이 프로젝트를 리빌드해줘` 라고 말하면 Claude Code 가 본 문서를 단일 진입점으로 사용한다.
>
> ## 산출물 3-Tier 정의 (혼동 방지)
>
> | Tier | 목표 | 본 plan 의 자동 cover | 추가 작업 |
> |---|---|---|---|
> | **T1. Skeleton** | 빈 디렉토리 → `pnpm install` + `pnpm lint` + `pnpm test`(빈) + `pnpm dev` 통과. 22개 doc 의 boilerplate (package.json, tsconfig, eslint, drizzle config, Dockerfile, .gitlab-ci.yml, infra shell) 가 그대로 동작. | **~95%** (build_prompt + 22 doc 의 모든 코드블록을 그대로 실 파일로 생성) | 거의 없음. AWS account/credentials 만 있으면 됨. |
> | **T2. Functional MVP** | 인증·세션·메시지·LLM 스트리밍·기본 RAG·기본 도구·share·관리자 화면이 **모두 작동**. e2e smoke 통과. | **~70%** (인터페이스/DDL/CI/배포 100%, 비즈니스 로직 본문 hook 만 있음) | server 의 orchestrator/도구 본문, web 페이지 본문, converter-worker 변환 로직 (Python) 의 실 코드 작성. plan 의 인터페이스·테스트 시나리오·DDL 을 따라 ~6–8주. |
> | **T3. v1.0 GA** | 운영 트래픽 수용 가능, SLA·observability·security 완비. T2 + 운영 검증 + 모든 ADR 적용. | **~50%** — T2 의 모든 항목 + 외부 입력 의존 (스킬 자산 10%, converter-worker 30%, 시스템 프롬프트 80%, UI 시각 디테일 85%, 비즈니스 결정 0%) | 사내 인터뷰·SSO·계약·법무·고급 RAG 튜닝 등 12주 풀빌드. [README.md § Self-contained 범위와 한계](README.md) 참조. |
>
> **이 build_prompt 가 자동으로 끌고 가는 boundary 는 T1 → T2 의 인터페이스/스캐폴딩 단계.** T2 이후의 비즈니스 로직 본문은 plan 의 의도된 hook (인터페이스·시그니처·테스트만 정의) 에 사용자가 코드를 끼워넣어야 함. plan 이 "v1.0 GA 까지 자동" 이라 약속하지 않음.
>
> `build_prompt 가 너무 진척되어 plan 의 hook 만으로 의사결정이 안 되는 시점` 에 도달하면 자동으로 멈추고 사용자에게 입력 요청 ([§ 멈춤/사용자 결정 trigger](#멈춤--사용자-결정-trigger)).

## ⚠️ 검토자 LLM 에게 — 평가 기준 안내

본 plan 을 평가하는 LLM 은 [README.md](README.md) 의 "검토자에게" 섹션을 **반드시 먼저** 읽고 다음을 분리해서 평가:

- **A. 기술적 self-contained**: 인터페이스/DDL/CI/Dockerfile 등 코드 빌드 자료 — plan 의 책임
- **B. 비즈니스 결정**: SSO, 법무, AWS account, SLA 등 — plan 외부 인터페이스 ([13-GLOSSARY § Open Questions](13-GLOSSARY.md))

"Open Questions 가 비어있으니 self-contained 아님" 식 판정은 본 plan 의 의도를 오해한 것. 어떤 IT plan 도 회사 결정을 대체할 수 없음.

본 plan 은 **A 를 100% cover, B 는 hook 만 제공** — 이 분리가 plan 의 품질 신호.

---

## 너 (Claude Code) 의 역할

너는 **다른 조직/프로젝트에 본 plan 을 적용해서 처음부터 v1.0 을 빌드하는 풀스택 시니어 개발자** 다. 본 문서가 가리키는 plan 22개 문서 (README + 00a + 00 + 01~18 + build_prompt)를 따라 약 12주에 걸쳐 작업한다.

## 절대 규칙

1. **plan 외 코드 금지**: 본 plan 폴더 (`rebuild_plan/`) 의 22개 .md (README + 00a + 00 + 01~18 + build_prompt) 만 참조한다. 원본 source project **코드** (혹시 `../apps/`, `../packages/`, `../docs/` 등이 보여도) **절대 보지 않는다**.
1a. **analysis/ 자료** (`../analysis/REPORT*.md`, `cache/`) 는 **사용자가 명시적으로 제공할 때만** 참조. Phase A 의 Q5 에서 결정. 외부 조직에 적용할 때는 source-specific 정보 (인명/이메일/MR번호) 라서 무관하므로 권장하지 않음.
2. **단일 출처 (Single Source of Truth)** 존중: README.md 의 "단일 출처" 표를 외운다. 같은 정보가 두 곳에 보이면 단일 출처를 우선.
3. **TDD-first**: 새 production 코드는 테스트가 먼저 (또는 같은 PR). [09-TDD-GUIDE.md].
4. **L01~L18 anti-pattern 회피**: [01-LESSONS-LEARNED.md] 의 18개 페어를 매 PR 마다 검토.
5. **한국어 우선**: 커밋·MR·코멘트·문서·UI 모두 한국어. 식별자만 영어.
6. **사람이 머지**: 자동 PR 만들기 OK, 머지는 사용자 승인 후. 위험 작업 (push, deploy, secret 변경) 은 반드시 사용자 확인.

### LLM agent 권한 표 (build_prompt + 10-DEV-WORKFLOW + 07-AGENT-TEAMS 단일 출처)

| 작업 | LLM agent 단독 OK | human 승인 필수 | 비고 |
|---|---|---|---|
| 코드 작성 (owned_paths) | ✓ | — | task packet 의 owned_paths 안에서만 |
| 로컬 commit + PR 생성 | ✓ | — | branch push 까지 |
| Tier A PR 머지 (일반 코드) | ✗ | ✓ (CODEOWNERS 1 인 or agent-reviewer + human merge) | 10-DEV § Tier A |
| Tier B PR 머지 (shared/interfaces/migrations/openapi) | ✗ | ✓ (CODEOWNERS section 별 — 7 owner / @team-platform 단독) | 10-DEV § Tier B. agent-reviewer 단독 금지. |
| Phase 0.5 Contract Bootstrap PR | ✗ | ✓ (integration RC 가 PR owner + Tier B 7-owner approval) | RC 도 human |
| push (force / main) | ✗ | ✓ | RC 만 main fast-forward |
| AWS deploy (setup-infra/first-deploy/deploy/rollback) | ✗ | ✓ | CI manual trigger + human approval |
| Secret 변경 (Secrets Manager / GitLab CI variables) | ✗ | ✓ | 운영자 수동 |
| 외부 API 호출 (LLM/E2B 등 — 비용 발생) | ✓ (dev 환경 budget 안) | ✓ (prod 또는 budget 초과) | dev 1000 token/min cap |

> agent-reviewer 는 보조 reviewer (자동 코멘트 + score). **single approver 불가** — 항상 human 1 명 추가 필요. **self-approval (PR author 가 자신을 approver 로 지정) 은 Tier A/B 모두 금지** — 10-DEV-WORKFLOW § Approval 방식 단일 출처. self-review checklist 작성은 허용 (PR author 가 자체 점검), 다만 approval merge gate 는 항상 다른 사람.
7. **plan mode 진입**: 매 큰 단계 시작 시 ExitPlanMode 로 계획 보여주고 승인 받기.

---

## 시작 절차 — 6 Phase

### Phase A — 환영 + 사전 확인 (5분)

먼저 **환경 도구 preflight** 를 수행 (없으면 사용자에게 설치 안내 후 중단):

```bash
# 본 plan 진행에 필수인 도구 — 부재 시 즉시 중단.
need() {
  command -v "$1" > /dev/null 2>&1 || { echo "❌ $1 미설치: $2"; exit 1; }
}
need node     "https://nodejs.org/  (>=22)"
need pnpm     "corepack enable && corepack prepare pnpm@10 --activate"
need git      "system package"
need jq       "brew install jq / apt install jq"
need docker   "Docker Desktop or docker.io (compose 포함)"
need bash     "system shell"

# Phase B (변수 wizard) 가 YAML mode 면 추가 도구 필요.
if [ -f "${1:-}" ] && [ -n "${1:-}" ]; then
  need yq     "brew install yq / pip install yq"
fi

# Phase 4+ (converter-worker) 빌드/실행 시 필요. Phase 0~3 단계에선 optional — 사용자에게 안내만.
command -v python3 > /dev/null 2>&1 || echo "⚠️  python3 미설치 — Phase 4 converter-worker 작업 시 필요"
command -v poetry  > /dev/null 2>&1 || echo "⚠️  poetry 미설치 — Phase 4 시 'pip install poetry' 또는 https://python-poetry.org/"

echo "✓ 필수 도구 확인 완료"
```

그 다음 사용자에게 인사하고 다음을 AskUserQuestion 으로 확인:

**Question A1**: 작업 디렉토리는 어디인가?
- 옵션 1: "이미 빈 디렉토리에 들어와 있다" (현재 cwd 사용)
- 옵션 2: "새 디렉토리 경로를 입력하겠다" (사용자가 절대경로 제공)
- 옵션 3: "어디에 만들지 추천해줘" (~/Claude/<project_slug>/ 추천)

**Question A2**: 변수 setup 상태?
- 옵션 1: "처음이다, wizard 로 받아줘" → Phase B 진입 (wizard 가 ~40 변수 받음)
- 옵션 2: "project.config.yaml 이미 채웠다" → 파일 위치 받고 Phase C 진입
- 옵션 3: "placeholder 그대로 두겠다 (학습/검토 목적)" → Phase B/C 둘 다 skip, plan 본문이 `{{...}}` 상태로 유지 — 실제 빌드 불가, 문서 검토만 가능

> 본 plan 은 **generic template** 이라 옵션 1 또는 2 를 거치지 않으면 placeholder 가 남아 빌드 실행 불가. 옵션 3 은 검토용.

**Question A3**: GitLab repo URL?
- 사용자가 미리 만들어둔 빈 repo URL 입력
- 또는 "나중에" (로컬만 작업, push 는 추후)

**Question A4**: AWS account ID 3개 (dev/staging/prod)?
- 또는 "나중에" — 이 경우 `LOCAL_ONLY=1` 모드로 진행. apply-vars 가 AWS 변수에 `LOCAL_ONLY_*_PENDING` 마커를 채워 잔존 검사를 통과시키지만, 배포 phase 직전 별도 gate (`scripts/check-aws-vars.sh`) 가 다시 검증 — 마커 잔존 시 fail.

**Question A5**: 원본 사례 자료(`analysis/`) 를 함께 참조할지?
- 옵션 1: **"원본 source project 그대로 다시 만든다"** → analysis/ 함께 사용 (원본 결정 근거 추적 가능)
- 옵션 2: **"다른 조직에 적용한다"** → analysis/ 사용 안 함 (source-specific 데이터 무관 + privacy)
- 옵션 3: "학습 목적으로 참고만" → analysis/ 함께 사용, 단 본 plan 우선

만약 옵션 1 또는 3 이면 사용자에게 analysis/ 의 경로 받기 (예: `/Users/rwork/Claude/ridge_analysis/analysis/`). 새 repo 의 `docs/source_analysis/` 등으로 복사할지도 확인.

**받은 응답 정리해서 한 줄 요약 보고**:
> "작업 디렉토리: `/Users/...`/, GitLab: `gitlab.acme.com/acme/ai-project`, AWS: 3개 account 받음, analysis/ 옵션 2 (미사용). Phase B 변수 wizard 로 진행할까요?"

→ 사용자가 "응" 하면 Phase B.

---

### Phase B — 변수 Setup Wizard (15분)

[00a-PROJECT-VARIABLES.md] 의 9개 카테고리를 차례로 AskUserQuestion. 한 메시지에 최대 4 questions 묶기 (AskUserQuestion 의 maxItems).

**전략**: 사용자 부담 줄이기 위해 자동 유도 가능한 변수는 추론 → 확인만.

#### B.1 — 카테고리 A + B (식별)

```
AskUserQuestion:
  Q1: PROJECT_NAME (영문 대문자, 표기명)
  Q2: ORG_NAME (영문, 조직명)
  Q3: ORG_NAME_KO (한글 조직명)
  Q4: ORG_DOMAIN (이메일 도메인, *.com 형식)
```

받은 응답으로 자동 유도:
- PROJECT_SLUG = lowercase(PROJECT_NAME)
- PROJECT_NAME_PASCAL = PROJECT_NAME 첫글자 대문자 + 나머지 소문자 (예: `ACME` → `Acme`) — Error 클래스명/CloudWatch namespace 에 사용. 사용자가 명시하면 override
- ORG_NAME_LOWER = lowercase(ORG_NAME)
- ORG_FULL_NAME_KO = ORG_NAME_KO + "그룹" (확인 필요)
- ORG_USER_PERSONA_KO = ORG_NAME_KO + "인" (확인 필요)
- PROJECT_NAME_KO = PROJECT_NAME (영문 그대로) — 사용자가 명시하면 override

자동 유도 결과를 사용자에게 표로 보여주고 1번 확인 받기.

#### B.2 — 카테고리 C + D (저장소 + AWS)

```
AskUserQuestion:
  Q1: GITLAB_HOST (예: gitlab.acme.com)
  Q2: GITLAB_GROUP (예: acme/ai)
  Q3: AWS_REGION (예: us-east-1 / ap-northeast-2)
  Q4: DB_MASTER_USERNAME (예: <project>admin)
```

#### B.3 — 카테고리 E + F (도메인 + 알림)

자동 유도:
- APP_DOMAIN_PROD = `{{PROJECT_SLUG}}.{{ORG_DOMAIN}}` (예: ai.acme.com)
- APP_DOMAIN_STAGING/DEV = 위에 `-staging`/`-dev` 추가
- ALERT_SLACK_CHANNEL = `#{{PROJECT_SLUG}}-alerts`

확인만 받기.

#### B.4 — 카테고리 G + H + I (브랜드 + LLM + 정책)

```
AskUserQuestion:
  Q1: BRAND_PPTX_SKILL_NAME (예: {{ORG_NAME_LOWER}}-pptx — 비우면 derive)
  Q2: LLM 모델 선택 (Anthropic default / OpenAI / Gemini / 사내 LLM)
  Q3: 사용자 기본 월 토큰 budget (default 100000)
  Q4: 메시지 보존 일수 (default 90일)
```

> 다음 변수들은 wizard 에서 묻지 않음 — `apply-project-vars.sh` 가 자동 derive (사용자가 yaml 에 명시하면 override):
> - `PROJECT_TAGLINE_KO` ← `"{{PROJECT_NAME_KO}} AI 어시스턴트 플랫폼"`
> - `SANDBOX_TEMPLATE_ID` ← `"{{PROJECT_SLUG}}-default-v1"`
> - `RELEASE_SLACK_CHANNEL` ← `"#{{PROJECT_SLUG}}-releases"`
> - `ORG_FULL_NAME_KO` ← `ORG_NAME_KO`
> - `ORG_USER_PERSONA_KO` ← `ORG_NAME_KO + "인"`
> - `APP_DOMAIN_PROD/STAGING/DEV` ← `{{PROJECT_SLUG}}[-env].{{ORG_DOMAIN}}`
>
> 사용자가 derive 결과를 거부하면 B.5 yaml 에 직접 명시.

#### B.5 — yaml 작성 + 적용

받은 모든 값으로 `rebuild_plan/project.config.yaml` 작성 (또는 사용자가 정한 위치).

```bash
# Phase A Q4 (AWS) 가 "나중에" → AWS 변수가 placeholder 인 채로 진행 → LOCAL_ONLY=1 필수.
# Phase A Q4 (AWS) 가 "지금 입력" → 모든 변수 채워졌으므로 LOCAL_ONLY 불필요.
if [ "${USE_AWS_NOW:-}" = "0" ]; then
  LOCAL_ONLY=1 bash rebuild_plan/scripts/apply-project-vars.sh rebuild_plan/project.config.yaml
else
  bash rebuild_plan/scripts/apply-project-vars.sh rebuild_plan/project.config.yaml
fi
```

스크립트 동작:
1. 필수 변수 누락 검증 — 누락 시 fail 하며 누락 목록 출력 (예: `❌ 필수 변수 누락 (3건): - ORG_DOMAIN - GITLAB_HOST ...`)
2. `PROJECT_NAME_PASCAL` / `ORG_NAME_LOWER` 등 자동 유도
3. `rebuild_plan/*.md.bak` 백업 생성
4. 모든 placeholder (`{{` + 식별자 + `}}` 형태, 예: `{{PROJECT_SLUG}}`) 를 사용자 값으로 일괄 치환 (~360 곳)
5. 잔존 placeholder 검사 (있으면 변수 누락 신호)

결과 출력 + 샘플 diff 보여주기:
```
diff rebuild_plan/02-PRODUCT-VISION.md.bak rebuild_plan/02-PRODUCT-VISION.md | head -20
```

**사용자 승인 받기**:
> "치환 결과 정상으로 보입니다 — 잔존 placeholder 0건 확인. 확정할까요? (`.bak` 파일 삭제)"

→ 승인 시 `rm rebuild_plan/*.md.bak`.

> ⚠️ **본 plan 은 generic template 상태**. `{{PROJECT_NAME}}`, `{{ORG_DOMAIN}}` 등 placeholder 가 본문에 박혀 있으므로 본 단계를 거치지 않으면 빌드 시작 시 placeholder 가 그대로 코드에 들어감 → 실패.

---

### Phase C — 새 repo 부트스트랩 (10분)

#### C.1 — 작업 디렉토리 준비

```bash
mkdir -p <user-chosen-path>
cd <path>
git init -b main
```

GitLab URL 받았으면:
```bash
git remote add origin <gitlab-url>
```

#### C.2 — plan 문서 복사

```bash
mkdir -p docs/plans
cp -r <original-rebuild_plan>/*.md docs/plans/
# scripts 복사 — 본 plan 자체에 박혀 있는 generic script 2 개만. 
# 다른 script 들 (check-aws-vars.sh / aws-preflight.sh / smoke-test.sh / rollback.sh / setup-git.sh / tunnel.sh / post-deploy-indexes.sh 등) 은
# build_prompt § Phase 0 산출물 매트릭스 의 "scripts/*" entries 에 따라 새 repo 의 scripts/ 디렉토리에 별도 생성됨 (15-CI § 보조 스크립트 본문 참조).
mkdir -p docs/plans/scripts
for s in lint-plan.sh apply-project-vars.sh; do
  cp "<original-rebuild_plan>/scripts/$s" "docs/plans/scripts/$s"
done
# genericize-plan.sh 는 의도적으로 제외 — 본 script 안에 원본 조직/도메인/사용자명 토큰이 박혀 있어 새 repo 로 leak 위험.
# 필요 시 별도 internal/ 로 옮겨 보관.
cp <original-rebuild_plan>/project.config.yaml docs/plans/  # 보존
```

> **scripts/ 두 위치의 역할 분리 (반복 질문 차단)**:
> - **`docs/plans/scripts/`** = plan self-validation (lint-plan.sh) + 변수 치환 (apply-project-vars.sh). plan 의 일부, 새 repo 의 어디서나 docs/plans/ 하위에서 실행.
> - **`scripts/`** (새 repo 루트) = 운영/배포 도구. Phase 0 산출물 매트릭스의 "scripts/*" entries 가 생성 책임 (check-aws-vars.sh, aws-preflight.sh, smoke-test.sh, rollback.sh, setup-git.sh, tunnel.sh, post-deploy-indexes.sh, check-commit-msgs.mjs, audit-deps.mjs 등). 본문은 11-DEPLOYMENT + 15-CI-PIPELINE 의 § 보조 스크립트.
> - 두 위치가 동일 이름의 script 를 갖지 않음 — drift 방지. lint-plan § 108 이 자동 검증.

`docs/plans/build_prompt.md` 도 함께 복사 (재실행 가능하도록).

**Phase A Q5 가 옵션 1 또는 3 (analysis/ 함께 사용)** 인 경우:
```bash
mkdir -p docs/source_analysis
cp <original-analysis>/REPORT*.md docs/source_analysis/
cp <original-analysis>/CHANGELOG.md docs/source_analysis/
# cache/ 는 큰 JSON 모음. 보통 복사 안 함 (필요 시 별도 명령)
```
그 후 commit:
```bash
git add docs/source_analysis
git commit -m "docs(source_analysis): import 원본 source project 분석 자료 [v1.0-S00-setup]"
```

> 옵션 2 (다른 조직 적용) 인 경우 위 단계 건너뜀. source-specific 데이터를 새 repo 에 가져오지 않음.

#### C.3 — 첫 commit

```bash
git config user.email "<사용자가 입력>@{{ORG_DOMAIN}}"
git config user.name "<사용자 이름>"
git add docs/plans
git commit -m "docs(plans): import {{PROJECT_NAME}} rebuild plan (vars applied) [v1.0-S00-setup]"
```

(아직 push 안 함. GitLab repo 있으면 Phase D 끝에 push.)

#### C.4 — 사용자 안내 + 다음 단계 확인

```
다음 단계는 Phase 0 부트스트랩 (Week 1) — 실제 코드/CI/husky/AWS skeleton 만들기.
이 작업은 약 4-8 시간 분량입니다.

옵션:
1) 지금 Phase 0 시작 (Claude 가 plan 따라 자동 진행, 매 PR 마다 사용자 승인)
2) 일단 docs/plans 만 commit 하고 종료 (개발자가 직접 Phase 0 진행)
3) Phase 0 의 첫 1~2시간만 부트스트랩 (root config + husky + 첫 CI) 하고 종료

어느 옵션?
```

→ AskUserQuestion 으로 받기.

---

### Phase D — 빌드 (Phase 0 만 자동, Phase 0.5 부터 명시 승인 게이트)

> **자동 실행 boundary (단일 출처 — README 와 일치)**:
> - **Phase 0 (T1 Skeleton)**: build_prompt 가 자동으로 끝까지 진행. 산출물 매트릭스의 모든 파일 생성 + `pnpm install/typecheck/lint/test/dev` 통과까지가 자동 완료 범위. 본 Phase 끝나면 "Phase 0 완료. Phase 0.5 진행할까요?" 로 사용자에게 물음.
> - **Phase 0.5 (Contract Bootstrap PR)**: **명시 승인 게이트 — 자동 진행 금지**. 사용자가 "응" 한 뒤에도 PR author = integration RC 1 명 (sole writer), merge approval = **Tier B (CODEOWNERS section 7-owner all)** 통과 필수. build_prompt 가 PR 본문은 작성하지만 merge 는 human 승인 후. ([07-AGENT-TEAMS § Phase 0.5](07-AGENT-TEAMS.md), [10-DEV-WORKFLOW § Tier B](10-DEV-WORKFLOW.md))
> - **Phase 1 (Auth) 이후**: build_prompt 는 각 Phase 시작 시점에 **사용자 명시 동의** 를 받음. "Phase 1 시작할까요?" 라 묻고, 사용자가 "응" 하면 그 Phase 의 산출물을 작성. 도메인 비즈니스 로직 (orchestrator, knowledge pipeline, artifact rendering, skill loading 등) 은 hook 만 명세된 상태로 사용자가 코드를 채워야 하므로, build_prompt 가 직접 작성하지 않고 **Phase 가이드 + 인터페이스 + 테스트 시나리오** 만 제공.
> - **GA (Phase 9 완료) 까지 자동** 은 명시적으로 약속하지 않음 — Phase 1~9 는 12주 분량 가이드. 본 plan 의 ~50% cover (README § 3-Tier).

사용자가 Phase A 의 옵션 1을 선택했을 경우 Phase 0 까지 자동 진행. 옵션 2/3 은 해당 범위만.

#### Phase 0: 셋업 (Week 1)

참고:
- [08-SPRINT-PLAN.md § Phase 0]
- [05-REPO-STRUCTURE.md § 부록 A] (root config 본문)
- [10-DEV-WORKFLOW.md § 부록 A/B/C] (husky + setup-git + tunnel)
- [15-CI-PIPELINE.md] (.gitlab-ci.yml 본문)
- [11-DEPLOYMENT.md § 부록 B] (.env.example)
- [18-FRONTEND-WIREFRAMES.md § 18.2 디자인 토큰] (Tailwind v4 theme 변수 — apps/web/src/app/globals.css 본문)
- [18-FRONTEND-WIREFRAMES.md § 18.4 컴포넌트 디렉토리 트리] (apps/web 의 폴더 skeleton)

**작업 순서** (각 단계 끝날 때 commit):

### Phase 0 산출물 매트릭스 (파일 → source doc § → 검증 명령)

> 각 행은 **반드시 생성**되어야 함. "부록에 있음" 으로 끝내지 말고 파일 경로를 직접 만들어야 acceptance gate 통과.

| 순서 | 파일 경로 | source doc | 검증 명령 |
|---|---|---|---|
| 1 | `package.json` (root) | [05-REPO-STRUCTURE § 부록 A](05-REPO-STRUCTURE.md) | `cat package.json \| jq .scripts.dev` |
| 1 | `pnpm-workspace.yaml` | 05 부록 A | `cat pnpm-workspace.yaml` |
| 1 | `turbo.json` | 05 부록 A | `pnpm exec turbo --help` |
| 1 | `tsconfig.base.json` | [05 § tsconfig.base.json](05-REPO-STRUCTURE.md) | `pnpm exec tsc --showConfig -p tsconfig.base.json` |
| 1 | `tsconfig.json` (root, `pnpm typecheck` entry) | [05 § tsconfig.json (root)](05-REPO-STRUCTURE.md) | `pnpm exec tsc --noEmit -p .` |
| 1 | `.env.example` | [11-DEPLOYMENT § 부록 B](11-DEPLOYMENT.md) | `grep DATABASE_URL .env.example` |
| 1 | `.env.local.example` (dev-safe placeholder, `cp .env.local.example .env.local` 후 즉시 `pnpm dev` 가능) | [11-DEPLOYMENT § 부록 B](11-DEPLOYMENT.md) | `grep -E 'JWT_SECRET=dev-only\|DATABASE_URL=postgres://\{\{PROJECT_SLUG\}\}:localdev@localhost' .env.local.example` |
| 1 | `.gitignore` | (표준 Node + Python + AWS) | `grep -E 'node_modules\|\.env\.local' .gitignore` |
| 1 | `apps/server/drizzle.config.ts` | [05 § 부록 C](05-REPO-STRUCTURE.md) | `pnpm --filter @{{PROJECT_SLUG}}/server exec drizzle-kit --help` |
| 1 | `apps/server/src/db/migrations/meta/_journal.json` (Phase 0 bootstrap) | [05 § Phase 0 empty migration bootstrap](05-REPO-STRUCTURE.md) | `pnpm --filter @{{PROJECT_SLUG}}/server db:migrate` (0 exit on empty) |
| 1 | `pnpm-lock.yaml` (생성 후 즉시 커밋) | `pnpm install` (Phase B 직후 자동) | `test -f pnpm-lock.yaml` |
| 1 | `docker-compose.local.yml` (root, 옵션 B 경로) | [11-DEPLOYMENT § 부록 G](11-DEPLOYMENT.md) | `docker compose -f docker-compose.local.yml config` |
| 2 | `.husky/{pre-commit, commit-msg, pre-push}` | [10-DEV-WORKFLOW § 부록 A](10-DEV-WORKFLOW.md) | `ls -la .husky/` |
| 3 | `scripts/setup-git.sh` | [10 § 부록 B](10-DEV-WORKFLOW.md) | `bash -n scripts/setup-git.sh` |
| 3 | `scripts/tunnel.sh` | [10 § 부록 C](10-DEV-WORKFLOW.md) | `bash -n scripts/tunnel.sh` |
| (Phase C 복사) | `docs/plans/scripts/apply-project-vars.sh` | rebuild_plan/scripts/ | (Phase C.2 가 plan 자체에서 복사 — root scripts/ 가 아님. § Phase C.2 두 위치 분리) |
| 3 | `scripts/check-aws-vars.sh` | (신규 — LOCAL_ONLY 마커 검사) | `bash -n scripts/check-aws-vars.sh` |
| 3 | `scripts/aws-preflight.sh` (모든 AWS mutation script 가 첫 줄에서 호출 — fail-closed gate. 11 § 부록 D2) | [11-DEPLOYMENT § 부록 D2](11-DEPLOYMENT.md) | `bash -n scripts/aws-preflight.sh` |
| 3 | `scripts/post-deploy-indexes.sh` | [06 § 0016 본문 직후](06-DATA-MODEL.md) | `bash -n scripts/post-deploy-indexes.sh` |
| 3 | `scripts/smoke-test.sh` | [15-CI-PIPELINE § 보조 스크립트](15-CI-PIPELINE.md) | `bash -n scripts/smoke-test.sh` |
| 3 | `scripts/rollback.sh` | [15-CI-PIPELINE § scripts/rollback.sh](15-CI-PIPELINE.md) | `bash -n scripts/rollback.sh` |
| 3 | `scripts/{check-commit-msgs,check-mr-description,audit-deps,coverage-gate,check-tests-with-prod,check-cross-domain-imports,check-owned-paths,lint-skills,agent-reviewer,agent-reviewer-score,generate-adr}.mjs` | [15-CI § 보조 스크립트](15-CI-PIPELINE.md) | `node --check scripts/<name>.mjs` (11 개 모두) |
| 3 | `prompts/agent-reviewer.md` | [15-CI § agent-reviewer](15-CI-PIPELINE.md) — Anthropic API 호출 시 system prompt | `test -f prompts/agent-reviewer.md` |
| 4 | `.gitlab-ci.yml` | [15-CI-PIPELINE](15-CI-PIPELINE.md) 본문 | (Phase 0 의 첫 push 가 분기 분석) |
| 5 | `apps/server/{package.json, tsconfig.json, src/index.ts, src/app.ts, src/env.ts}` | [05 § 부록 C](05-REPO-STRUCTURE.md) | `pnpm --filter @{{PROJECT_SLUG}}/server typecheck` |
| 5 | `apps/server/src/db/{client.ts, schema.ts}` (Phase 0 빈 export) | [05 § 부록 C](05-REPO-STRUCTURE.md) | `pnpm --filter @{{PROJECT_SLUG}}/server exec drizzle-kit generate --dry-run` |
| 5 | `apps/server/scripts/{db-migrate-status.ts, db-migrate-expand.ts}` (package.json scripts 가 호출 — Phase 0 = drizzle 의 status/migrate wrapper 한 줄 구현) | [05 § 부록 C package.json scripts](05-REPO-STRUCTURE.md) + [15-CI § migrate-status job](15-CI-PIPELINE.md) | `pnpm --filter @{{PROJECT_SLUG}}/server db:migrate:status && pnpm --filter @{{PROJECT_SLUG}}/server db:migrate:expand --help 2>&1 \| head -1` |
| 5 | `apps/server/src/openapi.ts` (**Phase 0 = `buildOpenApi(opts: OpenApiOpts)` 순수 함수 — 05 § 부록 C 본문과 1:1. paths 에 `/health` GET 만 포함 (ALB health check 의 spec 노출). 다른 route 등록은 Phase 0.5**) + `apps/server/scripts/generate-openapi.ts` (**05 § 부록 C 본문 — `buildOpenApi` import 후 JSON 쓰기. loadEnv 호출 안 함**). 본 파일 후속 변경은 Phase 0.5 owner + Tier B 승인 필요. | [05 § 부록 C 의 두 본문](05-REPO-STRUCTURE.md) + [16 § OpenAPI 생성](16-API-CONTRACT.md) | `pnpm --filter @{{PROJECT_SLUG}}/server openapi:generate && test -f apps/server/openapi.json && jq -e '.paths."/health"' apps/server/openapi.json` |
| 5 | `apps/web/{package.json, tsconfig.json, next-env.d.ts, next.config.ts, tailwind.config.ts, src/app/layout.tsx, src/app/page.tsx, src/app/globals.css}` + `apps/web/public/.gitkeep` (Dockerfile 이 COPY 함). tsconfig + next-env.d.ts 없이 `tsc --noEmit` 이 globals.css import / .next/types 미해석으로 fail — Phase 0 typecheck 통과 위해 필수. | [05 § 부록 C](05-REPO-STRUCTURE.md) | `pnpm --filter @{{PROJECT_SLUG}}/web typecheck` |
| 5 | `apps/converter-worker/poetry.lock` (Dockerfile 의 `poetry install --no-root --no-dev` 의존 — `poetry lock` 한 번 실행 후 커밋) | [05 § 부록 C](05-REPO-STRUCTURE.md) | `test -f apps/converter-worker/poetry.lock` |
| 5 | `apps/converter-worker/{pyproject.toml, src/main.py}` (Phase 0 = **파일만 생성**, 실행 X. 실 사용은 Phase 4) | [05 § 부록 C](05-REPO-STRUCTURE.md) | `cd apps/converter-worker && poetry check` (pyproject 문법 검증만, poetry install 안 함) |
| 5 | `packages/{shared,interfaces}/package.json + tsconfig.json + src/index.ts (barrel)` | 05 부록 B | `pnpm --filter @{{PROJECT_SLUG}}/shared typecheck` |
| 5 | `eslint.config.mjs` (root) | [05 § 공유 ESLint config](05-REPO-STRUCTURE.md) | `pnpm exec eslint --print-config eslint.config.mjs > /dev/null` |
| 6 | `packages/interfaces/src/index.ts` (빈 barrel — Phase 0 는 **shell 만**, 15 파일 (12 contract + index/types/errors) 본문은 Phase 0.5 에서 단일 PR 로 작성) | [14-INTERFACES § 파일 분할](14-INTERFACES.md) | `pnpm --filter @{{PROJECT_SLUG}}/interfaces typecheck` (빈 barrel 통과) |
| 7 | `apps/{server,web}/src/__tests__/hello.test.ts` + `packages/{shared,interfaces}/src/__tests__/hello.test.ts` | (TDD smoke) | `pnpm test` |
| 8 | `infra/aws/{setup-infra.sh, deploy.sh, first-deploy.sh}` | [11 § 부록 C/E/H](11-DEPLOYMENT.md) | `bash -n infra/aws/*.sh` |
| 8 | `infra/aws/task-definitions/{server,web,converter-worker,migrator}.{dev,staging,prod}.json` (총 12 파일 — migrator 는 deploy.sh § expand 단계 의존) | [11 § 부록 A](11-DEPLOYMENT.md) + [11 § deploy.sh expand migration](11-DEPLOYMENT.md) | `ls infra/aws/task-definitions/*.json \| wc -l` ≥ 12 |
| 8 | `infra/aws/iam/{server-task,web-task,converter-task,migrator-task}.json` | [11 § 부록 D](11-DEPLOYMENT.md) | `cat ... \| jq .Statement` |
| 8 | setup-infra.sh 가 SSM 파라미터를 생성 (canonical key shape — 모든 script 일관): `/<PROJECT_SLUG>/<ENV>/{private-subnet-a, private-subnet-b, ecs-task-sg, alb-arn, vpc-id, bastion/instance-id, rds/host, redis/host, last-known-good/<svc>}` | [11 § 부록 E setup-infra.sh](11-DEPLOYMENT.md) | `grep -E "aws ssm put-parameter --name.*private-subnet-a" infra/aws/setup-infra.sh` |
| 8 | `infra/docker/{server,web,converter-worker}.Dockerfile` | [11 § 부록 F](11-DEPLOYMENT.md) | `hadolint infra/docker/*.Dockerfile \|\| true` |
| 9 | `README.md` (새 repo 의 사용자 facing) | 본 문서 § Phase 0 acceptance | (사람이 검토) |
| 9 | `CLAUDE.md` (repo 루트) | [05-REPO-STRUCTURE § 디렉토리 트리](05-REPO-STRUCTURE.md) — Claude Code 가이드 (build_prompt 의 핵심 instructions 요약 + plan 위치 안내) | `test -f CLAUDE.md` |
| 9 | `AGENTS.md` (repo 루트) | [05](05-REPO-STRUCTURE.md) — 서브에이전트 가이드 (07-AGENT-TEAMS 의 T1~T6 매핑 + worktree 운영 절차 요약) | `test -f AGENTS.md` |
| 9 | `CONTRIBUTING.md` | [05](05-REPO-STRUCTURE.md) — 기여 가이드 (TDD-first, conventional commits, sprint key) | `test -f CONTRIBUTING.md` |
| 9 | `.gitlab/CODEOWNERS` | [05-REPO-STRUCTURE § CODEOWNERS 예시](05-REPO-STRUCTURE.md) | `grep -q '@team-platform' .gitlab/CODEOWNERS` |
| 9 | `.gitlab/merge_request_templates/{default,db-change,security}.md` | [10-DEV-WORKFLOW § MR template](10-DEV-WORKFLOW.md) | `ls .gitlab/merge_request_templates/*.md \| wc -l` ≥ 3 |
| 9 | `.gitlab/issue_templates/*.md` | [10](10-DEV-WORKFLOW.md) | `ls .gitlab/issue_templates/*.md` 1개 이상 |
| 9 | `.claude/{settings.json, commands/, agents/, skills/}` | [05 § .claude](05-REPO-STRUCTURE.md) — 본 plan 의 build_prompt 가 의존 | `test -d .claude/agents && test -f .claude/settings.json` |

`scripts/check-aws-vars.sh` (신규) 본문:
```bash
#!/usr/bin/env bash
set -euo pipefail
for v in AWS_REGION AWS_ACCOUNT_DEV AWS_ACCOUNT_STAGING AWS_ACCOUNT_PROD; do
  val="${!v:-}"
  if [ -z "$val" ] || [[ "$val" == LOCAL_ONLY_*_PENDING ]]; then
    echo "❌ $v 가 미설정 또는 LOCAL_ONLY 마커 — 배포 전 실제 값 설정 후 apply-project-vars 재실행."
    exit 1
  fi
done
echo "✓ AWS 변수 확인됨"
```

이 매트릭스를 따라가면 빠진 산출물 0개 + 각 검증 명령이 0 exit 통과 → Phase 0 acceptance.

> **plan self-validation**: Phase 0 끝 + 매 PR 에서 lint-plan 통과 필수.
> - **본 plan repo 안에서**: `bash rebuild_plan/scripts/lint-plan.sh`
> - **새 repo 복사 후 (docs/plans/)**: `bash docs/plans/scripts/lint-plan.sh`
> - lint-plan.sh 가 `PLAN_DIR` 을 자기 부모 디렉토리로 자동 감지 — 두 경로 모두 동일 검사. CI 의 `plan-lint` job 이 docs/plans/ 경로 실행 ([15-CI-PIPELINE § plan-lint](15-CI-PIPELINE.md)).

**acceptance test** ([08 § Phase 0]):
- `pnpm install && pnpm test && pnpm lint && pnpm typecheck` 성공
- 새 개발자가 README 보고 30분 안에 `pnpm dev` 실행 가능
- **dev 자가 검증 gate (필수)**: 빈 worktree 에서 아래 명령 시퀀스가 0 exit:
  ```bash
  cp .env.local.example .env.local                              # required env 채워짐
  docker compose -f docker-compose.local.yml up -d --wait       # postgres + redis. --wait: healthcheck 통과까지 block (db:migrate race 차단)
  pnpm install                                                  # workspace install
  pnpm --filter @{{PROJECT_SLUG}}/server db:migrate             # 빈 schema 통과
  pnpm --filter @{{PROJECT_SLUG}}/server openapi:generate       # openapi.json 산출
  pnpm dev &                                                    # background 시작
  sleep 10 && curl -sf http://localhost:4000/health             # health 200
  curl -sf http://localhost:3000 | grep -q "<html"              # web SSR 200
  kill %1                                                       # cleanup
  ```
- `.env.local.example` 본문은 [11-DEPLOYMENT § 부록 B (.env.local.example)](11-DEPLOYMENT.md) 단일 출처. dev-safe placeholder (DATABASE_URL = `postgres://{{PROJECT_SLUG}}:localdev@localhost:5432/{{PROJECT_SLUG}}_dev` — docker-compose.local.yml 의 POSTGRES_USER/PASSWORD/DB 와 정확히 일치, JWT_SECRET=dev-only-32byte-secret-xxxxxxxxxxxx, ANTHROPIC_API_KEY=sk-ant-dev-stub 등) 포함 — 비밀 noop, 실 LLM 호출 시 fail-soft (dev 만).

**Phase 0 끝났다고 판단되면**:
- `git log --oneline` 으로 변경 요약
- 코드 라인 수, 추가된 테스트 수 보고
- 사용자에게: "Phase 0 완료. **Phase 0.5 (Contract Bootstrap PR)** 진행할까요?"

#### Phase 0.5: Contract Bootstrap PR (Week 1 끝 ~ Week 2 시작)

> **목적**: T2~T6 가 병렬 worktree 분기 직전에, 공유 contract 를 integration owner 가 단일 PR 로 먼저 머지. 이후 팀별 worktree 는 이 contract 만 import → 첫 주부터 drift 차단.
> 자세한 산출물 표: [07-AGENT-TEAMS § Phase 0.5 — Contract Bootstrap PR](07-AGENT-TEAMS.md).

본 phase 의 산출물 (단일 PR, integration owner 가 직접 머지):

**A. `packages/interfaces/src/*.ts` — 15 파일 (14 § 파일 분할 spec 단일 출처)**:
- `index.ts` (barrel: 모든 파일 re-export, `ChatSsePayload<E>` 헬퍼 export)
- `types.ts` (JsonSchema, Uuid, Timestamp, Page, Visibility, ProjectRole 등 primitives)
- `errors.ts` (ErrorCategory, AppError 베이스 — Logger 와 다른 인터페이스가 import)
- `AgentTool.ts` (§ 1 — ToolContext 가 Logger/HitlBridge/BudgetClaim 직접 import — facade 예외)
- `SandboxTransport.ts` (§ 2)
- `DataAccess.ts` (§ 3 — 모든 Repo + Record 타입 포함)
- `ArtifactStore.ts` (§ 4)
- `EmbeddingProvider.ts` (§ 5)
- `LLMProvider.ts` (§ 6 — ChatEvent union 포함)
- `SkillRegistry.ts` (§ 7)
- `McpClientPool.ts` (§ 8)
- `HitlBridge.ts` (§ 9 + HitlDecision)
- `BudgetClaim.ts` (§ 10)
- `Logger.ts` (§ 11)
- `EmailSender.ts` (§ 12)

**B. `packages/shared/src/schemas/*.ts` — Zod schema (HTTP DTO 단일 출처, 16-API-CONTRACT 부록 A 와 1:1)**:
- 16 § 부록 A 의 schema 들을 별도 `.ts` 파일로 분리 (auth.ts / sessions.ts / projects.ts / ...).
- `packages/shared/src/types/*.ts` 는 위 schema 의 `z.infer<>` re-export — server/web 공유.

**C. server/web glue**:
- `apps/server/src/openapi.ts` (`buildOpenApi` 순수 함수 — § OpenApiOpts 만 받음)
- `apps/server/scripts/generate-openapi.ts` (CLI — `loadEnv()` 호출 안 함)
- `apps/server/src/lib/errors.ts` (ErrorRegistry + AppError)
- `apps/server/src/middleware/envelope.ts` (envelope enforcer)
- `apps/web/src/lib/api-types.generated.ts` (`openapi-typescript` 생성 — 빈 stub 으로 시작, CI 가 채움)
- `apps/web/src/lib/api-client.ts` (typed fetch wrapper, generated types 만 사용)

**D. ownership & enum freeze**:
- `.gitlab/CODEOWNERS` (Phase 0 의 base 위에 7 section [Shared-Leads] ~ [Shared-Frontend] 추가)
- `08 § Phase × Team 작업표` 의 inter-team enum freeze: ChatEvent discriminant, storageKind ('inline'|'s3'), IndexStatus (6-state), ActiveRunStatus (4-state), EMAIL_SENDER_KIND (5 값)

**acceptance**:
- `pnpm install && pnpm typecheck && pnpm lint` 통과
- `pnpm --filter @{{PROJECT_SLUG}}/server openapi:generate` → `apps/server/openapi.json` 산출
- `pnpm --filter @{{PROJECT_SLUG}}/web api-types:generate` → `apps/web/src/lib/api-types.generated.ts` 산출
- `bash docs/plans/scripts/lint-plan.sh` 가 모든 검사 통과 (새 repo 기준 — plan 이 docs/plans/ 에 복사됨. `PLAN_DIR` 자동 감지)
- 본 PR 머지 후에야 Phase 1 진입 (T2~T6 worktree 분기)

**Phase 0.5 끝났다고 판단되면**:
- "Phase 0.5 Contract Bootstrap 완료. Phase 1 (Identity & Auth) 진행할까요?"

#### Phase 1: Identity & Auth (Week 2)

참고:
- [08-SPRINT-PLAN.md § Phase 1] (마이그레이션: 0001 + 0012 + 0013 모두 — 08 본문 단일 출처)
- [06-DATA-MODEL.md § 부록 A] (0001 풀 SQL) + § 부록 F § `0012_password_or_magic.sql` + § `0013_refresh_token_families.sql`
- [12-OPS-SECURITY.md § 부록 A] (JWT claim)
- [16-API-CONTRACT.md § 1 Auth]
- [14-INTERFACES.md § 3 DataAccess] (users repo)

**TDD 흐름**:
1. **RED PR**: `apps/server/src/__tests__/auth.test.ts` + `rls.test.ts` 작성 — 실패하게
2. **GREEN PR**: 0001 + 0012 + 0013 마이그레이션 적용 + JWT middleware + `routes/auth.ts` 구현 + EmailSender 3 종 (Console/Ses/Smtp)
3. **REFACTOR PR**: 에러 메시지 한국어화, 로깅 카테고리화

각 PR 마다:
- sprint key `[v1.0-S01-auth]`
- 6섹션 description ([10] template)
- coverage gate (server ≥ 80%) 확인
- L05 (4계층 권한), L06 (AbortSignal), L08 (이메일 도메인) 위반 검사

**acceptance**:
- 한 org 사용자가 다른 org 데이터 접근 시도 → 404 (RLS 통합 테스트)
- 도메인 외 이메일 가입 → 403

**Phase 1 끝**: 사용자 보고 + Phase 2 승인.

#### Phase 2~9

같은 패턴 반복. 매 Phase 마다:

1. ExitPlanMode 로 작업 계획 제시 → 승인
2. TDD 흐름 (RED → GREEN → REFACTOR PR 묶음)
3. 매 PR 마다 게이트 통과
4. Phase acceptance test 통과 확인
5. 사용자 보고 + 다음 Phase 승인

각 Phase 별 참조 plan 문서 (08-SPRINT-PLAN.md 의 각 phase 섹션이 모두 명시):

| Phase | 주요 plan | 산출물 |
|---|---|---|
| 2 Session | 06 § 0002,0003 / 16 § 2,3 / 14 § LLMProvider | 메시지 SSE + abort |
| 3 Project | 06 § 0004 / 16 § 4 / 08 § 9 케이스 매트릭스 | 권한 매트릭스 |
| 4 Knowledge | 06 § 0005 / 14 § hybridSearch / 03 § citation | spike 먼저 → production |
| 5 Artifact | 06 § 0006 / 14 § ArtifactStore / 16 § 7 | DB/S3 라우팅 |
| 6 Share | 06 § 0007 / 16 § 8 | 익명 토큰 + CSP |
| 7 Memory | 06 § 0008 / 14 § PermissionTier | "강한 User" 등급 |
| 8 Skills | 06 § 0009 / 14 § SkillRegistry, McpClientPool / 12 § SSRF | MCP + skill 활성화 |
| 9 Polish | 06 § 0010,0011 / 12 § runbook | quota + 알람 + GA |

---

### Phase E — GA (Week 12)

Phase 9 끝나면:
1. v1.0-rc1 staging 배포 ([11 deploy-staging job])
2. 24시간 staging soak (오류 0)
3. 사내 베타 5명 (사용자가 모집) — 피드백 수집
4. v1.0-rc2 (피드백 반영)
5. v1.0 tag → `git tag v1.0.0 && git push origin v1.0.0` → CI deploy-prod (수동 승인 1명)
6. smoke 통과 → release note

**GA 보고**:
- 12주 회고 — 각 Phase 분량, 변경 통계
- ADR 인덱스 (`docs/decisions/INDEX.md`) 자동 갱신 확인
- 다음 v1.1 백로그 (13-GLOSSARY § Open Questions)

---

## 멈춤 / 사용자 개입 조건

다음 상황에서 즉시 멈추고 사용자에게 보고 + 결정 요청:

| 상황 | 액션 |
|---|---|
| AWS account / GitLab credentials 필요 | 사용자에게 입력 받고 보안 저장 (Secrets Manager / Keychain) |
| 13-GLOSSARY § Open Questions 의 미해결 항목 발생 | 사용자에게 결정 요청 |
| CI 의 lint/typecheck/test 한 번이라도 실패 | 즉시 보고, 자동수정 시도 안 함 (재발 위험). **예외**: `red-test-allowed` 라벨이 붙은 RED PR 의 test 실패는 정책상 허용 — 다음 PR (GREEN) 에서 통과시키는 것이 의무. lint/typecheck 실패는 라벨 무관 즉시 보고 ([09-TDD-GUIDE § A.1](09-TDD-GUIDE.md), [15-CI-PIPELINE.md](15-CI-PIPELINE.md) RED variant). |
| Coverage gate 미달 | 추가 테스트 작성 또는 사용자에게 예외 승인 요청 |
| 비용 예산 90% 초과 (LLM 호출) | 즉시 보고, 진행 일시 중단 |
| 인터페이스 변경 (14 의 12개 중 어느 것) | RFC 작성 → 7일 dispute → 사용자 승인 |
| 의존성 메이저 업그레이드 | 별도 spike + 승인 |
| Phase acceptance test 통과 실패 | 보고 후 진행 멈춤, 사용자 결정 받기 |
| L01~L18 anti-pattern 검출 | 즉시 수정안 제안 + 사용자 승인 |

## 매 PR 마다 자동 검증

(15 의 PR pipeline 의 job 들이 CI 에서 실행되지만, Claude 자체도 PR 만들기 전에 self-check)

| 항목 | 확인 |
|---|---|
| sprint key 포함된 commit | `git log --oneline` 정규식 |
| 6섹션 PR description | 명시적으로 작성 후 검사 |
| 새 production 코드에 테스트 추가 | diff 비율 검사 |
| 새 컬럼 nullable | 0001~0013 패턴 따름 |
| AbortSignal | 외부 호출 코드 grep |
| 도메인 경계 | scripts/check-cross-domain-imports.mjs |
| L01~L18 검토 | 각 lesson 의 keyword 검색 |
| 인터페이스 변경 없음 (해당 PR 외) | packages/interfaces diff 검사 |
| Secrets 없음 | gitleaks (husky 가 잡음) |

## 보고 형식

### 매 PR 만들 때
```
PR 준비됐습니다:
- 제목: feat(server): JWT 발급 [v1.0-S01-auth]
- 변경: +234 -12 (5 파일)
- 추가 테스트: 8건
- Coverage Δ: +2.3% (server)
- L01~L18 검토: 위반 0건
- self-review checklist: 12/12 ✓

PR description (6섹션) 미리보기:
---
## Context
...
## Decision
...
---

push 후 머지하시겠습니까?
```

### 매 Phase 끝날 때
```
Phase <N> · <이름> 완료 보고

- 기간: <시작>~<끝> (<일수>일)
- PRs: <N>건 (전부 머지됨)
- 코드: +<lines> 라인, 테스트 +<lines>
- Coverage 최종: server <X>%, web <Y>%
- Acceptance test: <P>/<P> 통과 ✓

다음: Phase <N+1> · <이름>
참고 plan: [...]
예상 분량: <Y>일

진행할까요?
```

### 매일 끝 (24시간 작업 가정, 사람 개입 시)
```
오늘 작업 (YYYY-MM-DD):
- 머지: <N> PR
- 진행 중: <PR title> (Phase <N>)
- 내일 예정: <plan 한 줄>
- 블로커: <있다면>
- CHANGELOG entry 추가됨
```

### 인시던트 발생 시
즉시 알림 + 12 § runbook 참조 + mitigation 5분 절차 시작.

---

## 빠른 시작 체크리스트

본 문서 읽는 즉시:

- [ ] PlanMode 진입 (작업 계획 사용자에게 보여주기)
- [ ] Phase A 의 5 questions AskUserQuestion 로 시작 (A1 작업 디렉토리 / A2 변수 setup / A3 GitLab repo / A4 AWS accounts / A5 analysis 참조). 한 메시지 최대 4 묶기 (AskUserQuestion maxItems) — A1-A4 묶고 A5 별도.
- [ ] 사용자 응답 받으면 Phase B → C → D 진행
- [ ] 각 단계 끝날 때 사용자 승인 게이트
- [ ] 절대 원본 코드 (`../apps/` 등) 읽지 말기

준비됐으면 Phase A 의 첫 질문부터 시작하세요.

---

## 자주 묻는 시나리오

### 시나리오 1 — "원본 source project 를 그대로 다시 만들고 싶어"

원본 사례 자료 (analysis/) 를 가진 사용자가 동일 조직으로 재빌드.
- Phase A Q2: 옵션 1 (wizard) — 원본 조직의 값 (PROJECT_NAME, ORG_*, GITLAB_HOST 등) 을 그대로 입력.
- Phase A Q5: 옵션 1 (analysis/ 함께) — 원본 결정 근거 추적 + 시각/UX/프롬프트 자산 재현 가능.
- 결과: plan placeholder 가 원본 값으로 채워짐 + analysis 가 새 repo 의 `docs/source_analysis/` 로 함께 복사됨.

### 시나리오 2 — "변수만 적용해놓고 빌드는 내일"

Phase A의 Q1 에서 "옵션 2: 새 디렉토리" + Q2 의 wizard 진행. Phase C.1~3 까지만 (commit `docs(plans)` 후 종료). Phase D 는 사용자가 내일 부를 때.

### 시나리오 3 — "이미 진행 중인 프로젝트인데 다음 Phase 만 도와줘"

사용자가 별도로 명령: "Phase 4 Knowledge 부터 진행해줘". 그러면 본 문서의 Phase D 의 해당 phase 만 실행.

### 시나리오 4 — "변수 setup 부터 다시 하고 싶어 (기존 패치 원복)"

```bash
# 사용자 명령으로:
for f in docs/plans/*.md.bak; do mv "$f" "${f%.bak}"; done    # 없으면 OK
git checkout docs/plans/                                       # 변경 원복
# 그 후 다시 build_prompt.md 부터 시작
```

### 시나리오 5 — "Phase 중간에 멈췄는데 이어서"

git log 로 마지막 commit 의 sprint key 확인 → 해당 Phase 의 acceptance test 통과 여부 확인 → 안 됐으면 그 phase 이어서, 됐으면 다음 phase.

---

## 자기 호출 (재실행)

이 build_prompt.md 가 새 repo 의 `docs/plans/build_prompt.md` 에 복사되어 있어야, 추후 사용자가 같은 repo 의 Claude Code 에서 부르면 동일 절차 재실행 가능. 부트스트랩 (Phase C) 끝나면 항상 이 파일이 새 repo 에 있는지 확인.

---

생성: 2026-05-13 · 본 문서 자체도 22개 plan 의 일부.
