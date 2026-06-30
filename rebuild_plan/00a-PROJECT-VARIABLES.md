# 00a · Project Variables — 프로젝트별 설정 분리

> 본 plan 은 {{ORG_FULL_NAME_KO}}의 `{{PROJECT_NAME}}` 프로젝트를 사례로 작성됐다. 그러나 같은 plan 을 **다른 조직/다른 프로젝트** 에 적용 가능하도록, 조직 고유 명칭/도메인/리소스 이름은 모두 **변수로 분리** 되어 있다.
>
> 새 프로젝트로 적용하려면:
> 1. 본 문서의 변수 표를 새 값으로 채운다 (또는 `project.config.yaml` 작성)
> 2. `scripts/apply-project-vars.sh` 한 번 실행 → 22개 plan 문서 일괄 치환
> 3. 치환 결과를 새 repo 의 `docs/plans/` 로 commit
> 4. [README.md](README.md) 의 "Day 0 부트스트랩" 명령으로 Claude Code 시작

## 변수 카테고리

다음 9개 카테고리, 약 40개 변수.

> **형식**: plan 본문에 `{{VARIABLE_NAME}}` 형태의 placeholder 가 박혀 있음. 본 표의 "변수" 컬럼이 그 이름. `scripts/apply-project-vars.sh` 가 사용자 입력값으로 일괄 치환.

### A. Project 식별

| 변수 | 의미 | 형식/제약 | 사용자 입력 |
|---|---|---|---|
| `PROJECT_NAME` | 영문 대문자, 마케팅용 표기 | `[A-Z][A-Z0-9-]+` | |
| `PROJECT_SLUG` | 영문 소문자, 디렉토리/ECR/S3/DB prefix | `[a-z][a-z0-9-]+` (자동 유도 가능) | |
| `PROJECT_NAME_PASCAL` | PascalCase (Error 클래스명, CloudWatch namespace) | PROJECT_NAME 첫글자만 대문자 (자동 유도) | |
| `PROJECT_NAME_KO` | 한글 표시명 | 한글 또는 PROJECT_NAME 그대로 OK | |
| `PROJECT_TAGLINE_KO` | 한 줄 정의 (한국어) | 30~80자 | |
| `PROJECT_VERSION_TARGET` | 첫 GA 버전 | `v[0-9]+\.[0-9]+` (default `v1.0`) | |

### B. Organization

| 변수 | 의미 | 형식/제약 | 사용자 입력 |
|---|---|---|---|
| `ORG_NAME` | 영문 조직명 | PascalCase 영문 | |
| `ORG_NAME_LOWER` | 소문자 형태 (도메인/리소스명 패턴) | lowercase(ORG_NAME) (자동 유도) | |
| `ORG_NAME_KO` | 한글 조직명 | 한글 | |
| `ORG_FULL_NAME_KO` | 풀네임 한글 (예: 그룹/Inc/Corp 포함) | 한글 | |
| `ORG_DOMAIN` | 이메일 도메인 | `*.com` / `*.co.kr` / `*.org` 등 | |
| `ORG_USER_PERSONA_KO` | 사용자 호칭 (한국어, 예: ○○인) | 한글 | |
| `ORG_PHILOSOPHY_SHORT` | 회사 철학 요약 (선택, 미사용 가능) | 50자 이내 또는 비움 | |

### C. 저장소 / 코드 호스팅

| 변수 | 의미 | 형식/제약 | 사용자 입력 |
|---|---|---|---|
| `GITLAB_HOST` | GitLab 또는 GitHub 도메인 | `gitlab.<org>.com` 또는 `github.com` | |
| `GITLAB_GROUP` | repo 의 group path | `<group>/<subgroup>` | |
| `GITLAB_PROJECT_PATH` | full path (자동 조합) | `{{GITLAB_HOST}}/{{GITLAB_GROUP}}/{{PROJECT_SLUG}}` | (자동) |

### D. AWS / 인프라

| 변수 | 의미 | 형식/제약 | 사용자 입력 |
|---|---|---|---|
| `AWS_REGION` | 주 region | `[a-z]{2}-[a-z]+-[0-9]` (default `us-east-1`) | |
| `AWS_ACCOUNT_DEV` | dev account ID | 12자리 숫자 | |
| `AWS_ACCOUNT_STAGING` | staging account ID | 12자리 숫자 | |
| `AWS_ACCOUNT_PROD` | prod account ID | 12자리 숫자 | |
| `DB_MASTER_USERNAME` | RDS master user | `[a-z_][a-z0-9_]+` | |
| `INTERNAL_CIDR_DEFAULT` | VPC CIDR | CIDR (default `10.0.0.0/16`) | |
| `MCP_ALLOWED_INTERNAL_CIDRS` | MCP 서버 화이트리스트 CIDR | CIDR list, 보통 `INTERNAL_CIDR_DEFAULT` 와 같음 | |

### E. 도메인 (URL)

| 변수 | 의미 | 형식/제약 | 사용자 입력 |
|---|---|---|---|
| `APP_DOMAIN_PROD` | 운영 도메인 | `app.<org>.com` | |
| `APP_DOMAIN_STAGING` | 베타 도메인 | `app-staging.<org>.com` | |
| `APP_DOMAIN_DEV` | 개발 도메인 | `app-dev.<org>.com` | |

### F. 알림 채널

| 변수 | 의미 | 형식/제약 | 사용자 입력 |
|---|---|---|---|
| `ALERT_SLACK_CHANNEL` | 알림 채널 | `#<channel>` | |
| `RELEASE_SLACK_CHANNEL` | 릴리스 알림 | `#<channel>` | |

### G. 브랜드 기능명

| 변수 | 의미 | 형식/제약 | 사용자 입력 |
|---|---|---|---|
| `BRAND_PPTX_SKILL_NAME` | 브랜드 PPT 스킬 이름 | `<org>-pptx` 패턴 | |
| `SANDBOX_TEMPLATE_ID` | E2B 템플릿 ID | `<project>-default-v1` 패턴 | |

### H. LLM / AI 모델 (default 가 합리적, 수정 시만)

| 변수 | 의미 | default | 사용자 입력 (변경 시) |
|---|---|---|---|
| `PRIMARY_LLM_PROVIDER` | 주 LLM | `anthropic` | |
| `PRIMARY_LLM_MODEL_OPUS` | 강력 모델 | `claude-opus-4-7` | |
| `PRIMARY_LLM_MODEL_SONNET` | 균형 모델 | `claude-sonnet-4-6` | |
| `PRIMARY_LLM_MODEL_HAIKU` | 빠른 모델 | `claude-haiku-4-5` | |
| `EMBEDDING_PROVIDER` | 임베딩 | `voyage` | |
| `EMBEDDING_MODEL` | 임베딩 모델 | `voyage-multilingual-2` | |
| `EMBEDDING_DIM` | 임베딩 차원 | `1024` | |
| `WEB_SEARCH_PROVIDER` | 웹 검색 | `tavily` | |
| `IMAGE_CAPTION_PROVIDER` | 이미지 캡션 | `gemini` | |
| `SANDBOX_PROVIDER` | 샌드박스 | `e2b` | |
| `FALLBACK_LLM_PROVIDERS` | 보조 LLM | `openai,gemini` | |

### I. 운영 정책 기본값 (default 가 합리적, 수정 시만)

| 변수 | 의미 | default | 사용자 입력 (변경 시) |
|---|---|---|---|
| `MESSAGE_RETENTION_DAYS` | 메시지 보존 (일) | `90` | |
| `ARTIFACT_RETENTION_DAYS` | 아티팩트 보존 (일) | `90` | |
| `UPLOAD_RETENTION_DAYS` | 업로드 파일 보존 (일) | `30` | |
| `SHARE_DEFAULT_TTL_DAYS` | 공유 링크 기본 TTL (일) | `30` | |
| `SHARE_MAX_TTL_DAYS` | 공유 링크 최대 TTL (일) | `90` | |
| `DEFAULT_USER_BUDGET_TOKENS` | 사용자 기본 월 토큰 | `100000` | |
| `JWT_ACCESS_TTL_SECONDS` | access 토큰 TTL (초) | `900` (15분) | |
| `JWT_REFRESH_TTL_SECONDS` | refresh 토큰 TTL (초) | `2592000` (30일) | |
| `RATE_LIMIT_GLOBAL_MAX` | 분당 요청 | `120` | |

---

## 변수 적용 절차 (3가지 방법)

### 방법 1: 인터랙티브 wizard (Claude Code 에게)

Claude Code 에 다음 명령:

```
새 프로젝트를 위해 본 plan 의 변수를 새 값으로 교체해줘.

1. 00a-PROJECT-VARIABLES.md 의 9개 카테고리 변수 표를 차례로 보여주고,
   AskUserQuestion 으로 각 카테고리의 새 값을 받아.
   - 같은 카테고리 안의 변수들은 자동 유도 가능한 것은 추론 (예: PROJECT_NAME=ACME → PROJECT_SLUG=acme, GITLAB_PROJECT_PATH 자동 조합 등)
2. 모든 응답 받으면 project.config.yaml 작성
3. scripts/apply-project-vars.sh 실행 결과 미리보기 (diff)
4. 내 승인 후 22개 .md 일괄 치환
```

### 방법 2: `project.config.yaml` 직접 편집 후 스크립트

```bash
cp project.config.example.yaml project.config.yaml
$EDITOR project.config.yaml      # 위 변수 표를 yaml 로 채움
bash scripts/apply-project-vars.sh project.config.yaml
```

### 방법 3: 환경변수 export 후 스크립트

```bash
export PROJECT_NAME="<YOUR_PROJECT_NAME>" \
       PROJECT_SLUG="<your-project-slug>" \
       ORG_NAME="<YourOrg>" \
       ORG_NAME_LOWER="<your-org>" \
       ORG_NAME_KO="<한글 조직명>" \
       ORG_FULL_NAME_KO="<한글 풀네임>" \
       ORG_DOMAIN="<your-org>.com" \
       ORG_USER_PERSONA_KO="<사용자 호칭>" \
       GITLAB_HOST="gitlab.<your-org>.com" \
       GITLAB_GROUP="<group>/<subgroup>" \
       AWS_REGION="us-east-1" \
       DB_MASTER_USERNAME="<db_admin>" \
       APP_DOMAIN_PROD="<app>.<your-org>.com" \
       APP_DOMAIN_STAGING="<app>-staging.<your-org>.com" \
       APP_DOMAIN_DEV="<app>-dev.<your-org>.com" \
       ALERT_SLACK_CHANNEL='#<channel>' \
       RELEASE_SLACK_CHANNEL='#<channel>' \
       BRAND_PPTX_SKILL_NAME="<your-org>-pptx" \
       SANDBOX_TEMPLATE_ID="<your-project-slug>-default-v1" \
       PROJECT_TAGLINE_KO="<한 줄 정의>"

bash scripts/apply-project-vars.sh
```

스크립트가 필수 변수 누락 시 fail 하며 누락 목록 표시. LLM/policy 카테고리는 default 가 합리적 — 변경 시만 명시적 export.

## 치환 스크립트 (`scripts/apply-project-vars.sh`)

스크립트의 실제 본문은 **[scripts/apply-project-vars.sh](scripts/apply-project-vars.sh) 단일 출처** 다. 본 문서가 그것을 다시 옮겨 적지 않는다 (drift 방지).

실행:
```bash
bash rebuild_plan/scripts/apply-project-vars.sh [project.config.yaml]
```

수행하는 변환:
1. `rebuild_plan/*.md` 백업 (`.bak`)
2. perl 로 word-boundary 안전 치환 (긴 토큰 먼저 → 짧은 토큰)
3. 결과 요약 + 잔존 hardcoded token 검사

치환 규칙은 다음 5 그룹:
- **한국어 토큰** (`{{ORG_FULL_NAME_KO}}`, `{{ORG_USER_PERSONA_KO}}`, `{{ORG_NAME_KO}}`) — 긴 것 먼저, `\Q\E` 정확 매칭
- **도메인** (`{{GITLAB_HOST}}`, `{{PROJECT_SLUG}}-{prod,staging,dev}.{{ORG_DOMAIN}}`, `{{ORG_DOMAIN}}`)
- **placeholder 형식** (`{{PROJECT_NAME}}`, `{{PROJECT_SLUG}}`, `{{ORG_NAME}}`, `{{ORG_NAME_LOWER}}` 등) — 정확 매칭, 토큰 단위
- **underscored 변종** (`{{PROJECT_SLUG}}_dev`, `{{PROJECT_SLUG}}_at`, `{{PROJECT_SLUG}}_rt` 등)
- **PascalCase 변종** (`{{PROJECT_NAME_PASCAL}}Error`, `` `{{PROJECT_NAME_PASCAL}}` ``, `"{{PROJECT_NAME_PASCAL}}"`)

> ⚠️ plan 본문은 모두 placeholder. 코드 식별자 (예: `mcp-bridge.ts`, `HitlBridge`) 는 영문 generic 명이라 변환 대상 아님 — 모든 조직에서 동일 사용.

자세한 규칙/구현은 스크립트 본문 직접 참조.

## `project.config.example.yaml`

위 변수 표 그대로 yaml 형식. `scripts/apply-project-vars.sh` 가 yq 로 파싱.

```yaml
# 본 파일을 project.config.yaml 로 복사 후 채우세요.

project:
  name: "{{PROJECT_NAME}}"
  slug: "{{PROJECT_SLUG}}"
  name_ko: "{{PROJECT_NAME}}"
  tagline_ko: "사내 멀티테넌트 AI 에이전트 인프라 플랫폼"
  version_target: "v1.0"

org:
  name: "{{ORG_NAME}}"
  name_lower: "{{ORG_NAME_LOWER}}"
  name_ko: "{{ORG_NAME_KO}}"
  full_name_ko: "{{ORG_FULL_NAME_KO}}"
  domain: "{{ORG_DOMAIN}}"
  user_persona_ko: "{{ORG_USER_PERSONA_KO}}"
  philosophy_short: "2G — Growth of People, Growth of Business"

gitlab:
  host: "{{GITLAB_HOST}}"
  group: "{{GITLAB_GROUP}}"

aws:
  region: "{{AWS_REGION}}"
  account_dev: ""            # 채우세요
  account_staging: ""
  account_prod: ""
  db_master_username: "{{DB_MASTER_USERNAME}}"
  internal_cidr_default: "{{INTERNAL_CIDR_DEFAULT}}"

domain:
  app_prod: "{{APP_DOMAIN_PROD}}"
  app_staging: "{{APP_DOMAIN_STAGING}}"
  app_dev: "{{APP_DOMAIN_DEV}}"

alerts:
  slack_channel: "{{ALERT_SLACK_CHANNEL}}"
  release_channel: "{{RELEASE_SLACK_CHANNEL}}"

brand:
  pptx_skill_name: "{{BRAND_PPTX_SKILL_NAME}}"
  sandbox_template_id: "{{SANDBOX_TEMPLATE_ID}}"

llm:
  primary_provider: "anthropic"
  primary_model_opus: "claude-opus-4-7"
  primary_model_sonnet: "claude-sonnet-4-6"
  primary_model_haiku: "claude-haiku-4-5"
  embedding_provider: "voyage"
  embedding_model: "voyage-multilingual-2"
  embedding_dim: 1024
  web_search_provider: "tavily"
  image_caption_provider: "gemini"
  sandbox_provider: "e2b"
  fallback_providers: ["openai", "gemini"]

policy:
  message_retention_days: 90
  artifact_retention_days: 90
  upload_retention_days: 30
  share_default_ttl_days: 30
  share_max_ttl_days: 90
  default_user_budget_tokens: 100000
  jwt_access_ttl_seconds: 900
  jwt_refresh_ttl_seconds: 2592000
  rate_limit_global_max: 120
```

## 채워야 하는 변수 (필수 vs 선택)

### 필수 (이게 비면 안 됨)
- `PROJECT_NAME`, `PROJECT_SLUG`, `PROJECT_NAME_KO`
- `ORG_NAME`, `ORG_NAME_LOWER`, `ORG_NAME_KO`, `ORG_DOMAIN`
- `GITLAB_HOST`, `GITLAB_GROUP`
- `AWS_REGION`, `AWS_ACCOUNT_DEV/STAGING/PROD`
- `APP_DOMAIN_PROD/STAGING/DEV`

### 선택 (기본값 유지 가능)
- 모델 ID (LLM 카테고리) — 보통 그대로
- 정책 기본값 (I 카테고리) — 보통 그대로
- 알림 채널 / 브랜드 스킬명 — 추후 변경 가능

## 변수가 안 다뤄지는 부분 — 코드 디렉토리 이름

`apps/server`, `apps/web`, `apps/converter-worker`, `packages/shared`, `packages/interfaces`, `skills/`, `infra/aws/` 등 코드 디렉토리 이름은 본 plan 에서 **고정 (변경 안 함)**. 회사가 달라도 이 monorepo 구조는 동일하게 사용한다고 가정.

만약 `apps/` 대신 `services/` 같은 명명을 원하면 별도 정책 결정 — 본 plan 의 가정 밖.

## 변수 적용 후 검증

치환이 잘 됐는지 빠르게 확인 — `apply-project-vars.sh` 가 이미 자동 검사하지만, 수동 spot-check 시:

```bash
# 1. 남은 {{...}} placeholder 검사 (있으면 변수 누락)
grep -nE '\{\{[A-Z_]+\}\}' rebuild_plan/*.md \
  | grep -v '\.bak' \
  | grep -vE '00a-PROJECT-VARIABLES|README|/scripts/' \
  | head

# 2. 핵심 식별자가 새 값으로 치환됐는지 (출현 횟수 확인)
for var in PROJECT_NAME PROJECT_SLUG ORG_NAME ORG_NAME_KO; do
  raw="{{${var}}}"
  count=$(grep -F -c "$raw" rebuild_plan/*.md 2>/dev/null | awk -F: '{s+=$2} END{print s+0}')
  echo "$raw → $count occurrences (0 = 모두 치환됨)"
done

# 3. 깨진 cross-reference 검사 (참조된 파일이 실재하는지)
grep -hoE '\]\(([0-9a-zA-Z_-]+\.md)' rebuild_plan/*.md \
  | sed 's/^](//;s/)$//' | sort -u \
  | while read -r f; do [ -f "rebuild_plan/$f" ] || echo "MISSING: $f"; done
```

위 1번에서 남은 token 이 있으면 — 본 변수 표에 없는 새 hardcoded 가 발견된 것. 보통은 0.

## 자주 묻는 질문

**Q: GitLab 이 아니라 GitHub 를 쓴다면?**
A: `GITLAB_HOST=github.com`, `GITLAB_GROUP=<your-org>` 으로 채우면 됨. 하지만 plan 본문의 일부 (CI yaml 의 GitLab 전용 변수: `CI_MERGE_REQUEST_DESCRIPTION` 등) 는 GitHub Actions 형식으로 별도 patch 필요. [15-CI-PIPELINE.md] 의 변수 매핑 참조.

**Q: 사내 LLM (예: 자체 GPT)을 우선 쓰고 싶다면?**
A: `PRIMARY_LLM_PROVIDER` 와 `PRIMARY_LLM_MODEL_*` 값만 바꾸면 됨. 그러나 `LLMProvider` 인터페이스 ([14-INTERFACES.md § 6]) 의 새 구현체 작성 필요.

**Q: 한국어가 아닌 영어 본문이 필요하다면?**
A: 본 plan 자체는 한국어 — 영어 본문은 별도 번역 필요. 변수 (`ORG_USER_PERSONA_KO` 등) 의 `_KO` 접미사는 한국어 전용.

**Q: 변수 추가가 더 필요하면?**
A: 본 문서 (00a) 의 변수 표에 추가 + `scripts/apply-project-vars.sh` 에 sed 규칙 추가 + 영향 받는 plan 문서들 식별. PR 으로 본 plan 에 기여 가능.
