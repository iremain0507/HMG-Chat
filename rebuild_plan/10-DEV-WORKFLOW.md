# 10 · Dev Workflow — 커밋/MR/리뷰/CI 규칙

## 브랜치 모델

**병렬 워크트리 (Phase 1+) 의 기본 명명**: 07-AGENT-TEAMS § 병렬 워크트리 의 `<team>/<phase>/<topic>` 패턴이 단일 출처. 본 문서의 `feat/<scope>` 류는 **integration 브랜치 머지 직전 alias** (display 용) — 실 work branch 는 항상 team-prefixed.

```
main                                          ← 항상 deploy 가능 (CI green, tag 가능)
 ├── integration/phase-<N>                    ← 각 Phase 끝 통합 (07 § Merge sequencing). RC 가 main 으로 fast-forward.
 ├── t<N>-<team>/phase-<P>/<topic>           ← 병렬 워크트리 작업 branch (Phase 1+).
 │   예: t1-platform/phase-1/identity-rls
 │       t6-frontend/phase-3/projects-page
 ├── fix/<topic>                              ← 단기 핫픽스 (main 직접, integration 우회 가능)
 ├── docs/<topic>                             ← plan 문서 변경 (rebuild_plan/ 또는 docs/plans/)
 ├── chore/<topic>                            ← 잡일 (의존성/CI 설정)
 └── spike/<topic>                            ← 탐색 (main/integration 머지 금지, L02)
```

- main 외 branch 는 **단명 (1~3일)** 유지. 오래 살면 rebase 충돌.
- **MR target**: 일반 phase work → `integration/phase-<N>` 으로 target. hotfix/docs → `main` 으로 target.
- **sync 순서**: 07 § Merge sequencing 표 — RC 가 통합 후 main fast-forward 유일 권한자.
- **conflict owner**: 07 § Conflict resolution 표 — 영역별 owner 단일.

## 커밋 메시지 규약 (Conventional + 한국어)

```
<type>(<scope>): <subject> [v<X.Y>-S<NN>-<key>]

<body>

<footer>
```

- **type**: `feat | fix | chore | docs | refactor | test | perf | build | ci`
- **scope**: `server | web | shared | infra | knowledge | sandbox | mcp | skills | docs`
- **subject**: 한국어 가능, 50자 이내 명령형 ("추가", "수정")
- **\[v...\]**: sprint key 의무 (L01) — `[v1.0-S04-knowledge]`. 정확한 Phase↔Sprint 매핑은 [08-SPRINT-PLAN.md § Sprint key 매핑](08-SPRINT-PLAN.md) 단일 출처.
- **body**: 한국어 가능, 변경 동기/배경 (선택)
- **footer**: `Closes #N`, `Refs !M`, `BREAKING CHANGE: ...`

### 예시
```
feat(server): artifact share token 발급 [v1.0-S06-artifact-share]

artifact_shares 테이블 + 토큰 발급 service 추가.
122-bit UUID v4, 30일 만료, revoke 가능.

Closes #42
```

`.husky/commit-msg` 가 정규식으로 검증:
```
^(feat|fix|chore|docs|refactor|test|perf|build|ci)(\([a-z-]+\))?: .{1,60} \[v[0-9]+\.[0-9]+-S[0-9]{2}-[a-z-]+\]$
```

## MR (Merge Request) 규약

### MR title
커밋 메시지의 첫 줄과 동일.

### MR description (template 의무)

`.gitlab/merge_request_templates/default.md`:

```markdown
## Context (배경)
> 왜 이 변경이 필요한가? 어떤 문제를 해결하나? (3~5줄)

## Decision (결정)
> 무엇을 어떻게 했는가? 핵심 선택지와 이유. (alternative 도 짧게)

## Validation (검증)
> 어떤 테스트가 추가됐나? 어떻게 검증했나?
> - [ ] Unit test
> - [ ] Integration test
> - [ ] Manual test (스크린샷)

## Migration (마이그레이션, 해당시)
> DB 마이그레이션 / breaking change / 데이터 백필 / 배포 순서

## Notes (참고)
> 후속 작업, 알려진 이슈, related ADR

## Self-review Checklist
- [ ] 새 production 코드에 테스트 추가
- [ ] 새 컬럼은 nullable (또는 NOT NULL 이유 명시) [L03]
- [ ] AbortSignal 처리 (외부 호출 시) [L06]
- [ ] 로그 카테고리/레벨 명시 [L07]
- [ ] 권한 모델 등급 명시 (prompt 변경 시) [L05]
- [ ] 도메인 외 import 없음 [L14]
- [ ] sprint key 포함된 커밋 [L01]
- [ ] PR template 모두 채움
- [ ] Coverage 떨어뜨리지 않음
- [ ] Secrets 노출 없음 (gitleaks 통과)
- [ ] Breaking change 없거나 명시
- [ ] Documentation 업데이트 (변경된 인터페이스)
```

description 본문 < 80자면 머지 불가 (L15).

### 머지 게이트 (2-Tier)

**Tier A — 일반 PR (대부분)**:
- Approval 1 required
- Approver 풀: **CODEOWNERS 의 사람 1 명** (human approver). `agent-reviewer` 는 보조 reviewer (자동 코멘트 + score) — **단독 approver 불가**.
- self-review (PR author 가 자신을 approver 로 지정) **금지** — 반드시 다른 사람.
- 모든 CI job green
- Branch up-to-date with target branch ([build_prompt § Tier A 표](build_prompt.md) 와 단일 출처)
- Resolved threads

**Tier B — Protected paths (계약/DB/공유 패키지)** — Tier A 조건 + 추가:
- `/packages/shared/**`, `/packages/interfaces/**` 변경 → CODEOWNERS 가 요구하는 **7 owner 전체 승인** ([05-REPO-STRUCTURE § CODEOWNERS](05-REPO-STRUCTURE.md) 의 7-owner 라인).
- `/apps/server/src/db/migrations/**`, `/apps/server/src/db/schema.ts` 변경 → `@team-platform` 단독 승인 (다른 도메인 팀의 self-review/agent-reviewer 우회 금지).
- `/apps/server/src/openapi.ts`, `/apps/server/scripts/generate-openapi.ts` 변경 → CODEOWNERS 의 platform + 영향 받는 도메인 팀 승인.

GitLab 의 [Protected Branch + CODEOWNERS approval rule](https://docs.gitlab.com/ee/user/project/codeowners/) 로 강제.

### Approval 방식 (Tier A — build_prompt § LLM agent 권한 표와 단일 출처)

1. **다른 인간 개발자** (필수, single approver)
2. **AI agent-reviewer** — 자동 코멘트 + 점수 (CI 가 수행, **single approver 불가**)
3. **self-approval 금지** — PR author 가 자신을 approver 로 지정 불허.

> **Tier B**: self-review / agent-reviewer 단독 승인 금지 — 반드시 CODEOWNERS section 의 human domain owner 들 (7 명 또는 @team-platform) 모두 승인.

agent-reviewer 의 점수 < 7 이면 자동 머지 차단. 점수 ≥ 7 이라도 human approver 필요 — 차단/허용은 별 layer.

### Spike branch 금지

`spike/*` 브랜치에서 main 으로 MR 만들기 시도 → CI 가 자동 close + 코멘트:
> "spike branch 는 main 으로 머지할 수 없습니다. `docs/spikes/` 에 결과 정리 후 `feat/*` 브랜치로 새 MR 만드세요."

(L02)

## CI 파이프라인 (3-tier)

`.gitlab-ci.yml` 의 실 본문은 [15-CI-PIPELINE.md](15-CI-PIPELINE.md) 단일 출처. 본 표는 stage 의도만:

| Stage | 의도 | 트리거 |
|---|---|---|
| `install` | pnpm install + 캐시 | 모든 pipeline |
| `validate` | lint/typecheck/template/dep | PR + main |
| `test` | unit + integration + migration dry-run | PR + main |
| `integration` | e2e (Playwright) | main + tag |
| `security` | gitleaks + semgrep + trivy + agent-reviewer | PR (gitleaks/semgrep/agent), main (trivy) |
| `publish` | docker build + ECR push + ADR 생성 | main + tag |
| `deploy-staging` | ECS service update (staging) | main |
| `smoke` | health + e2e smoke | main (staging), tag (prod) |
| `deploy-prod` | ECS service update (prod), 수동 승인 | tag `v*` |

rollback 은 별도 stage 가 아닌 `smoke` 실패 시 `scripts/rollback.sh` 호출 (15 참조).

### PR (MR) Pipeline (Stage 1)

| Job | 도구 | Fail policy |
|---|---|---|
| lint | ESLint + Prettier | reject |
| typecheck | tsc --noEmit (all packages) | reject |
| test:unit | vitest unit | reject |
| test:integration | vitest integration + InMemory DB | reject |
| coverage | c8/v8 coverage report | < 임계치 → reject |
| migration-dry-run | drizzle-kit + InMemory DB | reject |
| api-contract-check | server openapi vs web client | reject |
| dependency-coherence | 의존성 중복 버전 검출 (L04) | reject |
| cross-domain-import | 도메인 간 직접 import 검출 (L14) | reject |
| commit-msg-lint | sprint key + format | reject |
| pr-template-lint | description 6섹션 + < 80자 | reject |
| agent-review | AI code review (score 0-10) | < 7 → reject |
| secret-scan | gitleaks | reject |
| sast | semgrep | high → reject |

### main 머지 후 Pipeline (Stage 2)

| Job | 도구 |
|---|---|
| docker-build | buildx, linux/amd64 (server, web, converter-worker) |
| trivy-scan | container CVE 스캔 |
| ecr-push | tag = git sha + branch |
| adr-generate | PR description → docs/decisions/ADR md 생성 (L18) |

### Release Pipeline (tag v*)

| Job | 도구 |
|---|---|
| task-def-register | AWS ECS task definition register |
| ecs-update | service update (deploy) |
| smoke-test | staging 헬스 체크 + 1 e2e 시나리오 |
| auto-rollback | smoke fail 시 이전 task def 으로 복원 |
| release-note | GitLab release 자동 생성 (CHANGELOG entry) |

## 코드 리뷰 가이드

### Reviewer 책임
- 코드 동작이 PR description 의 Decision 과 일치하는지
- 테스트가 충분한지 (happy + edge case)
- L01~L18 어떤 anti-pattern 도입 안 했는지
- 도메인 경계 침범 없는지
- 보안: SQL injection, SSRF, XSS, auth bypass 가능성

### Reviewer 가 코멘트할 때
- 항상 **이유 + 대안** 함께
- "여기 별로네요" 금지 → "이 부분은 X 이유로 Y 가 낫습니다" 형식
- 한국어 권장

### Author 책임
- 모든 코멘트에 응답 (해결 또는 합의 못함)
- "Resolved" 누르기 전에 reviewer 와 한 번 더 확인

## 머지 후 책임

- `main` 으로 머지된 PR 의 author 가 **다음 24시간** 동안 staging 모니터링
- 에러율 spike 또는 smoke fail 시 즉시 revert
- 회고: 매주 금요일 30분 (잘된 점, 잘못된 점, 액션)

## Identity & Auth (커밋 작성자)

- repo 단위 git config 강제 (L08)
- `scripts/setup-git.sh` 가 clone 직후 실행:
  ```bash
  git config user.email "<your>@{{ORG_DOMAIN}}"
  git config user.name "<your name>"
  ```
- `.husky/pre-commit` 가 `*@{{ORG_DOMAIN}}` 도메인 검증

## 핵심 자동화 스크립트 사용

| 작업 | 명령 |
|---|---|
| 환경 셋업 | `pnpm install` |
| AWS SSM 터널 | `pnpm tunnel` |
| 개발 서버 | `pnpm dev` = web:3000 + server:4000 (Node 만). worker 포함하려면 `pnpm dev:full` (web + server + converter-worker:8000). 05 § quickstart 단일 출처. |
| DB 마이그레이션 | `pnpm db:migrate` |
| 테스트 watch | `pnpm test:watch` |
| 타입 체크 | `pnpm typecheck` |
| 린트 | `pnpm lint --fix` |
| 의존성 audit | `pnpm audit:deps` |
| 스킬 lint | `pnpm lint:skills` |
| 도메인 import 체크 | `pnpm check:cross-domain` |
| 로드 테스트 | `pnpm load:100` |

## Daily ritual

각 개발자/팀:
- **아침**: 어제 머지된 PR 목록 + main 변경사항 review (`analysis/CHANGELOG.md` 같은 자동 요약 활용)
- **점심 전**: 작업 중인 PR 의 self-check
- **저녁**: WIP commit + push (다음 날 이어서)

매주 금요일:
- 회고 30분
- 매주 자동 ADR 카드 생성 PR review (doc-keeper 가 만든 것)

## {{PROJECT_NAME}} 자체 운영 (이 plan 의 dogfood)

이 plan 의 `docs/decisions/` 자동 생성 / sprint 명명 강제 / coverage gate 등은 본 plan 의 결과물인 v2 자체가 자기 자신을 빌드할 때부터 적용. 즉:

- v1.0 빌드의 첫 PR (Phase 0) 부터 PR template 사용
- 첫 마이그레이션 (0001) 부터 nullable-first 원칙 적용
- 첫 테스트부터 coverage 게이트

다음: [11-DEPLOYMENT.md](11-DEPLOYMENT.md) 배포 인프라.

---

## 부록 A · Husky hook 본문

### `.husky/pre-commit`
```bash
#!/usr/bin/env bash
set -euo pipefail

# 1. author email 도메인 강제 (L08)
EMAIL=$(git config user.email || echo "")
case "$EMAIL" in
  *@{{ORG_DOMAIN}}|project_*@noreply.{{GITLAB_HOST}})
    ;;
  *)
    echo "❌ commit author email must be @{{ORG_DOMAIN}} or bot account — got: $EMAIL"
    echo "   Fix: git config user.email '<your>@{{ORG_DOMAIN}}'"
    exit 1
    ;;
esac

# 2. lint-staged (포맷팅 + ESLint)
pnpm exec lint-staged --concurrent false

# 3. secret scan (gitleaks)
if command -v gitleaks > /dev/null 2>&1; then
  gitleaks protect --staged --redact --no-banner || {
    echo "❌ potential secrets detected — review and remove"
    exit 1
  }
else
  echo "⚠️  gitleaks not installed; skipping secret scan (recommended: brew install gitleaks)"
fi
```

### `.husky/commit-msg`
```bash
#!/usr/bin/env bash
set -euo pipefail
MSG_FILE="$1"
FIRST=$(head -n1 "$MSG_FILE")

# L01: sprint key 포함 의무
REGEX='^(feat|fix|chore|docs|refactor|test|perf|build|ci)(\([a-z-]+\))?: .{1,60} \[v[0-9]+\.[0-9]+-S[0-9]{2}-[a-z-]+\]$'

if ! echo "$FIRST" | grep -qE "$REGEX"; then
  echo "❌ commit message does not match required pattern."
  echo "   Pattern: <type>(<scope>): <subject> [v<X.Y>-S<NN>-<key>]"
  echo "   Example: feat(server): JWT refresh rotation [v1.0-S01-auth]"
  echo "   Got: $FIRST"
  exit 1
fi
```

### `.husky/pre-push`
```bash
#!/usr/bin/env bash
set -euo pipefail

# 빠른 typecheck (build 안 함)
pnpm typecheck || {
  echo "❌ typecheck failed — fix before pushing"
  exit 1
}
```

## 부록 B · `scripts/setup-git.sh`

```bash
#!/usr/bin/env bash
set -euo pipefail

# 기존 값 보존 가능
CUR_EMAIL=$(git config user.email 2>/dev/null || echo "")
CUR_NAME=$(git config user.name 2>/dev/null || echo "")

read -rp "사내 이메일 입력 (e.g. firstname.lastname@{{ORG_DOMAIN}})${CUR_EMAIL:+ [$CUR_EMAIL]}: " EMAIL
EMAIL=${EMAIL:-$CUR_EMAIL}
case "$EMAIL" in
  *@{{ORG_DOMAIN}}) ;;
  *) echo "❌ 사내 이메일 (@{{ORG_DOMAIN}}) 만 허용"; exit 1 ;;
esac

read -rp "표시명 (e.g. 본명)${CUR_NAME:+ [$CUR_NAME]}: " NAME
NAME=${NAME:-$CUR_NAME}

git config user.email "$EMAIL"
git config user.name "$NAME"

# 자동 fast-forward only
git config pull.ff only
git config rebase.autoStash true

echo "✓ git user.email=$EMAIL  user.name=$NAME"
echo "  husky hooks 활성화: pnpm install (또는 pnpm prepare)"
```

## 부록 C · `scripts/tunnel.sh`

> **사전 조건**: 11-DEPLOYMENT § 부록 E (setup-infra.sh) 가 만든 bastion EC2 와 SSM 파라미터 (`/{{PROJECT_SLUG}}/${ENV}/bastion/instance-id`, `/{{PROJECT_SLUG}}/${ENV}/rds/host`, `/{{PROJECT_SLUG}}/${ENV}/redis/host`) 가 있어야 동작. setup-infra 실행 전엔 InMemory fallback 모드로 dev 가능.

```bash
#!/usr/bin/env bash
set -euo pipefail

# AWS SSM 터널: RDS + Redis
# 필요: aws-cli, session-manager-plugin
# 참고: bastion/SSM 파라미터는 11-DEPLOYMENT § 부록 E setup-infra.sh 가 생성

ENV="${1:-dev}"
PROFILE="${AWS_PROFILE:-{{PROJECT_SLUG}}-${ENV}}"

# RDS 터널 (5432 → localhost:15432)
RDS_HOST=$(aws ssm get-parameter --profile "$PROFILE" \
  --name "/{{PROJECT_SLUG}}/${ENV}/rds/host" --query 'Parameter.Value' --output text)
RDS_BASTION=$(aws ssm get-parameter --profile "$PROFILE" \
  --name "/{{PROJECT_SLUG}}/${ENV}/bastion/instance-id" --query 'Parameter.Value' --output text)

aws ssm start-session --profile "$PROFILE" \
  --target "$RDS_BASTION" \
  --document-name AWS-StartPortForwardingSessionToRemoteHost \
  --parameters "{\"host\":[\"$RDS_HOST\"],\"portNumber\":[\"5432\"],\"localPortNumber\":[\"15432\"]}" &

# Redis 터널 (6379 → localhost:16379)
REDIS_HOST=$(aws ssm get-parameter --profile "$PROFILE" \
  --name "/{{PROJECT_SLUG}}/${ENV}/redis/host" --query 'Parameter.Value' --output text)

aws ssm start-session --profile "$PROFILE" \
  --target "$RDS_BASTION" \
  --document-name AWS-StartPortForwardingSessionToRemoteHost \
  --parameters "{\"host\":[\"$REDIS_HOST\"],\"portNumber\":[\"6379\"],\"localPortNumber\":[\"16379\"]}" &

trap 'kill 0' EXIT
echo "✓ tunnel: postgres@localhost:15432, redis@localhost:16379 (Ctrl+C to stop)"
wait
```
