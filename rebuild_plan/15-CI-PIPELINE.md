# 15 · CI Pipeline — `.gitlab-ci.yml` 실 본문

> v2 는 사내 GitLab CI 사용 (L13 의 `.github/workflows/ci.yml` 참조는 원본 환경 흔적, v2 는 GitLab CI 로 통일).
> 본 문서가 단일 출처. 10-DEV-WORKFLOW.md 의 pipeline 표는 본 문서의 요약.

## `.gitlab-ci.yml` 골격

> ⚠️ **default 의 before_script 는 의도적으로 비워둠** — docker/trivy/semgrep/gitleaks/aws-cli 같은 다른 이미지 job 이 corepack 없는 환경에서 실패하지 않도록. Node 기반 job 은 `extends: .pnpm-base` 로 명시 상속.

```yaml
default:
  image: node:22-bookworm

# Node 기반 job 의 공통 셋업 — extends: .pnpm-base 로 상속
.pnpm-base:
  image: node:22-bookworm
  before_script:
    - corepack enable
    - corepack prepare pnpm@10.29.3 --activate
  cache:
    key: $CI_COMMIT_REF_SLUG
    paths:
      - .pnpm-store
      - node_modules
      - apps/*/node_modules
      - packages/*/node_modules

variables:
  PNPM_HOME: "$CI_PROJECT_DIR/.pnpm-store"
  CI: "true"
  NODE_ENV: "test"

stages:
  - install
  - validate
  - test
  - integration
  - security              # gitleaks / semgrep / agent-review (publish 전)
  - publish               # docker-build / generate-adr
  - container-scan        # trivy (publish 후, image 필요)
  - deploy-staging
  - smoke-staging
  - deploy-prod
  - smoke-prod            # deploy-prod 후

workflow:
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
    - if: $CI_COMMIT_BRANCH == "main"
    - if: $CI_COMMIT_BRANCH =~ /^integration\/phase-(0\.5|\d+)$/   # 07-AGENT-TEAMS § 병렬 워크트리 의 통합 브랜치
    - if: $CI_COMMIT_TAG =~ /^v\d+\.\d+\.\d+$/

# ─────────── install ───────────
install:
  stage: install
  extends: .pnpm-base
  script:
    - pnpm install --frozen-lockfile
  artifacts:
    paths: [node_modules, apps/*/node_modules, packages/*/node_modules]
    expire_in: 1h

# ─────────── validate (PR + main) ───────────
lint:
  stage: validate
  needs: [install]
  extends: .pnpm-base
  script: [pnpm lint]

typecheck:
  stage: validate
  needs: [install]
  extends: .pnpm-base
  script: [pnpm typecheck]

commit-msg-lint:
  stage: validate
  needs: [install]
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
  extends: .pnpm-base
  script:
    # integration/phase-* target MR 에서는 main 부터의 diff 가 다른 팀 commit 까지 잡음 → MR 자체 diff base 사용.
    - node scripts/check-commit-msgs.mjs "${CI_MERGE_REQUEST_DIFF_BASE_SHA:-origin/main}..HEAD"

pr-template-lint:
  stage: validate
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
  extends: .pnpm-base
  script:
    - node scripts/check-mr-description.mjs

dependency-coherence:
  stage: validate
  needs: [install]
  extends: .pnpm-base
  script:
    - node scripts/audit-deps.mjs

cross-domain-import:
  stage: validate
  needs: [install]
  extends: .pnpm-base
  script:
    - node scripts/check-cross-domain-imports.mjs

owned-paths:
  # 병렬 워크트리의 brach prefix (t1-platform/, t2-orchestrator/, ...) 와 변경 파일을 비교 → forbidden_paths 침범 차단.
  # MR target 이 integration/phase-* 또는 main 일 때만 실행. Phase 0.5 owner (integration RC) 의 PR 은 예외 처리 (branch=integration/phase-0.5).
  stage: validate
  needs: [install]
  extends: .pnpm-base
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
  script:
    # CI_MERGE_REQUEST_SOURCE_BRANCH_NAME 로 team prefix 추출, CI_MERGE_REQUEST_DIFF_BASE_SHA..HEAD 변경 파일 검사.
    - node scripts/check-owned-paths.mjs

skill-lint:
  stage: validate
  needs: [install]
  extends: .pnpm-base
  script:
    - node scripts/lint-skills.mjs

# plan 자체 self-validation — plan 디렉토리가 어디 있든 자동 감지 (원본 rebuild_plan/ 또는 새 repo 의 docs/plans/).
# 외부 LLM 검토가 잡기 전에 YAML/bash/cross-ref/envelope/DDL-Interface-API drift 를 자동 검출.
plan-lint:
  stage: validate
  needs: [install]
  image: python:3.12-slim
  before_script:
    - pip install --quiet pyyaml
    - apt-get update -qq && apt-get install -y --no-install-recommends bash grep gawk sed > /dev/null
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
      changes:
        - rebuild_plan/**/*
        - docs/plans/**/*
    - if: $CI_COMMIT_BRANCH == "main"
      changes:
        - rebuild_plan/**/*
        - docs/plans/**/*
  script:
    # plan 위치 자동 감지
    - |
      if [ -f rebuild_plan/scripts/lint-plan.sh ]; then
        bash rebuild_plan/scripts/lint-plan.sh
      elif [ -f docs/plans/scripts/lint-plan.sh ]; then
        bash docs/plans/scripts/lint-plan.sh
      else
        echo "❌ lint-plan.sh 를 rebuild_plan/scripts/ 또는 docs/plans/scripts/ 에서 못 찾음"
        exit 1
      fi

api-contract-check:
  stage: validate
  needs: [install]
  extends: .pnpm-base
  # Phase 0.5 (Contract Bootstrap PR) 머지 후부터 활성. GitLab 의 exists: 는 OR 시맨틱이라
  # 두 파일 중 하나만 존재해도 rule 매칭 → script 첫 줄에서 AND 검증으로 보완 (둘 다 없으면 명시 skip).
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
      exists:
        - apps/server/src/openapi.ts                       # Phase 0.5 산출물
    - if: $CI_COMMIT_BRANCH == "main"
      exists:
        - apps/server/src/openapi.ts
  variables:
    # openapi:generate 는 loadEnv() 가 시작 시 Zod 로 env 를 검증함.
    # contract 추출만이 목적이라 실 secret 불요 — placeholder 값으로 통과.
    DATABASE_URL: "postgres://dummy:dummy@localhost:5432/dummy"
    REDIS_URL: "redis://localhost:6379"
    JWT_SECRET: "ci-dummy-jwt-secret-min-32-chars-not-used-at-runtime"
    ALLOWED_DOMAINS: "{{ORG_DOMAIN}}"
    EMAIL_SENDER_KIND: "console"
    NODE_ENV: "test"
  script:
    # AND 검증: openapi.ts (Phase 0 stub) 와 api-types.generated.ts (Phase 0.5) 둘 다 있어야 의미 있음.
    # Phase 0 에선 stub 만 있고 generated types 없음 → skip (exit 0).
    - |
      if [ ! -f apps/web/src/lib/api-types.generated.ts ]; then
        echo "[api-contract-check] api-types.generated.ts 미존재 → Phase 0.5 머지 전 — skip"
        exit 0
      fi
    - pnpm --filter @{{PROJECT_SLUG}}/server openapi:generate
    - pnpm --filter @{{PROJECT_SLUG}}/web api-types:generate
    - git diff --exit-code apps/web/src/lib/api-types.generated.ts

# ─────────── test (PR + main) ───────────
test-unit:
  stage: test
  needs: [install]
  extends: .pnpm-base
  script:
    - pnpm --filter "./packages/*" test
    - pnpm --filter @{{PROJECT_SLUG}}/shared test
  artifacts:
    when: always
    paths:
      - packages/shared/coverage/cobertura-coverage.xml  # coverage-gate 가 소비
    reports:
      junit: packages/**/junit.xml
      coverage_report:
        coverage_format: cobertura
        path: packages/shared/coverage/cobertura-coverage.xml

# test-server-unit 은 아래 strict / red-allowed 두 variant 로 분리되어 있음 (red-test-allowed 라벨 처리).

test-web-unit:
  stage: test
  needs: [install]
  extends: .pnpm-base
  script: ["pnpm --filter @{{PROJECT_SLUG}}/web test:unit"]
  artifacts:
    when: always
    paths:
      - apps/web/coverage/cobertura-coverage.xml
    reports:
      junit: apps/web/junit.xml
      coverage_report:
        coverage_format: cobertura
        path: apps/web/coverage/cobertura-coverage.xml

# red-test-allowed 라벨 — TDD 의 RED 단계 PR 머지 허용 (09-TDD-GUIDE § A.1)
# MR 에 라벨 'red-test-allowed' 가 있으면 test 실패 시에도 머지 가능 (allow_failure).
.test-server-unit-base: &test-server-unit-base
  stage: test
  needs: [install]
  extends: .pnpm-base
  script: ["pnpm --filter @{{PROJECT_SLUG}}/server test:unit"]

test-server-unit-strict:
  <<: *test-server-unit-base
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event" && $CI_MERGE_REQUEST_LABELS !~ /red-test-allowed/
    - if: $CI_COMMIT_BRANCH == "main"
  artifacts:
    when: always
    paths:
      - apps/server/coverage/cobertura-coverage.xml      # coverage-gate 가 소비
    reports:
      junit: apps/server/junit.xml
      coverage_report:
        coverage_format: cobertura
        path: apps/server/coverage/cobertura-coverage.xml

test-server-unit-red-allowed:
  <<: *test-server-unit-base
  rules:
    # red-test-allowed 는 feature branch (`t<N>-...`) 대상의 MR 만 허용.
    # integration/phase-* 또는 main target MR 은 RED 우회 금지 → 통과 못 하면 즉시 실패.
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
        && $CI_MERGE_REQUEST_LABELS =~ /red-test-allowed/
        && $CI_MERGE_REQUEST_TARGET_BRANCH_NAME !~ /^(main|integration\/phase-)/
  allow_failure: true                    # RED PR 머지 허용 (feature → feature 한정)

test-server-integration:
  stage: test
  needs: [install]
  extends: .pnpm-base
  services:
    - name: pgvector/pgvector:pg16
      alias: postgres
      variables:
        POSTGRES_PASSWORD: testpass
        POSTGRES_DB: "{{PROJECT_SLUG}}_test"        # quoted — `{{` 가 YAML flow mapping 시작과 충돌하지 않게.
    - name: redis:7-alpine
      alias: redis
  variables:
    DATABASE_URL: "postgres://postgres:testpass@postgres:5432/{{PROJECT_SLUG}}_test"
    REDIS_URL: "redis://redis:6379"
  script:
    - pnpm --filter @{{PROJECT_SLUG}}/server db:migrate
    - pnpm --filter @{{PROJECT_SLUG}}/server test:integration

coverage-gate:
  stage: test
  extends: .pnpm-base
  # RED PR (red-test-allowed 라벨) 인 경우 server test 가 fail → cobertura 미생성 → coverage-gate fail.
  # 09-TDD-GUIDE 의 RED PR 정책과 충돌 회피: 라벨 있으면 coverage-gate 도 skip (다음 GREEN PR 에서 강제).
  rules:
    - if: $CI_MERGE_REQUEST_LABELS =~ /red-test-allowed/
      when: never
    - when: on_success
  needs:
    - job: test-server-unit-strict
      optional: true
      artifacts: true
    - job: test-web-unit
      artifacts: true                  # apps/web/coverage/cobertura-coverage.xml
    - job: test-unit
      artifacts: true                  # packages/shared/coverage/cobertura-coverage.xml
  script:
    - node scripts/coverage-gate.mjs --server-min 80 --web-min 60 --shared-min 90

test-without-prod-code:
  stage: test
  needs: [install]
  extends: .pnpm-base
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
  script:
    - node scripts/check-tests-with-prod.mjs "${CI_MERGE_REQUEST_DIFF_BASE_SHA:-origin/main}..HEAD"

migration-dry-run:
  stage: test
  needs: [install]
  extends: .pnpm-base
  services:
    - name: pgvector/pgvector:pg16
      alias: postgres
      variables:
        POSTGRES_PASSWORD: testpass
        POSTGRES_DB: "{{PROJECT_SLUG}}_test"
  variables:
    DATABASE_URL: "postgres://postgres:testpass@postgres:5432/{{PROJECT_SLUG}}_test"
  script:
    - pnpm --filter @{{PROJECT_SLUG}}/server db:migrate
    - pnpm --filter @{{PROJECT_SLUG}}/server db:migrate:status
    # 다시 같은 마이그레이션 적용 — idempotent 검증
    - pnpm --filter @{{PROJECT_SLUG}}/server db:migrate

# ─────────── integration (main + tag) ───────────
# e2e job 은 Phase 0 시점엔 산출물이 없어 자동 skip — Phase 1+ 에서 playwright.config.ts / e2e/*.spec.ts /
# wait-on / @playwright/test 가 추가되면 자동 enable. 'rules' 의 exists 가 본 gate 역할.
e2e:
  stage: integration
  extends: .pnpm-base
  rules:
    # Phase 0 = exists 가 false → skip. Phase 1+ 의 첫 e2e PR 부터 자동 trigger.
    - if: $CI_COMMIT_BRANCH == "main"
      exists: [playwright.config.ts, e2e/**/*.spec.ts]
    - if: $CI_COMMIT_BRANCH =~ /^integration\/phase-(0\.5|\d+)$/
      exists: [playwright.config.ts, e2e/**/*.spec.ts]
    - if: $CI_COMMIT_TAG
      exists: [playwright.config.ts, e2e/**/*.spec.ts]
  services:
    - name: pgvector/pgvector:pg16
      alias: postgres
      variables:
        POSTGRES_PASSWORD: testpass             # service container 의 superuser 비밀번호 — DATABASE_URL 과 sync
        POSTGRES_DB: "{{PROJECT_SLUG}}_test"
    - name: redis:7-alpine
      alias: redis
  variables:
    DATABASE_URL: "postgres://postgres:testpass@postgres:5432/{{PROJECT_SLUG}}_test"
    REDIS_URL: "redis://redis:6379"
    # server env.ts (Zod) 가 필수로 검증하는 키들 — env validation 통과 의무.
    JWT_SECRET: "ci-test-jwt-secret-min-32-chars-required-xxx"
    ALLOWED_DOMAINS: "{{ORG_DOMAIN}}"
    EMAIL_SENDER_KIND: "console"
    NODE_ENV: "test"
    NEXT_PUBLIC_API_BASE: "http://localhost:4000/api/v1"
  script:
    - pnpm --filter @{{PROJECT_SLUG}}/server build
    - pnpm --filter @{{PROJECT_SLUG}}/web build
    - pnpm --filter @{{PROJECT_SLUG}}/server db:migrate    # e2e 는 fresh DB 에 schema 적용 후 시작
    - pnpm --filter @{{PROJECT_SLUG}}/server db:seed       # smoke 계정 (smoke-test@{{ORG_DOMAIN}})
    - pnpm --filter @{{PROJECT_SLUG}}/server start &
    - pnpm --filter @{{PROJECT_SLUG}}/web start &
    - npx wait-on http://localhost:3000 http://localhost:4000/health
    - pnpm e2e:run

# > **Phase 0 의 e2e/integration test 정책 (반복 질문 차단)**:
# > - Phase 0 끝 시점엔 hello.test.ts 외 e2e/integration 본문이 없음 — 정상.
# > - test:integration 은 `vitest run --dir src/__tests__/integration` 인데 디렉토리가 비어있으면 vitest 가 자동 0 exit (no-tests 경고만). `--passWithNoTests` 명시는 redundant 이나 안전.
# > - e2e job 은 위 `exists:` rules 로 Phase 0 시점 자동 skip. Phase 1 의 첫 e2e spec PR 부터 자동 enable.

# ─────────── security ───────────
secret-scan:
  stage: security
  image: zricethezav/gitleaks:latest
  script:
    - gitleaks detect --source . --redact --no-banner --exit-code 1

sast:
  stage: security
  image: returntocorp/semgrep:latest
  script:
    - semgrep --config p/owasp-top-ten --config p/typescript --error

container-scan:
  stage: container-scan
  needs: [docker-build]
  rules:
    - if: $CI_COMMIT_BRANCH == "main"
    - if: $CI_COMMIT_TAG
  image:
    name: aquasec/trivy:latest
    entrypoint: [""]
  script:
    - trivy image --exit-code 1 --severity HIGH,CRITICAL $ECR_REGISTRY/{{PROJECT_SLUG}}-server:$CI_COMMIT_SHA

agent-review:
  stage: security
  extends: .pnpm-base
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
  script:
    - node scripts/agent-reviewer.mjs > review.md
    - node scripts/agent-reviewer-score.mjs review.md  # exit code 1 if score < 7
    - >
      curl -X POST "$CI_API_V4_URL/projects/$CI_PROJECT_ID/merge_requests/$CI_MERGE_REQUEST_IID/notes"
      -H "PRIVATE-TOKEN: $GITLAB_BOT_TOKEN"
      --data-urlencode "body=$(cat review.md)"

# ─────────── publish (main only) ───────────
docker-build:
  stage: publish
  rules:
    - if: $CI_COMMIT_BRANCH == "main"
    - if: $CI_COMMIT_TAG
  image: docker:24
  services: ["docker:24-dind"]   # quoted — flow sequence 안 plain scalar 의 ':' 가 일부 YAML parser (Ruby Psych 등) 에서 syntax error 위험. python yaml 은 통과하지만 GitLab CI runner 호환 위해 quote.
  before_script:
    - apk add --no-cache aws-cli
    # env 별 ECR 분리: tag pipeline (v1.x.y) 은 prod ECR, 그 외 (main push) 는 staging ECR.
    # ECR_REGISTRY 변수가 env 에 따라 다른 account 를 가리키도록.
    - |
      if [ -n "$CI_COMMIT_TAG" ]; then
        # prod tag pipeline
        export ECR_REGISTRY="$ECR_REGISTRY_PROD"
        export AWS_ACCESS_KEY_ID="$AWS_ACCESS_KEY_ID_PROD"
        export AWS_SECRET_ACCESS_KEY="$AWS_SECRET_ACCESS_KEY_PROD"
        export AWS_PROFILE_TARGET="ci-prod"
      else
        # main branch — staging
        export ECR_REGISTRY="$ECR_REGISTRY_STAGING"
        export AWS_ACCESS_KEY_ID="$AWS_ACCESS_KEY_ID_STAGING"
        export AWS_SECRET_ACCESS_KEY="$AWS_SECRET_ACCESS_KEY_STAGING"
        export AWS_PROFILE_TARGET="ci-staging"
      fi
      mkdir -p ~/.aws
      cat > ~/.aws/credentials <<EOF
      [default]
      aws_access_key_id=$AWS_ACCESS_KEY_ID
      aws_secret_access_key=$AWS_SECRET_ACCESS_KEY
      EOF
    - |
      for REPO in {{PROJECT_SLUG}}-server {{PROJECT_SLUG}}-web {{PROJECT_SLUG}}-converter-worker; do
        aws ecr describe-repositories --repository-names "$REPO" --region "$AWS_REGION" > /dev/null 2>&1 || \
          aws ecr create-repository --repository-name "$REPO" --region "$AWS_REGION" \
            --image-scanning-configuration scanOnPush=true \
            --image-tag-mutability IMMUTABLE > /dev/null
      done
  script:
    - aws ecr get-login-password --region $AWS_REGION | docker login --username AWS --password-stdin $ECR_REGISTRY
    - docker buildx create --use --platform linux/amd64
    # tag 정책: ECR IMMUTABLE 이므로 동일 tag 두 번 push 금지.
    #   - $CI_COMMIT_SHA: 항상 unique (git sha) — 첫 push 만 성공.
    #   - $CI_COMMIT_TAG (v1.x.y): tag pipeline 에서만 추가 push (web/worker 도 동일 tag 발행).
    #   - $CI_COMMIT_REF_SLUG 는 main 에서 매번 같은 값 → IMMUTABLE 충돌 → 사용 안 함.
    - |
      EXTRA_TAGS=""
      if [ -n "$CI_COMMIT_TAG" ]; then EXTRA_TAGS="-t $ECR_REGISTRY/IMAGE:$CI_COMMIT_TAG"; fi
    - >
      docker buildx build --platform linux/amd64
      -f infra/docker/server.Dockerfile
      -t $ECR_REGISTRY/{{PROJECT_SLUG}}-server:$CI_COMMIT_SHA
      $(echo $EXTRA_TAGS | sed "s|IMAGE|{{PROJECT_SLUG}}-server|g")
      --push .
    - >
      docker buildx build --platform linux/amd64
      -f infra/docker/web.Dockerfile
      --build-arg NEXT_PUBLIC_API_BASE=$NEXT_PUBLIC_API_BASE
      --build-arg NEXT_PUBLIC_APP_NAME=$NEXT_PUBLIC_APP_NAME
      -t $ECR_REGISTRY/{{PROJECT_SLUG}}-web:$CI_COMMIT_SHA
      $(echo $EXTRA_TAGS | sed "s|IMAGE|{{PROJECT_SLUG}}-web|g")
      --push .
    - >
      docker buildx build --platform linux/amd64
      -f infra/docker/converter-worker.Dockerfile
      -t $ECR_REGISTRY/{{PROJECT_SLUG}}-converter-worker:$CI_COMMIT_SHA
      $(echo $EXTRA_TAGS | sed "s|IMAGE|{{PROJECT_SLUG}}-converter-worker|g")
      --push .

generate-adr:
  stage: publish
  extends: .pnpm-base
  rules:
    - if: $CI_COMMIT_BRANCH == "main"
  script:
    - node scripts/generate-adr.mjs $CI_COMMIT_SHA
    - git config user.email "ci-bot@{{ORG_DOMAIN}}"
    - git config user.name "{{PROJECT_NAME}} CI Bot"
    - >
      if ! git diff --quiet docs/decisions/; then
        git add docs/decisions/
        git commit -m "docs(decisions): auto-generated ADR from $CI_COMMIT_SHA [v0.0-S00-ci]"
        git push https://oauth2:$GITLAB_BOT_TOKEN@$CI_SERVER_HOST/$CI_PROJECT_PATH.git HEAD:main
      fi

# ─────────── deploy-staging (main only) ───────────
deploy-staging:
  stage: deploy-staging
  rules:
    - if: $CI_COMMIT_BRANCH == "main"
  image: amazon/aws-cli:latest
  variables:
    AWS_PROFILE: ci-staging
  before_script:
    # AWS credentials 주입 — GitLab CI variables 에서 받음 ([§ CI variables](#ci-variables))
    - mkdir -p ~/.aws
    - |
      cat > ~/.aws/credentials <<EOF
      [ci-staging]
      aws_access_key_id=$AWS_ACCESS_KEY_ID_STAGING
      aws_secret_access_key=$AWS_SECRET_ACCESS_KEY_STAGING
      EOF
    - |
      cat > ~/.aws/config <<EOF
      [profile ci-staging]
      region=$AWS_REGION
      output=json
      EOF
  script:
    # staging 도 prod 와 동일 — setup-infra-staging + first-deploy-staging 두 manual job 으로 분리.
    # deploy-staging 은 service update 전용 (existing 가정).
    - |
      CLUSTER="{{PROJECT_SLUG}}-staging"
      EXPECT_SVC="{{PROJECT_SLUG}}-staging-server"
      EXISTING=$(aws ecs describe-services --cluster "$CLUSTER" --services "$EXPECT_SVC" \
                 --query 'services[?status==`ACTIVE`].serviceName' --output text 2>/dev/null || echo "")
      if [ -z "$EXISTING" ]; then
        echo "❌ staging service 미존재 — setup-infra-staging + first-deploy-staging manual job 을 먼저 실행하십시오."
        echo "   순서: setup-infra-staging (manual) → secret-fill (운영자 수동) → first-deploy-staging (manual) → 본 deploy-staging (main push 자동)"
        exit 1
      fi
      bash infra/aws/deploy.sh staging "$CI_COMMIT_SHA"

# Staging 부트스트랩 — prod 와 동일 패턴의 두 manual job (deploy-staging 과 분리)

setup-infra-staging:
  stage: deploy-staging
  rules:
    - if: $CI_PIPELINE_SOURCE == "web" && $RUN_STAGING_BOOTSTRAP == "setup"
      when: manual
      allow_failure: false
  image: amazon/aws-cli:2
  variables: {AWS_PROFILE: ci-staging}
  before_script:
    - mkdir -p ~/.aws
    - |
      cat > ~/.aws/credentials <<EOF
      [ci-staging]
      aws_access_key_id=$AWS_ACCESS_KEY_ID_STAGING
      aws_secret_access_key=$AWS_SECRET_ACCESS_KEY_STAGING
      EOF
  script:
    - bash infra/aws/setup-infra.sh staging
    - echo "✓ setup-infra-staging 완료. **다음**: 운영자가 Secrets Manager 의 placeholder 값들을 실 secret 으로 교체 → 그 후 first-deploy-staging manual trigger."

first-deploy-staging:
  stage: deploy-staging
  rules:
    - if: $CI_PIPELINE_SOURCE == "web" && $RUN_STAGING_BOOTSTRAP == "first-deploy"
      when: manual
      allow_failure: false
  image: node:22-bookworm
  variables: {AWS_PROFILE: ci-staging}
  before_script:
    - apt-get update -qq && apt-get install -y --no-install-recommends jq awscli ca-certificates
    - mkdir -p ~/.aws
    - |
      cat > ~/.aws/credentials <<EOF
      [ci-staging]
      aws_access_key_id=$AWS_ACCESS_KEY_ID_STAGING
      aws_secret_access_key=$AWS_SECRET_ACCESS_KEY_STAGING
      EOF
  script:
    - ACM_CERT_ARN="$ACM_CERT_ARN_STAGING" ROUTE53_ZONE_ID="$ROUTE53_ZONE_ID_STAGING" \
        bash infra/aws/first-deploy.sh staging "$CI_COMMIT_SHA"
    # 배포 후: db:seed (smoke 계정 — staging 만). migrate 는 first-deploy.sh 가 service create 전에 이미 실행됨.
    - |
      EXPECT_SVC="{{PROJECT_SLUG}}-staging-server"
      ECS_CLUSTER="{{PROJECT_SLUG}}-staging"
      TASK_ARN=$(aws ecs list-tasks --cluster "$ECS_CLUSTER" \
                 --service-name "$EXPECT_SVC" --query 'taskArns[0]' --output text)
      aws ecs execute-command --cluster "$ECS_CLUSTER" --task "$TASK_ARN" \
        --container server --interactive \
        --command "SMOKE_EMAIL_LOCAL=$SMOKE_EMAIL_LOCAL SMOKE_PASSWORD=$SMOKE_PASSWORD pnpm db:seed"
    - echo "✓ first-deploy-staging 완료. 이후 main push 시 deploy-staging 가 자동 실행."

smoke-staging:
  stage: smoke-staging
  needs: [deploy-staging]   # update path. 첫 부트스트랩은 first-deploy-staging 안에서 자체 검증.
  rules:
    - if: $CI_COMMIT_BRANCH == "main"
  image: node:22-bookworm
  variables:
    AWS_PROFILE: ci-staging
  before_script:
    - apt-get update -qq && apt-get install -y --no-install-recommends jq curl ca-certificates awscli
    - mkdir -p ~/.aws
    - |
      cat > ~/.aws/credentials <<EOF
      [ci-staging]
      aws_access_key_id=$AWS_ACCESS_KEY_ID_STAGING
      aws_secret_access_key=$AWS_SECRET_ACCESS_KEY_STAGING
      EOF
    - |
      cat > ~/.aws/config <<EOF
      [profile ci-staging]
      region=$AWS_REGION
      output=json
      EOF
  script:
    - bash scripts/smoke-test.sh staging
    # smoke 통과 직후 known-good revision 을 SSM 에 기록 (rollback.sh 가 이를 읽음 — 11-DEPLOYMENT § 부록 C).
    - |
      CLUSTER="{{PROJECT_SLUG}}-staging"
      for SVC in server web converter-worker; do
        FAMILY="{{PROJECT_SLUG}}-staging-${SVC}"
        REV=$(aws ecs describe-services --cluster "$CLUSTER" --services "$FAMILY" \
              --query 'services[0].taskDefinition' --output text)
        aws ssm put-parameter --name "/{{PROJECT_SLUG}}/staging/last-known-good/${SVC}" \
          --value "$REV" --type String --overwrite > /dev/null
      done
      echo "✓ staging known-good 기록 완료"

# ─────────── deploy-prod (tag only) ───────────
deploy-prod:
  stage: deploy-prod
  rules:
    - if: $CI_COMMIT_TAG =~ /^v\d+\.\d+\.\d+$/
  when: manual                  # 1명 승인 필요
  image: amazon/aws-cli:latest
  variables:
    AWS_PROFILE: ci-prod
  before_script:
    - mkdir -p ~/.aws
    - |
      cat > ~/.aws/credentials <<EOF
      [ci-prod]
      aws_access_key_id=$AWS_ACCESS_KEY_ID_PROD
      aws_secret_access_key=$AWS_SECRET_ACCESS_KEY_PROD
      EOF
    - |
      cat > ~/.aws/config <<EOF
      [profile ci-prod]
      region=$AWS_REGION
      output=json
      EOF
  script:
    # Prod 는 setup-infra 와 first-deploy 가 분리된 manual job 으로 미리 실행됨 (deploy-prod 가 자동 호출하지 않음).
    # deploy-prod 는 service 가 이미 존재 — update only.
    - |
      CLUSTER="{{PROJECT_SLUG}}-prod"
      EXPECT_SVC="{{PROJECT_SLUG}}-prod-server"
      EXISTING=$(aws ecs describe-services --cluster "$CLUSTER" --services "$EXPECT_SVC" \
                 --query 'services[?status==`ACTIVE`].serviceName' --output text 2>/dev/null || echo "")
      if [ -z "$EXISTING" ]; then
        echo "❌ prod service 미존재 — first-deploy-prod manual job 을 먼저 실행하십시오."
        echo "   순서: setup-infra-prod (manual) → secret-fill (manual, 운영자 직접 secret 채움) → first-deploy-prod (manual) → 본 deploy-prod (tag 시 자동)"
        exit 1
      fi
      bash infra/aws/deploy.sh prod "$CI_COMMIT_TAG"
    # Prod: deploy.sh § expand migrate (one-off task) 가 service update 전에 실행됨 — 본 job 에서 추가 migrate 호출 불필요.

# ─── Prod 부트스트랩 — 세 단계 manual job (deploy-prod 와 분리) ─────────────
# 본 job 들은 prod 환경 최초 1회만 수행. tag push 가 아닌 web UI 의 "Run pipeline" + manual trigger.

setup-infra-prod:
  stage: deploy-prod
  rules:
    - if: $CI_PIPELINE_SOURCE == "web" && $RUN_PROD_BOOTSTRAP == "setup"
      when: manual
      allow_failure: false
  image: amazon/aws-cli:2
  variables: {AWS_PROFILE: ci-prod}
  before_script:
    - mkdir -p ~/.aws
    - |
      cat > ~/.aws/credentials <<EOF
      [ci-prod]
      aws_access_key_id=$AWS_ACCESS_KEY_ID_PROD
      aws_secret_access_key=$AWS_SECRET_ACCESS_KEY_PROD
      EOF
  script:
    - bash infra/aws/setup-infra.sh prod
    # setup-infra 가 placeholder secret 만 생성. 운영자가 다음 단계에서 web UI 또는 CLI 로 secret 본문 입력.
    - echo "✓ setup-infra-prod 완료. **다음**: 운영자가 Secrets Manager 의 placeholder 값들을 실 secret 으로 교체 → 그 후 first-deploy-prod manual trigger."
    - echo "   placeholder 검증: aws secretsmanager list-secrets --filters Key=tag-key,Values=Project Key=tag-value,Values={{PROJECT_SLUG}}-prod"

first-deploy-prod:
  stage: deploy-prod
  rules:
    - if: $CI_PIPELINE_SOURCE == "web" && $RUN_PROD_BOOTSTRAP == "first-deploy"
      when: manual
      allow_failure: false
  # secret 이 채워졌어야 통과 — first-deploy.sh 가 aws-preflight 호출 → placeholder 잔존 시 즉시 fail.
  image: node:22-bookworm
  variables: {AWS_PROFILE: ci-prod}
  before_script:
    - apt-get update -qq && apt-get install -y --no-install-recommends jq awscli ca-certificates
    - mkdir -p ~/.aws
    - |
      cat > ~/.aws/credentials <<EOF
      [ci-prod]
      aws_access_key_id=$AWS_ACCESS_KEY_ID_PROD
      aws_secret_access_key=$AWS_SECRET_ACCESS_KEY_PROD
      EOF
  script:
    - ACM_CERT_ARN="$ACM_CERT_ARN_PROD" ROUTE53_ZONE_ID="$ROUTE53_ZONE_ID_PROD" \
        bash infra/aws/first-deploy.sh prod "$CI_COMMIT_SHA"
    - echo "✓ first-deploy-prod 완료. 이후 tag push (v*.*.*) 시 deploy-prod 가 자동 실행."

smoke-prod:
  stage: smoke-prod
  rules:
    - if: $CI_COMMIT_TAG =~ /^v\d+\.\d+\.\d+$/
  needs: [deploy-prod]
  image: node:22-bookworm
  variables:
    AWS_PROFILE: ci-prod                 # rollback.sh 가 aws ecs/ssm 호출 — credential 필수
  before_script:
    - apt-get update -qq && apt-get install -y --no-install-recommends jq curl ca-certificates awscli
    # AWS credentials 주입 (deploy-prod 와 동일 패턴)
    - mkdir -p ~/.aws
    - |
      cat > ~/.aws/credentials <<EOF
      [ci-prod]
      aws_access_key_id=$AWS_ACCESS_KEY_ID_PROD
      aws_secret_access_key=$AWS_SECRET_ACCESS_KEY_PROD
      EOF
    - |
      cat > ~/.aws/config <<EOF
      [profile ci-prod]
      region=$AWS_REGION
      output=json
      EOF
  script:
    # smoke 성공 시 known-good 기록, 실패 시 rollback.sh 가 직전 known-good 으로 되돌림.
    - |
      if bash scripts/smoke-test.sh prod; then
        CLUSTER="{{PROJECT_SLUG}}-prod"
        for SVC in server web converter-worker; do
          FAMILY="{{PROJECT_SLUG}}-prod-${SVC}"
          REV=$(aws ecs describe-services --cluster "$CLUSTER" --services "$FAMILY" \
                --query 'services[0].taskDefinition' --output text)
          aws ssm put-parameter --name "/{{PROJECT_SLUG}}/prod/last-known-good/${SVC}" \
            --value "$REV" --type String --overwrite > /dev/null
        done
        echo "✓ prod known-good 기록 완료"
      else
        echo "❌ prod smoke 실패 — known-good 으로 rollback"
        bash scripts/rollback.sh prod
        exit 1
      fi
```

## 보조 스크립트 명세

### `scripts/check-commit-msgs.mjs`
```js
#!/usr/bin/env node
// 인자: <since>..<until> (예: origin/main..HEAD)
import { execFileSync } from "node:child_process";
const RANGE = process.argv[2] || "origin/main..HEAD";
const RE = /^(feat|fix|chore|docs|refactor|test|perf|build|ci)(\([a-z-]+\))?: .{1,60} \[v[0-9]+\.[0-9]+-S[0-9]{2}-[a-z-]+\]$/;
const log = execFileSync("git", ["log", "--format=%H%x09%s", RANGE]).toString().trim();
if (!log) { console.log("no commits in range"); process.exit(0); }
let fails = 0;
for (const line of log.split("\n")) {
  const [sha, ...rest] = line.split("\t");
  const subject = rest.join("\t");
  if (!RE.test(subject)) {
    console.error(`❌ ${sha.slice(0,8)} - ${subject}`);
    fails++;
  }
}
if (fails) { console.error(`\n${fails} commits violate pattern`); process.exit(1); }
console.log(`✓ all commit messages valid`);
```

### `scripts/check-mr-description.mjs`
```js
#!/usr/bin/env node
// GitLab API 로 현재 MR description 검사 (CI 환경 변수 사용)
const TOKEN = process.env.GITLAB_BOT_TOKEN;
const HOST = process.env.CI_SERVER_HOST;
const PROJ = process.env.CI_PROJECT_ID;
const MR = process.env.CI_MERGE_REQUEST_IID;
if (!TOKEN || !MR) { console.log("not a MR pipeline, skip"); process.exit(0); }

const res = await fetch(`https://${HOST}/api/v4/projects/${PROJ}/merge_requests/${MR}`, {
  headers: { "PRIVATE-TOKEN": TOKEN }
});
const mr = await res.json();
const desc = mr.description || "";

const REQUIRED_SECTIONS = ["## Context", "## Decision", "## Validation", "## Migration", "## Notes", "## Self-review Checklist"];
const missing = REQUIRED_SECTIONS.filter(s => !desc.includes(s));
if (missing.length) {
  console.error(`❌ missing sections: ${missing.join(", ")}`);
  process.exit(1);
}

const bodyOnly = desc.replace(/^##.*$/gm, "").trim();
if (bodyOnly.length < 80) {
  console.error(`❌ description body too short: ${bodyOnly.length} chars (min 80)`);
  process.exit(1);
}

// self-review checklist 의 12개 체크박스 중 모두 체크됐는지
const checklist = desc.match(/^- \[[ x]\]/gm) || [];
const unchecked = checklist.filter(c => c.includes("[ ]"));
if (checklist.length < 12) {
  console.error(`❌ self-review checklist incomplete: ${checklist.length}/12`);
  process.exit(1);
}
if (unchecked.length > 0) {
  console.error(`❌ ${unchecked.length} checklist items unchecked`);
  process.exit(1);
}

console.log(`✓ MR description valid (${bodyOnly.length} chars, ${checklist.length} checklist all checked)`);
```

### `scripts/audit-deps.mjs`
```js
#!/usr/bin/env node
// pnpm.overrides + critical packages 가 모두 단일 버전인지 검사 (L04)
import { execFileSync } from "node:child_process";

const CRITICAL = ["react", "react-dom", "typescript", "vitest", "drizzle-orm", "hono", "pdfjs-dist", "@anthropic-ai/sdk"];
const lsOut = execFileSync("pnpm", ["ls", "--json", "-r", "--depth=Infinity"]).toString();
const trees = JSON.parse(lsOut);

const versions = new Map();   // pkg → Set<version>
function walk(node, pkgName) {
  if (!node) return;
  for (const dep of [node.dependencies, node.devDependencies]) {
    if (!dep) continue;
    for (const [name, info] of Object.entries(dep)) {
      if (!CRITICAL.includes(name)) continue;
      if (!versions.has(name)) versions.set(name, new Set());
      versions.get(name).add(info.version);
      walk(info, name);
    }
  }
}
for (const t of Array.isArray(trees) ? trees : [trees]) walk(t);

let fails = 0;
for (const [name, vs] of versions) {
  if (vs.size > 1) {
    console.error(`❌ ${name}: multiple versions ${[...vs].join(", ")}`);
    fails++;
  }
}
if (fails) { console.error(`\n${fails} critical packages have version drift`); process.exit(1); }
console.log(`✓ all ${CRITICAL.length} critical packages on single version`);
```

### `scripts/check-owned-paths.mjs`

```javascript
#!/usr/bin/env node
// CI 의 `owned-paths` job 이 호출 — MR 의 branch prefix 와 변경 파일을 비교.
// 병렬 worktree 정책 (08-SPRINT-PLAN § 팀별 owned/forbidden) 을 CI 단에서 강제.
// 본 script 는 path-based 만 검사 — CODEOWNERS approval 은 별도 GitLab native.

import { execFileSync } from "node:child_process";

const BRANCH = process.env.CI_MERGE_REQUEST_SOURCE_BRANCH_NAME ?? "";
const BASE_SHA = process.env.CI_MERGE_REQUEST_DIFF_BASE_SHA ?? "origin/main";

// branch prefix → team owned globs / forbidden globs.
// 08-SPRINT-PLAN § 팀별 owned/forbidden 와 단일 출처. 신규 phase team 추가 시 본 manifest 갱신.
// 정책: production code path 의 대응 test path 는 같은 팀이 소유 — 본 manifest 에 명시.
//       예: t1 의 routes/auth.ts → __tests__/routes/auth.test.ts + __tests__/middleware/* (T1 middleware 대응) 모두 t1 owned.
const TEAM_OWNED = {
  "t1-platform":     [
    "apps/server/src/db/migrations/", "apps/server/src/db/schema.ts",
    "apps/server/src/db/project-service.ts", "apps/server/src/db/artifact-service.ts", "apps/server/src/db/memory-service.ts",
    "apps/server/src/middleware/", "apps/server/src/routes/auth.ts", "apps/server/src/routes/projects.ts", "apps/server/src/routes/mcp-servers.ts",
    "apps/server/src/lib/email-sender.ts", "apps/server/src/tools/sandbox/", "apps/server/src/mcp/",
    "apps/server/src/__tests__/middleware/", "apps/server/src/__tests__/routes/auth.", "apps/server/src/__tests__/routes/projects.", "apps/server/src/__tests__/routes/mcp-servers.",
    "apps/server/src/__tests__/db/", "apps/server/src/__tests__/rls/", "apps/server/src/__tests__/integration/auth", "apps/server/src/__tests__/integration/projects",
    "infra/", "scripts/",
  ],
  "t2-orchestrator": [
    "apps/server/src/orchestrator/", "apps/server/src/routes/sessions.ts", "apps/server/src/routes/messages.ts", "apps/server/src/routes/memories.ts", "apps/server/src/tools/handlers/",
    "apps/server/src/__tests__/orchestrator", "apps/server/src/__tests__/routes/sessions.", "apps/server/src/__tests__/routes/messages.", "apps/server/src/__tests__/routes/memories.", "apps/server/src/__tests__/tools/handlers/",
  ],
  "t3-knowledge":    [
    "apps/server/src/knowledge/", "apps/server/src/routes/uploads.ts", "apps/server/src/routes/documents.ts",
    "apps/server/src/__tests__/knowledge", "apps/server/src/__tests__/routes/uploads.", "apps/server/src/__tests__/routes/documents.",
  ],
  "t4-artifact":     [
    "apps/server/src/routes/artifact", "apps/server/src/routes/public-share.ts", "apps/server/src/lib/artifact-store.ts", "apps/web/src/components/artifacts/",
    "apps/server/src/__tests__/routes/artifact", "apps/server/src/__tests__/routes/public-share.", "apps/server/src/__tests__/lib/artifact-store.", "apps/web/src/__tests__/components/artifacts/",
  ],
  "t5-skills":       [
    "skills/", "apps/server/src/tools/skills-engine.ts", "apps/server/src/routes/skills.ts", "apps/server/src/routes/skill-assets.ts",
    "apps/server/src/__tests__/tools/skills-engine.", "apps/server/src/__tests__/routes/skills.", "apps/server/src/__tests__/routes/skill-assets.",
  ],
  "t6-frontend":     ["apps/web/src/"],   // web 의 __tests__ 는 apps/web/src/ 하위라 별도 entry 불요.
};

// 모든 팀이 못 만지는 Phase 0.5 protected paths (Tier B 7-owner). branch=integration/phase-0.5 는 예외.
const PHASE05_PROTECTED = [
  "packages/shared/", "packages/interfaces/",
  "apps/server/src/openapi.ts", "apps/server/scripts/generate-openapi.ts",
  "apps/server/src/lib/errors.ts", "apps/server/src/middleware/envelope.ts",
  "apps/server/src/mappers/",        // Phase 0.5 가 모든 entity mapper 본문 생성 (14 § mapper naming convention)
  "apps/web/src/lib/api-client.ts", "apps/web/src/lib/api-types.generated.ts",
  ".gitlab/CODEOWNERS",
];

const isPhase05 = BRANCH.startsWith("integration/phase-0.5");

// Phase 0 / integration RC branch 는 검사 면제.
if (BRANCH === "" || BRANCH.startsWith("integration/")) {
  console.log(`[owned-paths] branch='${BRANCH}' — skip (integration / phase-0.5 면제)`);
  process.exit(0);
}

const teamMatch = BRANCH.match(/^(t[1-6]-(?:platform|orchestrator|knowledge|artifact|skills|frontend))\//);
if (!teamMatch) {
  console.log(`[owned-paths] branch='${BRANCH}' — team prefix 없음, 검사 skip (hotfix / docs / RFC 등)`);
  process.exit(0);
}
const team = teamMatch[1];
const owned = TEAM_OWNED[team] ?? [];

// 변경 파일 추출 — execFileSync 로 shell injection 회피.
const diffOut = execFileSync("git", ["diff", "--name-only", `${BASE_SHA}..HEAD`], { encoding: "utf-8" });
const changed = diffOut.split("\n").filter(Boolean);

const violations = [];
for (const f of changed) {
  if (PHASE05_PROTECTED.some(p => f.startsWith(p))) {
    if (!isPhase05) {
      violations.push(`Phase 0.5 protected: ${f}  (branch=${BRANCH}, 7-owner approval 필요)`);
    }
    continue;
  }
  const inOwned = owned.some(p => f.startsWith(p));
  if (!inOwned) {
    const otherTeamOwner = Object.entries(TEAM_OWNED).find(([t, ps]) => t !== team && ps.some(p => f.startsWith(p)));
    violations.push(`forbidden: ${f}  (team=${team}, ${otherTeamOwner ? `${otherTeamOwner[0]} 영역` : "공통 forbidden"})`);
  }
}

if (violations.length === 0) {
  console.log(`✓ [owned-paths] ${changed.length} 파일 모두 ${team} owned 안 (또는 cross-team allowed)`);
  process.exit(0);
}

console.error(`❌ [owned-paths] ${violations.length} 위반:`);
for (const v of violations) console.error(`   ${v}`);
console.error("");
console.error("→ 정책: 본 PR 의 변경은 task packet 의 owned_paths 안에서만 가능. 다른 영역 침범은 별도 PR + 해당 team 승인 필요.");
process.exit(1);
```

### `scripts/check-cross-domain-imports.mjs`
```js
#!/usr/bin/env node
// TypeScript 컴파일러 API 로 도메인 간 직접 import 검출 (L14)
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const SERVER_SRC = join(ROOT, "apps/server/src");

// 도메인 = apps/server/src 의 첫 단계 디렉토리 중 다음만 도메인 경계 검사 대상.
const DOMAINS = ["auth", "knowledge", "orchestrator", "tools", "mcp", "share"];
// 다음 패키지는 어디서나 import 허용:
const ALLOW_FROM_ANY = ["packages/shared", "packages/interfaces", "apps/server/src/lib", "apps/server/src/db", "apps/server/src/middleware"];

function walkTs(dir, acc = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) walkTs(p, acc);
    else if (entry.isFile() && p.endsWith(".ts") && !p.endsWith(".test.ts")) acc.push(p);
  }
  return acc;
}

let fails = 0;
for (const file of walkTs(SERVER_SRC)) {
  const rel = relative(ROOT, file);
  const myDomain = DOMAINS.find(d => rel.includes(`/src/${d}/`));
  if (!myDomain) continue;
  const src = readFileSync(file, "utf8");
  const imports = [...src.matchAll(/from ["']([^"']+)["']/g)].map(m => m[1]);
  for (const imp of imports) {
    if (!imp.startsWith(".") && !imp.startsWith("@/")) continue;
    // 다른 도메인 path 직접 참조 검출
    for (const other of DOMAINS) {
      if (other === myDomain) continue;
      if (imp.includes(`/${other}/`) || imp.startsWith(`../${other}/`)) {
        // ALLOW_FROM_ANY 안의 경로면 OK
        if (ALLOW_FROM_ANY.some(a => imp.includes(a))) continue;
        console.error(`❌ ${rel}: imports ${other} domain → "${imp}"`);
        fails++;
      }
    }
  }
}
if (fails) { console.error(`\n${fails} cross-domain imports`); process.exit(1); }
console.log("✓ no cross-domain imports");
```

### `scripts/lint-skills.mjs`
```js
#!/usr/bin/env node
// skills/*/SKILL.md frontmatter 검사 (L09)
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";

const SKILLS = join(process.cwd(), "skills");
if (!existsSync(SKILLS)) {
  console.warn("[lint-skills] skills/ 없음 — Phase 5 이전이라 정상. skip.");
  process.exit(0);
}
let fails = 0;

function checkSkill(dir) {
  const skillMd = join(dir, "SKILL.md");
  try { statSync(skillMd); }
  catch { console.error(`❌ ${dir}: SKILL.md missing`); fails++; return; }
  const content = readFileSync(skillMd, "utf8");
  const fm = content.match(/^---\n([\s\S]+?)\n---/);
  if (!fm) { console.error(`❌ ${dir}: frontmatter missing`); fails++; return; }
  const fields = Object.fromEntries(
    fm[1].split("\n").map(l => l.split(/:\s*/, 2)).filter(p => p.length === 2)
  );
  const errors = [];
  if (!fields.name) errors.push("name missing");
  if (!fields.version || !/^\d+\.\d+\.\d+$/.test(fields.version)) errors.push("version not semver");
  if (!fields.description || fields.description.length < 20) errors.push("description < 20 chars");
  if (!fields.entryPoint) errors.push("entryPoint missing");
  if (errors.length) {
    console.error(`❌ ${dir}: ${errors.join("; ")}`);
    fails += errors.length;
  }
}

for (const entry of readdirSync(SKILLS, { withFileTypes: true })) {
  if (entry.isDirectory()) checkSkill(join(SKILLS, entry.name));
}
if (fails) process.exit(1);
console.log("✓ all skills valid");
```

### `scripts/coverage-gate.mjs`
```js
#!/usr/bin/env node
// cobertura xml 파싱 + 임계치 검사
import { readFileSync, existsSync } from "node:fs";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    "server-min": { type: "string", default: "80" },
    "web-min":    { type: "string", default: "60" },
    "shared-min": { type: "string", default: "90" },
  }
});

const TARGETS = [
  { name: "server", path: "apps/server/coverage/cobertura-coverage.xml", min: +values["server-min"] },
  { name: "web",    path: "apps/web/coverage/cobertura-coverage.xml",    min: +values["web-min"] },
  { name: "shared", path: "packages/shared/coverage/cobertura-coverage.xml", min: +values["shared-min"] },
];

let fails = 0;
for (const t of TARGETS) {
  if (!existsSync(t.path)) {
    console.error(`❌ ${t.name}: coverage report missing at ${t.path}`);
    fails++;
    continue;
  }
  const xml = readFileSync(t.path, "utf8");
  const lineRate = parseFloat(xml.match(/line-rate="([\d.]+)"/)?.[1] ?? "0");
  const pct = lineRate * 100;
  if (pct < t.min) {
    console.error(`❌ ${t.name}: ${pct.toFixed(1)}% < ${t.min}%`);
    fails++;
  } else {
    console.log(`✓ ${t.name}: ${pct.toFixed(1)}% (min ${t.min}%)`);
  }
}
if (fails) process.exit(1);
```

### `scripts/check-tests-with-prod.mjs`
```js
#!/usr/bin/env node
// production code 가 추가됐는데 test 가 같이 추가됐는지 검사 (TDD-first 강제)
import { execFileSync } from "node:child_process";

const RANGE = process.argv[2] || `${process.env.CI_MERGE_REQUEST_DIFF_BASE_SHA || "origin/main"}..HEAD`;
const diff = execFileSync("git", ["diff", "--numstat", RANGE]).toString().trim();
if (!diff) { console.log("no diff"); process.exit(0); }

let prodAdded = 0, testAdded = 0;
for (const line of diff.split("\n")) {
  const [addStr, , path] = line.split("\t");
  const add = parseInt(addStr, 10);
  if (isNaN(add)) continue;
  if (path.endsWith(".test.ts") || path.endsWith(".test.tsx") || path.endsWith(".spec.ts")) {
    testAdded += add;
  } else if (/\.(ts|tsx)$/.test(path) && /^(apps|packages)\//.test(path)) {
    prodAdded += add;
  }
}

console.log(`prod +${prodAdded}, test +${testAdded}`);
if (prodAdded >= 10 && testAdded === 0) {
  console.error("❌ production code added without tests");
  process.exit(1);
}
console.log("✓ TDD ratio acceptable");
```

### `scripts/agent-reviewer.mjs`

```js
#!/usr/bin/env node
// PR diff 를 Anthropic Claude 에 보내 12-criterion 점수화.
// 출력: review.md (markdown 본문) + JSON: { score: 0~10, breakdown: {...} }
// 점수 < 7 이면 agent-reviewer-score.mjs 가 exit 1.
import { execFileSync } from "node:child_process";
import { writeFileSync, readFileSync } from "node:fs";
import Anthropic from "@anthropic-ai/sdk";

const SINCE = process.env.CI_MERGE_REQUEST_DIFF_BASE_SHA || "origin/main";
const HEAD  = process.env.CI_COMMIT_SHA || "HEAD";
const RUBRIC = readFileSync("prompts/agent-reviewer.md", "utf8");

const diff = execFileSync("git", ["diff", "--unified=3", `${SINCE}..${HEAD}`])
  .toString("utf8").slice(0, 250_000);     // 250KB 상한

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const resp = await client.messages.create({
  model: "claude-sonnet-4-6",
  max_tokens: 4096,
  system: RUBRIC,
  messages: [{
    role: "user",
    content: [
      { type: "text", text: `Diff (max 250KB):\n\n\`\`\`diff\n${diff}\n\`\`\`\n\n위 12 criterion 으로 점수화 후 JSON+markdown 반환.` }
    ]
  }],
});

const text = resp.content.find(b => b.type === "text")?.text ?? "";
const jsonMatch = text.match(/```json\n([\s\S]+?)\n```/);
const score = jsonMatch ? JSON.parse(jsonMatch[1]) : { score: 0, breakdown: {} };

writeFileSync("review.md", text);
writeFileSync("review.json", JSON.stringify(score, null, 2));
console.log(`score = ${score.score}/10`);
```

### `scripts/agent-reviewer-score.mjs`

```js
#!/usr/bin/env node
import { readFileSync } from "node:fs";
const { score } = JSON.parse(readFileSync("review.json", "utf8"));
if (score < 7) {
  console.error(`❌ agent-review score ${score} < 7 (threshold)`);
  process.exit(1);
}
console.log(`✓ agent-review score ${score} >= 7`);
```

### `prompts/agent-reviewer.md` (요약)
```
당신은 v2 의 자동 코드 리뷰어입니다. PR diff 를 받아 다음 12개 기준 점수화:
1. 테스트 추가 여부 (max 2pt)
2. 도메인 경계 (max 1pt)
3. 권한 모델 적용 (max 1pt)
4. AbortSignal 처리 (max 1pt)
5. 로그 카테고리/레벨 (max 1pt)
6. nullable-first DB 변경 (max 1pt)
7. 의존성 single-version (max 0.5pt)
8. 보안 (SQL inj / SSRF / XSS) (max 1.5pt)
9. 에러 처리 + retryable 분류 (max 0.5pt)
10. 한국어 메시지 / i18n (max 0.5pt)
11. 인터페이스 변경 시 RFC 동반 (max 0.5pt)
12. 코드 가독성 (max 0.5pt)
합계 10점. 7점 미만 fail.
```

### `scripts/generate-adr.mjs`

```javascript
#!/usr/bin/env node
// scripts/generate-adr.mjs — 머지된 commit 의 GitLab MR description 을 ADR 카드로 변환.
// 사용: node scripts/generate-adr.mjs <sha>
// CI 가 publish stage 에서 호출. PR body 에 "## Decision" section 이 없으면 no-op (exit 0).
// env: GITLAB_HOST, GITLAB_PROJECT_ID, GITLAB_BOT_TOKEN (CI variables).

import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

const sha = process.argv[2];
if (!sha) { console.error("usage: generate-adr.mjs <sha>"); process.exit(1); }

const host = process.env.GITLAB_HOST ?? "{{GITLAB_HOST}}";
const projectId = process.env.GITLAB_PROJECT_ID;
const token = process.env.GITLAB_BOT_TOKEN;
if (!projectId || !token) {
  console.warn("[generate-adr] GITLAB_PROJECT_ID/TOKEN 미설정 — skip (CI variables 확인)");
  process.exit(0);
}

async function gitlab(path) {
  const res = await fetch(`https://${host}/api/v4${path}`, {
    headers: { "PRIVATE-TOKEN": token },
  });
  if (!res.ok) throw new Error(`GitLab ${path} ${res.status}`);
  return res.json();
}

// 1) sha → MR 찾기
const mrs = await gitlab(`/projects/${projectId}/repository/commits/${sha}/merge_requests`);
const mr = mrs?.[0];
if (!mr || !mr.description) {
  console.warn("[generate-adr] MR or description not found — skip");
  process.exit(0);
}

// 2) "## Decision" section 추출. 없으면 no-op.
const m = mr.description.match(/^##\s+Decision\s*\n([\s\S]+?)(?=\n##\s|\n$)/m);
if (!m) {
  console.warn("[generate-adr] MR description 에 '## Decision' section 없음 — skip");
  process.exit(0);
}
const decisionBody = m[1].trim();

// 3) ADR 번호 결정 (docs/decisions/ADR-NNNN-*.md 의 최댓값 + 1)
const dir = resolve(process.cwd(), "docs/decisions");
if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
const existing = readdirSync(dir).filter(f => /^ADR-\d{4}-.+\.md$/.test(f));
const maxNum = existing.reduce((acc, f) => Math.max(acc, parseInt(f.slice(4, 8), 10)), 0);
const next = String(maxNum + 1).padStart(4, "0");

// 4) kebab title (MR title 기반)
const kebab = mr.title.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "untitled";
const fname = `ADR-${next}-${kebab}.md`;
const fpath = resolve(dir, fname);

// 5) ADR 본문 쓰기
const content = `# ADR-${next}: ${mr.title}

- **Date**: ${new Date().toISOString().slice(0, 10)}
- **MR**: ${mr.web_url}
- **Commit**: ${sha}
- **Status**: Accepted

## Decision

${decisionBody}
`;
writeFileSync(fpath, content);
console.log(`[generate-adr] wrote ${fname}`);

// 6) INDEX.md 업데이트 (append-only)
const indexPath = resolve(dir, "INDEX.md");
const indexLine = `- [ADR-${next}](${fname}) — ${mr.title} (${sha.slice(0, 7)})\n`;
if (existsSync(indexPath)) {
  writeFileSync(indexPath, readFileSync(indexPath, "utf-8") + indexLine);
} else {
  writeFileSync(indexPath, `# Architecture Decision Records\n\n${indexLine}`);
}
console.log(`[generate-adr] updated INDEX.md`);
```

> **fail-soft 정책**: GitLab 호출 실패 또는 description 형식 불일치는 CI 를 break 하지 않음 (warn + exit 0). 강제하려면 본 script 끝에 `process.exit(0)` 대신 `exit(99)` 같은 사용자 코드 사용.

### `scripts/smoke-test.sh`
```bash
#!/usr/bin/env bash
set -euo pipefail
ENV="${1:?env required}"
# bash 의 case-in-command-substitution `$(case ... esac)` 은 일부 환경에서 syntax error.
# 명시적 if/else 로 BASE 설정.
if [ "$ENV" = "staging" ]; then
  BASE="https://{{APP_DOMAIN_STAGING}}"
elif [ "$ENV" = "prod" ]; then
  BASE="https://{{APP_DOMAIN_PROD}}"
else
  echo "❌ unknown ENV: $ENV (expected staging|prod)"; exit 1
fi

# 1. health
curl -fsS "$BASE/health" | grep -q '"status":"ok"'

# 2. anonymous share endpoint reachable — 404 또는 410 응답 자체가 정상.
#    curl -f 는 HTTP ≥400 을 error 로 간주하므로 사용하지 않음. -s 로 silent, status code 추출.
SHARE_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/v1/share/__nonexistent__")
case "$SHARE_CODE" in
  404|410) ;;
  *) echo "❌ share endpoint expected 404|410, got $SHARE_CODE"; exit 1 ;;
esac

# 3+. 계정 기반 흐름 — staging 만. prod 는 seed 없음 (admin 별도 bootstrap), health/share 까지만.
if [ "$ENV" = "prod" ]; then
  echo "✓ smoke (prod, health + share only)"
  exit 0
fi

# 3. login flow (smoke-test 계정 — db:seed 가 dev/staging 에서 생성)
COOKIE_JAR=$(mktemp)
trap 'rm -f "$COOKIE_JAR"' EXIT
SMOKE_EMAIL_LOCAL="${SMOKE_EMAIL_LOCAL:-smoke-test}"
curl -fsS -X POST "$BASE/api/v1/auth/login" \
  -c "$COOKIE_JAR" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"${SMOKE_EMAIL_LOCAL}@{{ORG_DOMAIN}}\",\"password\":\"$SMOKE_PASSWORD\"}" \
  | jq -e '.data.user.id' > /dev/null                  # envelope 필수

# 4. 작은 메시지 send + SSE 응답 확인 (cookie 사용)
SESSION=$(curl -fsS -X POST "$BASE/api/v1/sessions" \
  -b "$COOKIE_JAR" \
  -H 'Content-Type: application/json' -d '{"title":"smoke"}' \
  | jq -r '.data.id')
[ -n "$SESSION" ] && [ "$SESSION" != "null" ]

curl -fsSN -X POST "$BASE/api/v1/sessions/$SESSION/messages" \
  -b "$COOKIE_JAR" \
  -H 'Accept: text/event-stream' \
  -H 'Content-Type: application/json' \
  -d '{"content":"hello"}' --max-time 30 \
  | head -50 | grep -q 'event: text_delta\|event: stop'

echo "smoke OK"
```

### `scripts/rollback.sh`
```bash
#!/usr/bin/env bash
set -euo pipefail
# 명명 규약: 11-DEPLOYMENT § 부록 C 와 동일 — service/family 모두 ${PROJECT}-${ENV}-${SVC}
# fail-closed: 직전 revision 추측이 아니라 known-good revision (SSM 에 매 smoke 통과 시 기록) 으로 되돌림.
# 만약 known-good 미기록 시 (첫 배포 또는 SSM 손상) → 명시적 fail (수동 개입 요구).
ENV="${1:?env required}"
PROJECT="${PROJECT_SLUG:-{{PROJECT_SLUG}}}"
CLUSTER="${PROJECT}-$ENV"

# fail-closed gate (모든 AWS mutation script 의무 — 11-DEPLOYMENT § 부록 D2)
bash "$(dirname "$0")/aws-preflight.sh" "$ENV" deploy

# SSM key shape: smoke job 이 기록할 때 짧은 svc name (server/web/converter-worker) 사용.
# rollback 도 같은 short name 으로 조회 — full FAMILY name (${PROJECT}-${ENV}-${SVC}) 가 아님!
SHORT_SVCS=(server web converter-worker)

for SHORT in "${SHORT_SVCS[@]}"; do
  SVC="${PROJECT}-${ENV}-${SHORT}"        # ECS service full name (update-service 용)
  # SSM Parameter Store 의 known-good revision 조회. smoke job 의 put-parameter 와 동일 key shape.
  PARAM="/${PROJECT}/${ENV}/last-known-good/${SHORT}"
  GOOD=$(aws ssm get-parameter --name "$PARAM" \
         --query 'Parameter.Value' --output text 2>/dev/null || echo "")
  if [ -z "$GOOD" ]; then
    echo "❌ ${SHORT}: known-good revision 미기록 (SSM ${PARAM} 없음) — 수동 개입 필요."
    exit 1
  fi
  echo "==> ${SVC} → ${GOOD}"
  aws ecs update-service --cluster "$CLUSTER" --service "$SVC" \
    --task-definition "$GOOD" --force-new-deployment > /dev/null
done

SERVICES_FULL=("${PROJECT}-${ENV}-server" "${PROJECT}-${ENV}-web" "${PROJECT}-${ENV}-converter-worker")
aws ecs wait services-stable --cluster "$CLUSTER" --services "${SERVICES_FULL[@]}"
echo "✓ rolled back to last-known-good"
```

> **known-good 기록 정책**: `deploy.sh` 가 service stable + smoke 통과 직후
> `aws ssm put-parameter --name "/${PROJECT}/${ENV}/last-known-good/${SVC}" --value "${FAMILY}:${REV}" --overwrite` 호출.
> 11-DEPLOYMENT § 부록 C 의 deploy.sh 본문에 이 단계 명시.

## CI variables (GitLab CI/CD settings)

| Key | Scope | 출처 |
|---|---|---|
| `AWS_ACCESS_KEY_ID_STAGING` / `_PROD` | masked | IAM 별도 user |
| `AWS_SECRET_ACCESS_KEY_STAGING` / `_PROD` | masked | 위와 페어 |
| `AWS_REGION` | `{{AWS_REGION}}` | |
| `ECR_REGISTRY_STAGING` | `<staging-account>.dkr.ecr.<region>.amazonaws.com` | docker-build job 의 staging 분기용 |
| `ECR_REGISTRY_PROD` | `<prod-account>.dkr.ecr.<region>.amazonaws.com` | docker-build 의 prod 분기 + image promotion 용 |
| `ECR_REGISTRY` | `<account>.dkr.ecr.<region>.amazonaws.com` | (legacy — env 별 분리되면 deprecate. 새 setup 은 `_STAGING`/`_PROD` 두 변수만 사용) |
| `GITLAB_BOT_TOKEN` | masked, protected | bot 사용자 + `read_api,write_repository` |
| `ANTHROPIC_API_KEY` | masked | agent-reviewer 용 |
| `SMOKE_PASSWORD` | masked, protected | smoke 테스트 계정 (seed + smoke-test 가 공유) |
| `ACM_CERT_ARN_STAGING` / `_PROD` | protected | ACM 인증서 ARN — first-deploy.sh 의 `ACM_CERT_ARN` 환경변수로 전달 |
| `ROUTE53_ZONE_ID_STAGING` / `_PROD` | protected | Route53 Hosted Zone ID — first-deploy.sh 가 ALB alias record 자동 등록 |
| `NEXT_PUBLIC_API_BASE` | not masked | web 빌드 시 embed 되는 API base URL (예: `https://api.{{APP_DOMAIN_PROD}}/api/v1`) |
| `NEXT_PUBLIC_APP_NAME` | not masked | web 빌드 시 embed (`{{PROJECT_NAME}}`) |
| `SMOKE_EMAIL_LOCAL` | not masked | smoke 계정 이메일의 local part — seed 와 smoke-test 가 공유 (기본 `smoke-test`) |

### AWS credential → AWS_PROFILE 매핑

deploy job (`deploy-staging` / `deploy-prod`) 의 `AWS_PROFILE: ci-{env}` 는 **runner 의 `~/.aws/credentials`** 가 아닌, **CI variables 에서 동적으로 채우는 패턴**. deploy job 의 `before_script` 에 다음 추가:

```yaml
deploy-staging:
  stage: deploy-staging
  variables:
    AWS_PROFILE: ci-staging
  before_script:
    - mkdir -p ~/.aws
    - |
      cat > ~/.aws/credentials <<EOF
      [ci-staging]
      aws_access_key_id     = $AWS_ACCESS_KEY_ID_STAGING
      aws_secret_access_key = $AWS_SECRET_ACCESS_KEY_STAGING
      EOF
    - chmod 600 ~/.aws/credentials
  script:
    - bash infra/aws/deploy.sh staging $CI_COMMIT_SHA
```

`deploy-prod` 도 동일 패턴 (`_PROD` suffix). 이를 통해 CI variables → AWS SDK 가 자동 인식.

## 빌드 시간 목표

| Pipeline | 목표 |
|---|---|
| PR (validate + test) | < 8분 |
| main 머지 후 (publish + deploy-staging + smoke) | < 12분 |
| tag (deploy-prod + smoke) | < 6분 (수동 승인 제외) |

병렬 실행으로 단축. 캐시 hit 시 install <30s.
