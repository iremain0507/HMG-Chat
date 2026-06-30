# 11 · Deployment — AWS 인프라 & CD 파이프라인

## 환경 구성

```
DEV (개발자 공유)
  RDS / Redis / S3 / ECR
  ECS server/web — 1 task each, 최소 사양
  E2B — sandbox account (dev)

STAGING (사내 베타)
  Production parity 의 1/4 규모
  RDS Multi-AZ 옵션, Redis cluster mode off
  ECS server 2 / web 2 / converter-worker 1
  E2B — sandbox account (staging)

PRODUCTION
  RDS Multi-AZ, Redis cluster mode, 백업/스냅샷
  ECS server 4 / web 3 / converter-worker 2 (auto-scale)
  E2B — sandbox account (prod)
```

각 환경은 별도 VPC + 별도 AWS account (또는 동일 account 의 다른 OU).

## 네트워크 (VPC)

```
VPC ({{INTERNAL_CIDR_DEFAULT}})
 ├── Public Subnets (2 AZ)  — ALB, NAT GW, Bastion
 ├── Private Subnets (2 AZ) — ECS tasks, Lambda
 └── Database Subnets (2 AZ) — RDS, ElastiCache (DB subnet group)

Security Groups:
  alb-sg          — 0.0.0.0/0 → :443
  server-sg       — alb-sg → :4000
  web-sg          — alb-sg → :3000
  worker-sg       — server-sg → :8000
  rds-sg          — server-sg, worker-sg, dev-bastion-sg → :5432
  redis-sg        — server-sg, worker-sg → :6379
```

## 컴퓨트 (ECS)

### Cluster
- 1 ECS cluster `{{PROJECT_SLUG}}-{env}`
- capacity providers: `FARGATE` + (옵션) `FARGATE_SPOT`

### Services
| Service | Launch | CPU / Mem | Min/Desired/Max |
|---|---|---|---|
| `{{PROJECT_SLUG}}-server` | Fargate | 1024/2048 MB | 2/2/8 |
| `{{PROJECT_SLUG}}-web` | Fargate | 256/512 MB | 2/2/6 |
| `{{PROJECT_SLUG}}-converter-worker` | Fargate | 1024/2048 MB | 1/1/4 |

E2B 호출은 외부 API 이므로 sandbox container 운영 불필요 — Docker socket 없음 (L11).

### Task Definitions (`infra/aws/task-definitions/*.json`)

server task def 예시 (요약). 풀 본문은 [§ 부록 A](#부록-a--task-definitions-본문) 참조.
실제 family 명명은 `{{PROJECT_SLUG}}-{env}-{service}` 패턴 (env 가 service 보다 앞):

```json
{
  "family": "{{PROJECT_SLUG}}-prod-server",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "1024",
  "memory": "2048",
  "containerDefinitions": [{
    "name": "server",
    "image": "<account>.dkr.ecr.<region>.amazonaws.com/{{PROJECT_SLUG}}-server:<sha>",
    "portMappings": [{"containerPort": 4000, "protocol": "tcp"}],
    "essential": true,
    "environment": [
      {"name": "NODE_ENV", "value": "production"},
      {"name": "PORT", "value": "4000"}
    ],
    "secrets": [
      {"name": "DATABASE_URL", "valueFrom": "arn:aws:secretsmanager:..."},
      {"name": "REDIS_URL", "valueFrom": "arn:aws:secretsmanager:..."},
      {"name": "JWT_SECRET", "valueFrom": "arn:aws:secretsmanager:..."},
      {"name": "ANTHROPIC_API_KEY", "valueFrom": "arn:aws:secretsmanager:..."},
      {"name": "OPENAI_API_KEY", "valueFrom": "..."},
      {"name": "VOYAGE_API_KEY", "valueFrom": "..."},
      {"name": "E2B_API_KEY", "valueFrom": "..."},
      {"name": "TAVILY_API_KEY", "valueFrom": "..."}
    ],
    "logConfiguration": {
      "logDriver": "awslogs",
      "options": {
        "awslogs-group": "/ecs/{{PROJECT_SLUG}}-server",
        "awslogs-region": "{{AWS_REGION}}",
        "awslogs-stream-prefix": "server"
      }
    }
  }]
}
```

## 데이터

### RDS PostgreSQL 16
- Multi-AZ, `db.r6g.large` (production)
- pgvector 확장 활성화 (Phase 4 이전)
- 일일 자동 백업 + 7일 보관
- 마스터 사용자명: 환경별 고정 (예: `{{PROJECT_SLUG}}_prod_owner`)
- IAM auth 옵션, 또는 비밀번호 (Secrets Manager)

### ElastiCache Redis 7
- cluster mode (production), 단일 (dev)
- `cache.m6g.large` (production)
- auto-failover 활성

### S3 buckets
| Bucket | 용도 | 정책 |
|---|---|---|
| `{{PROJECT_SLUG}}-{env}-uploads` | 사용자 업로드 | versioning, lifecycle 30~90일 |
| `{{PROJECT_SLUG}}-{env}-artifacts` | 생성 artifact | versioning |
| `{{PROJECT_SLUG}}-{env}-skills` | 스킬 자산 | 공개 X |
| `{{PROJECT_SLUG}}-{env}-logs` | 보존 로그 | Glacier 전환 |

모두 SSE-S3 (또는 KMS), block public access ON.

## 로드 밸런서 (ALB)

```
ALB
 ├── /api/v1/share/*      → public-share target group (인증 우회 path)
 ├── /api/*               → server target group
 ├── /share/*             → web target group (share page)
 └── /*                   → web target group
```

heartbeat 30초 (SSE 안정성). Target group health check `/health` (server), `/` (web).

## DNS

- `{{APP_DOMAIN_PROD}}` (prod) / `{{APP_DOMAIN_STAGING}}` / `{{APP_DOMAIN_DEV}}`
- Route 53 alias → ALB
- TLS: ACM (재사용)

## CI/CD 파이프라인

### Build & Push (main 머지 시)
```
GitLab CI → docker buildx (linux/amd64) → trivy scan → ECR push (tag = git sha)
```

### Deploy Staging (main 머지 후 자동)
```
Task def register (image = ECR sha) →
ECS service update (force new deployment) →
Wait for steady state →
Smoke test (health + 1 e2e) →
Slack notify
```

### Deploy Production (tag `v1.x.y` 시 자동)
```
Approval (CI 의 manual gate, 1명) →
Task def register →
ECS rolling update (50% min healthy) →
Smoke test →
on success: Slack release note
on failure: ECS service update → 직전 task def 으로 자동 rollback
```

### Rollback 절차
1. ECS console 또는 CLI: `aws ecs update-service --service {{PROJECT_SLUG}}-server --task-definition <prev>`
2. ELB health check 정상화 확인 (~3분)
3. 사건 인시던트 티켓 생성 → 5 whys 회고

## Secrets 관리

- 모든 비밀: AWS Secrets Manager
- IAM role: ECS task execution role 이 SecretsManager:GetSecretValue 권한
- 로컬 개발: `.env.local` (gitignore), 또는 `aws secretsmanager get-secret-value` 헬퍼 스크립트
- secret rotation: 분기마다 (또는 인시던트 후 즉시)

## 관측 (Observability)

### Logs
- CloudWatch Logs: `/ecs/{{PROJECT_SLUG}}-{server,web,converter-worker}`
- Pino JSON 출력 → CloudWatch Insights 쿼리:
  ```
  fields @timestamp, level, category, msg, request_id, user_id
  | filter level in ["error", "fatal"]
  | sort @timestamp desc
  | limit 100
  ```

### Metrics
- CloudWatch metrics (자동): CPU, Memory, Request count, 5xx rate
- Custom metric (server PutMetricData):
  - `tool_calls{tool,status}`
  - `llm_tokens{provider,model,direction}`
  - `e2b_sandbox_lifecycle{status}`
  - `mcp_tool_calls{server,status}`

### Alarms (SNS → Slack)

> **단일 출처**: [12-OPS-SECURITY.md § Alarms](12-OPS-SECURITY.md) 가 정식 임계치. 본 문서는 표 중복 없이 12 참조.

11개 알람 (Server 5xx / LLM error / E2B failure / RDS CPU / Redis memory / ALB unhealthy / Disk free / Quota / Cost anomaly / Auth bruteforce / LLM provider down) 의 정확한 조건과 액션은 12 본문 참조.

### Traces (옵션)
- AWS X-Ray + OpenTelemetry SDK
- request → service → DB / external API 흐름 시각화

## 배포 명령 (CI 가 호출)

`infra/aws/deploy.sh` — CI 만 호출, 수동 fail (`AWS_PROFILE` 미설정 시 abort):

```bash
#!/usr/bin/env bash
set -euo pipefail

[ -n "${AWS_PROFILE:-}" ] || { echo "manual run forbidden"; exit 1; }

ENV="${1:?env required}"   # dev/staging/prod
SHA="${2:?sha required}"

aws ecs register-task-definition \
  --cli-input-json file://"infra/aws/task-definitions/server.$ENV.json" \
  ...

aws ecs update-service --cluster "${PROJECT_SLUG:-{{PROJECT_SLUG}}}-${ENV}" --service "${PROJECT_SLUG:-{{PROJECT_SLUG}}}-${ENV}-server" \
  --task-definition "$FAMILY:$REV" \
  --force-new-deployment

aws ecs wait services-stable --cluster ... --services ...

bash scripts/smoke-test.sh "$ENV"
```

## 비용 가이드

- **목표 (v1.0, 100 DAU)**: ~$1500/월
  - ECS Fargate: ~$400 (server + web + worker)
  - RDS r6g.large Multi-AZ: ~$350
  - ElastiCache m6g.large: ~$200
  - ALB + data transfer: ~$100
  - S3 + CloudWatch: ~$50
  - 외부 (E2B / Voyage / Anthropic / Tavily): ~$400 (사용량 의존)

cost-aware routing 으로 LLM 비용 control:
- 단순 query → Claude Haiku
- 복잡 reasoning → Claude Opus
- 한국어 임베딩 → Voyage multilingual

## 인프라 코드 (Terraform vs Shell)

- v1.0: shell script (`infra/aws/setup-infra.sh`) — 빠른 부트스트랩 (부록 E 본문)
- v1.1+: Terraform 으로 마이그레이션 권장 (state 관리, drift 감지)

## 재해 복구

- RPO 24시간 (RDS 일일 백업)
- RTO 4시간 (백업 복원 + 인프라 재구성)
- Annual DR drill: staging 환경 destroy + 복원
- 모든 데이터의 cross-region 복제는 v1.5+

## 운영 책임 매트릭스

| 영역 | 담당 |
|---|---|
| AWS account / VPC | T1 Platform |
| ECS task definition | T1 + 도메인 team |
| Database 스키마 | T1 + T2 (도메인) |
| Logs / Metrics 추가 | 각 팀 (담당 코드) |
| Incident response | on-call rotation (T1 주도) |

자세한 보안/운영은 [12-OPS-SECURITY.md](12-OPS-SECURITY.md).

---

## 부록 A · Task Definitions 본문

`infra/aws/task-definitions/` 에 환경별로 **12개 파일** = (server + web + converter-worker + migrator) × (dev/staging/prod). 본 절의 본문은 prod 만 명시 — 나머지 9개 + migrator dev/staging 은 [§ dev / staging 의 차이](#dev--staging-의-차이) 의 diff 적용:

### `server.prod.json`

```json
{
  "family": "{{PROJECT_SLUG}}-prod-server",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "1024",
  "memory": "2048",
  "executionRoleArn": "arn:aws:iam::__ACCOUNT__:role/{{PROJECT_SLUG}}-ecs-execution",
  "taskRoleArn": "arn:aws:iam::__ACCOUNT__:role/{{PROJECT_SLUG}}-server-task",
  "containerDefinitions": [{
    "name": "server",
    "image": "__ECR_REGISTRY__/{{PROJECT_SLUG}}-server:__SHA__",
    "portMappings": [{ "containerPort": 4000, "protocol": "tcp" }],
    "essential": true,
    "environment": [
      { "name": "NODE_ENV", "value": "production" },
      { "name": "PORT", "value": "4000" },
      { "name": "AWS_REGION", "value": "{{AWS_REGION}}" },
      { "name": "S3_BUCKET_UPLOADS", "value": "{{PROJECT_SLUG}}-prod-uploads" },
      { "name": "S3_BUCKET_ARTIFACTS", "value": "{{PROJECT_SLUG}}-prod-artifacts" },
      { "name": "S3_BUCKET_SKILLS", "value": "{{PROJECT_SLUG}}-prod-skills" },
      { "name": "MCP_ALLOWED_INTERNAL_CIDRS", "value": "{{INTERNAL_CIDR_DEFAULT}}" },
      { "name": "SANDBOX_TEMPLATE_ID", "value": "{{SANDBOX_TEMPLATE_ID}}" },
      { "name": "SANDBOX_WARM_POOL_SIZE", "value": "10" },
      { "name": "SANDBOX_IDLE_TIMEOUT_MS", "value": "900000" },
      { "name": "CONVERTER_WORKER_URL", "value": "http://converter-worker.{{PROJECT_SLUG}}-prod.local:8000" },
      { "name": "RATE_LIMIT_GLOBAL_MAX", "value": "120" },
      { "name": "RATE_LIMIT_MESSAGE_SEND_MAX", "value": "20" },
      { "name": "RATE_LIMIT_UPLOAD_MAX", "value": "10" },
      { "name": "JWT_ACCESS_TTL_SECONDS", "value": "900" },
      { "name": "JWT_REFRESH_TTL_SECONDS", "value": "2592000" },
      { "name": "ALLOWED_DOMAINS", "value": "{{ORG_DOMAIN}}" },
      { "name": "FORCE_LLM_PROVIDER", "value": "" }
    ],
    "secrets": [
      { "name": "DATABASE_URL",      "valueFrom": "arn:aws:secretsmanager:{{AWS_REGION}}:__ACCOUNT__:secret:{{PROJECT_SLUG}}/prod/database-url" },
      { "name": "REDIS_URL",         "valueFrom": "arn:aws:secretsmanager:{{AWS_REGION}}:__ACCOUNT__:secret:{{PROJECT_SLUG}}/prod/redis-url" },
      { "name": "JWT_SECRET",        "valueFrom": "arn:aws:secretsmanager:{{AWS_REGION}}:__ACCOUNT__:secret:{{PROJECT_SLUG}}/prod/jwt-secret" },
      { "name": "ANTHROPIC_API_KEY", "valueFrom": "arn:aws:secretsmanager:{{AWS_REGION}}:__ACCOUNT__:secret:{{PROJECT_SLUG}}/prod/anthropic" },
      { "name": "OPENAI_API_KEY",    "valueFrom": "arn:aws:secretsmanager:{{AWS_REGION}}:__ACCOUNT__:secret:{{PROJECT_SLUG}}/prod/openai" },
      { "name": "GEMINI_API_KEY",    "valueFrom": "arn:aws:secretsmanager:{{AWS_REGION}}:__ACCOUNT__:secret:{{PROJECT_SLUG}}/prod/gemini" },
      { "name": "VOYAGE_API_KEY",    "valueFrom": "arn:aws:secretsmanager:{{AWS_REGION}}:__ACCOUNT__:secret:{{PROJECT_SLUG}}/prod/voyage" },
      { "name": "TAVILY_API_KEY",    "valueFrom": "arn:aws:secretsmanager:{{AWS_REGION}}:__ACCOUNT__:secret:{{PROJECT_SLUG}}/prod/tavily" },
      { "name": "E2B_API_KEY",       "valueFrom": "arn:aws:secretsmanager:{{AWS_REGION}}:__ACCOUNT__:secret:{{PROJECT_SLUG}}/prod/e2b" }
    ],
    "logConfiguration": {
      "logDriver": "awslogs",
      "options": {
        "awslogs-group": "/ecs/{{PROJECT_SLUG}}-server",
        "awslogs-region": "{{AWS_REGION}}",
        "awslogs-stream-prefix": "server"
      }
    },
    "healthCheck": {
      "command": ["CMD-SHELL", "wget -q -O- http://localhost:4000/health || exit 1"],
      "interval": 30,
      "timeout": 5,
      "retries": 3,
      "startPeriod": 30
    }
  }]
}
```

### `web.prod.json`

```json
{
  "family": "{{PROJECT_SLUG}}-prod-web",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "256",
  "memory": "512",
  "executionRoleArn": "arn:aws:iam::__ACCOUNT__:role/{{PROJECT_SLUG}}-ecs-execution",
  "taskRoleArn": "arn:aws:iam::__ACCOUNT__:role/{{PROJECT_SLUG}}-web-task",
  "containerDefinitions": [{
    "name": "web",
    "image": "__ECR_REGISTRY__/{{PROJECT_SLUG}}-web:__SHA__",
    "portMappings": [{ "containerPort": 3000, "protocol": "tcp" }],
    "essential": true,
    "environment": [
      { "name": "NODE_ENV", "value": "production" },
      { "name": "PORT", "value": "3000" },
      { "name": "NEXT_PUBLIC_API_BASE", "value": "https://{{APP_DOMAIN_PROD}}/api/v1" },
      { "name": "NEXT_PUBLIC_APP_NAME", "value": "{{PROJECT_NAME}}" }
    ],
    "logConfiguration": {
      "logDriver": "awslogs",
      "options": {
        "awslogs-group": "/ecs/{{PROJECT_SLUG}}-web",
        "awslogs-region": "{{AWS_REGION}}",
        "awslogs-stream-prefix": "web"
      }
    },
    "healthCheck": {
      "command": ["CMD-SHELL", "wget -q -O- http://localhost:3000/ || exit 1"],
      "interval": 30, "timeout": 5, "retries": 3, "startPeriod": 30
    }
  }]
}
```

### `converter-worker.prod.json`

```json
{
  "family": "{{PROJECT_SLUG}}-prod-converter-worker",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "1024",
  "memory": "2048",
  "executionRoleArn": "arn:aws:iam::__ACCOUNT__:role/{{PROJECT_SLUG}}-ecs-execution",
  "taskRoleArn": "arn:aws:iam::__ACCOUNT__:role/{{PROJECT_SLUG}}-converter-task",
  "containerDefinitions": [{
    "name": "converter-worker",
    "image": "__ECR_REGISTRY__/{{PROJECT_SLUG}}-converter-worker:__SHA__",
    "portMappings": [{ "containerPort": 8000, "protocol": "tcp" }],
    "essential": true,
    "environment": [
      { "name": "PORT", "value": "8000" },
      { "name": "S3_BUCKET_ARTIFACTS", "value": "{{PROJECT_SLUG}}-prod-artifacts" }
    ],
    "logConfiguration": {
      "logDriver": "awslogs",
      "options": { "awslogs-group": "/ecs/{{PROJECT_SLUG}}-converter-worker", "awslogs-region": "{{AWS_REGION}}", "awslogs-stream-prefix": "converter" }
    }
  }]
}
```

> **이름 규약 (단일 출처)**:
> - Cloud Map service name: `converter-worker` (§ setup-infra 10f, § first-deploy 4)
> - ECS task container name: `converter-worker` (위 task def `containerDefinitions[0].name`)
> - service-registries arg: `containerName=converter-worker` (§ first-deploy 4)
> - DNS resolve 결과: `converter-worker.{{PROJECT_SLUG}}-{env}.local`
> - server env `CONVERTER_WORKER_URL` 도 위 DNS 와 일치해야 함.

### `migrator.prod.json` (one-off ECS task — deploy.sh § expand migrate + first-deploy.sh § initial migrate 가 호출)

```json
{
  "family": "{{PROJECT_SLUG}}-prod-migrator",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "512",
  "memory": "1024",
  "executionRoleArn": "arn:aws:iam::__ACCOUNT__:role/{{PROJECT_SLUG}}-ecs-execution",
  "taskRoleArn": "arn:aws:iam::__ACCOUNT__:role/{{PROJECT_SLUG}}-migrator-task",
  "containerDefinitions": [{
    "name": "migrator",
    "image": "__ECR_REGISTRY__/{{PROJECT_SLUG}}-server:__SHA__",
    "essential": true,
    "command": ["pnpm", "db:migrate:expand"],
    "environment": [
      {"name": "NODE_ENV", "value": "production"},
      {"name": "MIGRATE_MODE", "value": "expand"}
    ],
    "secrets": [
      {"name": "DATABASE_URL_MIGRATOR", "valueFrom": "arn:aws:secretsmanager:{{AWS_REGION}}:__ACCOUNT__:secret:{{PROJECT_SLUG}}/prod/db-migrator-url"}
    ],
    "logConfiguration": {
      "logDriver": "awslogs",
      "options": {
        "awslogs-group": "/ecs/{{PROJECT_SLUG}}-prod-migrator",
        "awslogs-region": "{{AWS_REGION}}",
        "awslogs-stream-prefix": "migrator"
      }
    }
  }]
}
```

> **migrator 가 별도 DB user 사용 (`DATABASE_URL_MIGRATOR`)** — **v1.0 부터 분리 의무** (RLS 보안 정합):
> - **`app_user`** — 일상 query 용. `BYPASSRLS` 없음, table owner 아님, DDL 권한 없음. RLS `FORCE ROW LEVEL SECURITY` 강제로 policy 우회 불가. secret: `${PROJECT}/${ENV}/database-url`.
> - **`migrator_user`** — DDL 권한 (ALTER/CREATE/DROP), `BYPASSRLS` 없음 (FORCE RLS 대상). secret: `${PROJECT}/${ENV}/db-migrator-url`.
> - **`master_user`** (`{{DB_MASTER_USERNAME}}`) — RDS 생성 시 (`aws.db_master_username`). 두 user 를 GRANT 분리 후엔 일상 사용 금지.
> - setup-infra § 10b 의 SQL bootstrap (`CREATE ROLE app_user NOLOGIN BYPASSRLS=FALSE; GRANT ... TO app_user; CREATE ROLE migrator_user; GRANT ALTER, CREATE ... TO migrator_user;`) 가 두 role 생성. database-url + db-migrator-url 두 secret 도 각각 app_user, migrator_user credential 로 분리 저장.
> - 06 § 0001 의 `FORCE ROW LEVEL SECURITY` (모든 RLS 테이블) 가 두 user 모두에 적용 — owner / BYPASSRLS 우회 차단.

### dev / staging 의 차이

`server.staging.json`, `server.dev.json`, `migrator.staging.json`, `migrator.dev.json` 등은 위 prod 본문에서 다음만 차이:

- `family` 끝의 환경명 (`-staging`, `-dev`)
- `cpu` / `memory` 의 축소 (staging: 512/1024, dev: 256/512). migrator 는 env 무관 512/1024.
- `image` 의 ECR 태그 (env 별 ECR 계정 또는 동일 계정 + 다른 tag prefix)
- 환경변수 값 (`S3_BUCKET_*`, `MCP_ALLOWED_INTERNAL_CIDRS`, `CONVERTER_WORKER_URL`, `ALLOWED_DOMAINS={{ORG_DOMAIN}}` 동일)
- `secrets` 의 ARN prefix (`{{PROJECT_SLUG}}/staging/...`, `{{PROJECT_SLUG}}/dev/...`)
- log group (`/ecs/{{PROJECT_SLUG}}-staging-server`, `/ecs/{{PROJECT_SLUG}}-staging-migrator`)

총 12개 task def 파일 = (server + web + converter-worker + migrator) × 3 env.

## 부록 B · 환경변수 전체 목록 (.env.example)

루트의 `.env.example` 본문 (개발자 setup 시 복사 + 로컬 값 채움):

```bash
# ─── 공통 ───
NODE_ENV=development                # development / test / production
APP_NAME={{PROJECT_NAME}}

# ─── DB / Cache ───
# 두 시나리오 — 둘 중 하나 선택. 본 .env.example 은 시나리오 A (SSM tunnel) 가 default.
#
# 시나리오 A: SSM tunnel 경유 AWS RDS/Redis (포트 15432/16379 = pnpm tunnel 의 local forward port)
DATABASE_URL=postgres://{{PROJECT_SLUG}}:{{PROJECT_SLUG}}@localhost:15432/{{PROJECT_SLUG}}_dev
REDIS_URL=redis://localhost:16379
#
# 시나리오 B: docker-compose.local.yml (포트 5432/6379 = native postgres/redis).
# 본 .env.example 에선 주석 처리, 사용 시 위 라인 주석 처리 + 아래 주석 해제.
# DATABASE_URL=postgres://{{PROJECT_SLUG}}:localdev@localhost:5432/{{PROJECT_SLUG}}_dev
# REDIS_URL=redis://localhost:6379

# ─── JWT / Auth ───
JWT_SECRET=dev-only-jwt-secret-32+chars-replace-in-staging-and-prod-please    # 32+ char (env validator 통과). prod 는 Secrets Manager 가 주입.
JWT_ACCESS_TTL_SECONDS=900
JWT_REFRESH_TTL_SECONDS=2592000
ALLOWED_DOMAINS={{ORG_DOMAIN}}

# ─── Email Sender (16-API-CONTRACT § magic link 의존) ───
EMAIL_SENDER_KIND=console           # dev: console (stdout 출력) / prod: ses | smtp
EMAIL_FROM=no-reply@{{ORG_DOMAIN}}
SES_REGION={{AWS_REGION}}           # kind=ses 일 때만
SMTP_HOST=                          # kind=smtp 일 때만
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=

# ─── LLM Providers ───
ANTHROPIC_API_KEY=
OPENAI_API_KEY=
GEMINI_API_KEY=
VOYAGE_API_KEY=
TAVILY_API_KEY=
FORCE_LLM_PROVIDER=                 # 비우면 정상 routing, 'openai'/'gemini' 강제 가능

# ─── S3 ───
AWS_REGION={{AWS_REGION}}
S3_BUCKET_UPLOADS={{PROJECT_SLUG}}-dev-uploads
S3_BUCKET_ARTIFACTS={{PROJECT_SLUG}}-dev-artifacts
S3_BUCKET_SKILLS={{PROJECT_SLUG}}-dev-skills
S3_USE_AWS_CREDENTIALS=true         # 로컬은 false + S3_ACCESS_KEY/SECRET

# ─── Sandbox (E2B) ───
E2B_API_KEY=
SANDBOX_TEMPLATE_ID={{SANDBOX_TEMPLATE_ID}}
SANDBOX_WARM_POOL_SIZE=2
SANDBOX_IDLE_TIMEOUT_MS=900000
SANDBOX_MAX_CONCURRENT_PER_USER=2

# ─── Converter Worker ───
CONVERTER_WORKER_URL=http://localhost:8000

# ─── MCP ───
MCP_ALLOWED_INTERNAL_CIDRS=         # 로컬은 비움, prod 는 {{INTERNAL_CIDR_DEFAULT}}

# ─── Rate limits ───
RATE_LIMIT_GLOBAL_MAX=120
RATE_LIMIT_MESSAGE_SEND_MAX=20
RATE_LIMIT_UPLOAD_MAX=10

# ─── Frontend ───
NEXT_PUBLIC_API_BASE=http://localhost:4000/api/v1
NEXT_PUBLIC_APP_NAME={{PROJECT_NAME}}
```

### `.env.local.example` (Phase 0 산출물 — `cp .env.local.example .env.local` 후 즉시 `pnpm dev` 가능)

`.env.example` 와 별개로 **dev-only, secret 0%, docker-compose.local.yml 의존** 인 fast-path:

```bash
# .env.local.example — copy to .env.local, no edits needed for Phase 0 self-check.
# 시나리오 B (docker-compose.local.yml) 의 native postgres/redis 사용.
NODE_ENV=development
APP_NAME={{PROJECT_NAME}}

# DB / Cache — docker-compose.local.yml 의 POSTGRES_USER/PASSWORD/DB 와 정확히 일치 (drift 시 lint § 29 fail).
DATABASE_URL=postgres://{{PROJECT_SLUG}}:localdev@localhost:5432/{{PROJECT_SLUG}}_dev
REDIS_URL=redis://localhost:6379

# JWT — dev-only 32+char placeholder (prod 는 Secrets Manager 가 주입)
JWT_SECRET=dev-only-jwt-secret-DO-NOT-USE-IN-STAGING-OR-PROD-replace-me
JWT_ACCESS_TTL_SECONDS=900
JWT_REFRESH_TTL_SECONDS=2592000
ALLOWED_DOMAINS={{ORG_DOMAIN}}                  # apply-project-vars 가 치환. Phase 1 auth 의 도메인 검증과 일관.

# Email — dev 는 console kind (stdout 만 출력, 실제 메일 안 감)
EMAIL_SENDER_KIND=console
EMAIL_FROM=no-reply@{{ORG_DOMAIN}}

# LLM keys — dev stub (실제 호출 시 EmailSender/LLMProvider 가 fail-soft 또는 noop 모드)
# gitleaks pattern 회피: 'sk-ant-...' / 'sk-...' / 'AIza...' prefix 가 정규식에 잡힘.
# DUMMY_* prefix 는 entropy 검사 통과 + pattern 검사 면제. 실 사용 시 EmailSender/LLMProvider 가 NOT_CONFIGURED 반환 (dev).
ANTHROPIC_API_KEY=DUMMY_ANTHROPIC_API_KEY
OPENAI_API_KEY=DUMMY_OPENAI_API_KEY
VOYAGE_API_KEY=DUMMY_VOYAGE_API_KEY
TAVILY_API_KEY=DUMMY_TAVILY_API_KEY
GEMINI_API_KEY=DUMMY_GEMINI_API_KEY

# S3 — dev 는 minio 또는 local fs (옵션). 본 예에선 빈 값 → ArtifactStore 가 inline-only 모드로 fallback.
S3_BUCKET=
S3_REGION={{AWS_REGION}}

# Rate limits / misc
MCP_ALLOWED_INTERNAL_CIDRS=
RATE_LIMIT_GLOBAL_MAX=120
RATE_LIMIT_MESSAGE_SEND_MAX=20
RATE_LIMIT_UPLOAD_MAX=10
NEXT_PUBLIC_API_BASE=http://localhost:4000/api/v1
NEXT_PUBLIC_APP_NAME={{PROJECT_NAME}}
```

> **`.env.example` vs `.env.local.example` 차이 (반복 질문 차단)**:
> - `.env.example` = **모든 변수 + 시나리오 A (SSM tunnel) default** — staging/prod 와 같은 변수 셋. real secret 으로 채워서 사용.
> - `.env.local.example` = **dev fast-path, 시나리오 B (docker-compose.local.yml) default** — secret 자리에 dev stub. `pnpm dev` 즉시 가능.
> 두 파일 모두 Phase 0 산출물. lint § 29 가 `.env.local.example` 의 DATABASE_URL 이 docker-compose.local.yml 의 user/pass/db 와 정확히 일치하는지 자동 검사.

## 부록 C · `infra/aws/deploy.sh` (후속 배포 — service update only)

> **명명 규약 통일**: ECS service 와 task definition family 모두 `${PROJECT}-${ENV}-${SERVICE}` 패턴.
> 예: `{{PROJECT_SLUG}}-prod-server`, `{{PROJECT_SLUG}}-prod-web`, `{{PROJECT_SLUG}}-prod-converter-worker`.
> setup-infra / first-deploy / deploy 모두 동일 명명.

### v1.0 기준 본문 (수정됨)

```bash
#!/usr/bin/env bash
set -euo pipefail

# 인자: $1 = env (dev/staging/prod), $2 = image tag (sha 또는 v1.0.0)
ENV="${1:?env required}"
TAG="${2:?image tag required}"
REGION="${AWS_REGION:-{{AWS_REGION}}}"
PROJECT="${PROJECT_SLUG:-{{PROJECT_SLUG}}}"        # set -u 에서 후속 코드의 ${PROJECT} 참조용

# CI 외 실행 차단 (L13)
[ -n "${AWS_PROFILE:-}" ] || { echo "❌ manual run forbidden — set AWS_PROFILE"; exit 1; }
[ -n "${CI:-}" ] || { echo "⚠️  not running in CI — proceed only if you know what you're doing"; }

# fail-closed gate (모든 AWS mutation script 의무 — § 부록 D2)
bash "$(dirname "$0")/../../scripts/aws-preflight.sh" "$ENV" deploy

ACCOUNT=$(aws sts get-caller-identity --query Account --output text)

# fail-closed: env 별 expected account 검증. 잘못된 STS 자격으로 다른 env 에 배포 차단.
case "$ENV" in
  dev)     EXPECTED_ACCOUNT="${AWS_ACCOUNT_DEV:-{{AWS_ACCOUNT_DEV}}}" ;;
  staging) EXPECTED_ACCOUNT="${AWS_ACCOUNT_STAGING:-{{AWS_ACCOUNT_STAGING}}}" ;;
  prod)    EXPECTED_ACCOUNT="${AWS_ACCOUNT_PROD:-{{AWS_ACCOUNT_PROD}}}" ;;
esac
if [ "$ACCOUNT" != "$EXPECTED_ACCOUNT" ]; then
  echo "❌ env=$ENV expected account $EXPECTED_ACCOUNT, but STS returned $ACCOUNT — refusing to deploy."
  exit 1
fi

# fail-closed: placeholder secret 이 prod/staging 에 남아있으면 거부.
if [ "$ENV" != "dev" ]; then
  for SECRET in anthropic openai gemini voyage tavily e2b jwt-secret; do
    VAL=$(aws secretsmanager get-secret-value --secret-id "${PROJECT}/${ENV}/${SECRET}" \
            --query 'SecretString' --output text 2>/dev/null || echo "__MISSING__")
    case "$VAL" in
      __PLACEHOLDER_PLEASE_REPLACE__|__PLACEHOLDER__|__MISSING__|"")
        echo "❌ ${PROJECT}/${ENV}/${SECRET} 가 placeholder 또는 비어있음 — prod/staging 배포 거부. 실제 값으로 채우십시오."
        exit 1
        ;;
    esac
  done
fi

ECR="${ACCOUNT}.dkr.ecr.${REGION}.amazonaws.com"

# 0) pre-deploy expand migration — service update 전에 schema 가 새 코드와 같거나 더 넓은 상태가 되도록.
#    expand-only 마이그레이션 (additive, backward compatible) 만 본 단계 실행. contract (DROP/RENAME) 는 다음 릴리스 의 expand.
#    one-off ECS task — server image (TAG) 의 entrypoint 를 `pnpm db:migrate:expand` 로 override.
#    실패 시 service update 안 함 — 새 schema 미반영 상태에서 새 코드 실행 위험 차단.
echo "[migrate-expand] launching one-off ECS task with server:${TAG} → pnpm db:migrate:expand"
MIGRATE_TASK_FAMILY="${PROJECT_SLUG:-{{PROJECT_SLUG}}}-${ENV}-migrator"
MIGRATE_TASK_DEF="infra/aws/task-definitions/migrator.${ENV}.json"
RENDERED_MIGRATE=$(mktemp)
sed -e "s|__ACCOUNT__|${ACCOUNT}|g" -e "s|__ECR_REGISTRY__|${ECR}|g" -e "s|__SHA__|${TAG}|g" \
    "$MIGRATE_TASK_DEF" > "$RENDERED_MIGRATE"
MIGRATE_REV=$(aws ecs register-task-definition --cli-input-json "file://$RENDERED_MIGRATE" \
              --query 'taskDefinition.revision' --output text)

# subnet/sg 는 setup-infra 가 SSM 에 기록. set -u 안전 — $PROJECT (line 609 에서 set 됨) 사용, $PROJECT_SLUG 직접 참조 금지.
SUBNET=$(aws ssm get-parameter --name "/${PROJECT}/${ENV}/private-subnet-a" --query 'Parameter.Value' --output text)
SG=$(aws ssm get-parameter --name "/${PROJECT}/${ENV}/ecs-task-sg" --query 'Parameter.Value' --output text)

MIGRATE_ARN=$(aws ecs run-task \
  --cluster "${PROJECT}-${ENV}" \
  --task-definition "${MIGRATE_TASK_FAMILY}:${MIGRATE_REV}" \
  --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[$SUBNET],securityGroups=[$SG],assignPublicIp=DISABLED}" \
  --overrides '{"containerOverrides":[{"name":"migrator","command":["pnpm","db:migrate:expand"]}]}' \
  --query 'tasks[0].taskArn' --output text)

aws ecs wait tasks-stopped --cluster "${PROJECT_SLUG:-{{PROJECT_SLUG}}}-${ENV}" --tasks "$MIGRATE_ARN"
EXIT_CODE=$(aws ecs describe-tasks --cluster "${PROJECT_SLUG:-{{PROJECT_SLUG}}}-${ENV}" --tasks "$MIGRATE_ARN" \
            --query 'tasks[0].containers[0].exitCode' --output text)
if [ "$EXIT_CODE" != "0" ]; then
  echo "❌ db:migrate:expand 실패 (exit=${EXIT_CODE}) — service update 차단"
  exit 1
fi
echo "✓ db:migrate:expand 완료 (task ${MIGRATE_ARN##*/})"

# 1) service update (server/web/worker)
for SVC in server web converter-worker; do
  FAMILY="${PROJECT_SLUG:-{{PROJECT_SLUG}}}-${ENV}-${SVC}"
  TASK_DEF_FILE="infra/aws/task-definitions/${SVC}.${ENV}.json"

  # 1a) placeholder 치환
  RENDERED=$(mktemp)
  sed -e "s|__ACCOUNT__|${ACCOUNT}|g" \
      -e "s|__ECR_REGISTRY__|${ECR}|g" \
      -e "s|__SHA__|${TAG}|g" \
      "$TASK_DEF_FILE" > "$RENDERED"

  # 1b) task definition 등록
  REV=$(aws ecs register-task-definition \
    --cli-input-json "file://$RENDERED" \
    --query 'taskDefinition.revision' --output text)

  # 1c) service update — service 명도 FAMILY 와 동일 (${PROJECT}-${ENV}-${SVC})
  aws ecs update-service \
    --cluster "${PROJECT_SLUG:-{{PROJECT_SLUG}}}-${ENV}" \
    --service "${FAMILY}" \
    --task-definition "${FAMILY}:${REV}" \
    --force-new-deployment > /dev/null

  echo "✓ ${SVC} → ${FAMILY}:${REV}"
done

# 2) wait stable (최대 10분)
aws ecs wait services-stable \
  --cluster "${PROJECT_SLUG:-{{PROJECT_SLUG}}}-${ENV}" \
  --services "${PROJECT_SLUG:-{{PROJECT_SLUG}}}-${ENV}-server" "${PROJECT_SLUG:-{{PROJECT_SLUG}}}-${ENV}-web" "${PROJECT_SLUG:-{{PROJECT_SLUG}}}-${ENV}-converter-worker"

# 3) deploy.sh 는 (expand migrate → service stable) 까지 책임. smoke + contract migrate 는 CI 가 후속 호출.
echo "✓ deploy.sh 완료 (expand migrate + service stable). CI 가 (smoke → known-good → 다음 릴리스 의 contract migrate) 호출."
```

> ⚠️ **위 본문은 service update 만 한다 — service 가 이미 존재한다는 가정**. 첫 배포 (service create), ALB target group / listener / path rule 생성은 별도 부록 H 참조.
> **순서 계약** (단일 출처): **expand migrate (pre-deploy one-off task) → service update → service stable → smoke → known-good 기록 → 다음 릴리스 의 contract migrate**. CI 의 `deploy-staging` / `deploy-prod` job 이 본 순서를 강제.
> **expand vs contract** ([부록 G § Migration 정책](#migration-정책-expandcontract--rollback-안전성)):
> - expand = additive, backward compatible (CREATE TABLE, ADD COLUMN nullable, CREATE INDEX CONCURRENTLY 등) — pre-deploy 안전.
> - contract = destructive, backward incompatible (DROP COLUMN, RENAME, NOT NULL on existing column 등) — 반드시 **다음 릴리스의 expand step** (이전 릴리스 코드가 이미 새 schema 만 사용한다는 확신 후).

#### deploy.sh 끝의 known-good 기록 (rollback 의존)

smoke 통과 직후 CI 가 SSM 에 현재 revision 을 known-good 으로 기록:

```bash
# CI 의 deploy job script 끝부분 — smoke 통과 후 실행.
# set -u 안전: PROJECT 를 명시 export (CI variables) → 후속 모든 참조가 ${PROJECT}.
PROJECT="${PROJECT_SLUG:-{{PROJECT_SLUG}}}"
for SVC in server web converter-worker; do
  FAMILY="${PROJECT}-${ENV}-${SVC}"
  REV=$(aws ecs describe-services --cluster "${PROJECT}-${ENV}" --services "$FAMILY" \
        --query 'services[0].taskDefinition' --output text)
  aws ssm put-parameter --name "/${PROJECT}/${ENV}/last-known-good/${SVC}" \
    --value "$REV" --type String --overwrite > /dev/null
done
```

`scripts/rollback.sh` 가 본 값을 읽음 (15-CI-PIPELINE § rollback.sh). known-good 미기록 시 rollback fail-closed.

## 부록 D · IAM role 최소 권한

`{{PROJECT_SLUG}}-server-task` role policy (요약):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:GetObject","s3:PutObject","s3:DeleteObject","s3:ListBucket"],
      "Resource": [
        "arn:aws:s3:::{{PROJECT_SLUG}}-prod-uploads/*",
        "arn:aws:s3:::{{PROJECT_SLUG}}-prod-uploads",
        "arn:aws:s3:::{{PROJECT_SLUG}}-prod-artifacts/*",
        "arn:aws:s3:::{{PROJECT_SLUG}}-prod-artifacts",
        "arn:aws:s3:::{{PROJECT_SLUG}}-prod-skills/*",
        "arn:aws:s3:::{{PROJECT_SLUG}}-prod-skills"
      ]
    },
    {
      "Effect": "Allow",
      "Action": ["secretsmanager:GetSecretValue"],
      "Resource": ["arn:aws:secretsmanager:{{AWS_REGION}}:__ACCOUNT__:secret:{{PROJECT_SLUG}}/prod/*"]
    },
    {
      "Effect": "Allow",
      "Action": ["cloudwatch:PutMetricData"],
      "Resource": "*",
      "Condition": { "StringEquals": { "cloudwatch:namespace": "{{PROJECT_NAME_PASCAL}}" } }
    },
    {
      "Effect": "Allow",
      "Action": ["logs:CreateLogStream","logs:PutLogEvents"],
      "Resource": "arn:aws:logs:{{AWS_REGION}}:__ACCOUNT__:log-group:/ecs/{{PROJECT_SLUG}}-server*"
    },
    {
      "Sid": "ECSExecForMigrateSeed",
      "Effect": "Allow",
      "Action": [
        "ssmmessages:CreateControlChannel",
        "ssmmessages:CreateDataChannel",
        "ssmmessages:OpenControlChannel",
        "ssmmessages:OpenDataChannel"
      ],
      "Resource": "*"
    }
  ]
}
```

> **ECS Exec 활성화 전제조건** (CI 의 `aws ecs execute-command pnpm db:migrate` 가 동작하려면):
> 1. service 가 `--enable-execute-command` 로 생성 (first-deploy.sh § 4 참조).
> 2. task role 에 위 `ssmmessages:*` 4가지 권한 (본 부록 D).
> 3. **server Docker image 안에 `pnpm` + drizzle 의존성이 살아있어야 함** — server.Dockerfile 의 production stage 가 `pnpm install --prod` 만 하면 drizzle-kit 누락. `RUN pnpm install --frozen-lockfile` (devDeps 포함) 또는 별도 `migrator` task 사용. v1.0 은 server image 에 devDeps 포함 (~150MB 추가, 그러나 ECS Exec migrate 보장). 운영 안정화 후 별도 migrator task definition 으로 분리 가능.
> 4. ECS task definition 의 `containerDefinitions[0].linuxParameters.initProcessEnabled: true` (recommended).
`{{PROJECT_SLUG}}-ecs-execution` role: AWS 관리 정책 `AmazonECSTaskExecutionRolePolicy` + SecretsManager read.

---

## 부록 D2 · `scripts/aws-preflight.sh` (모든 AWS mutation 직전 fail-closed gate)

**모든** setup-infra / first-deploy / deploy / rollback 스크립트가 시작 시 본 preflight 호출. 한 곳에서 fail-closed 검증.

```bash
#!/usr/bin/env bash
# scripts/aws-preflight.sh — AWS mutation 전 fail-closed 검증.
#
# 사용법:
#   bash scripts/aws-preflight.sh <env> <mode>
#     env  = dev | staging | prod
#     mode = bootstrap | deploy
#
# mode 분리 이유: setup-infra.sh 는 처음 실행 시 secret 을 placeholder 로 만든 후 그 위에 진행.
# 그래서 bootstrap 모드는 secret 부재/placeholder 를 허용 (account/region 만 검증).
# deploy/first-deploy/rollback 은 deploy 모드 — 실제 secret 이 채워져 있어야 통과.
set -euo pipefail
ENV="${1:?env required}"
MODE="${2:-deploy}"          # bootstrap | deploy (default: deploy)
REGION="${AWS_REGION:-{{AWS_REGION}}}"
PROJECT="${PROJECT_SLUG:-{{PROJECT_SLUG}}}"

# 1) AWS_PROFILE 강제 (수동 실행 차단)
[ -n "${AWS_PROFILE:-}" ] || { echo "❌ AWS_PROFILE 미설정 — manual run forbidden"; exit 1; }

# 2) env-account 검증 (모든 mode)
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
case "$ENV" in
  dev)     EXPECTED="${AWS_ACCOUNT_DEV:-{{AWS_ACCOUNT_DEV}}}" ;;
  staging) EXPECTED="${AWS_ACCOUNT_STAGING:-{{AWS_ACCOUNT_STAGING}}}" ;;
  prod)    EXPECTED="${AWS_ACCOUNT_PROD:-{{AWS_ACCOUNT_PROD}}}" ;;
  *) echo "❌ unknown env: $ENV"; exit 1 ;;
esac
if [ "$ACCOUNT" != "$EXPECTED" ]; then
  echo "❌ env=$ENV expected account=$EXPECTED, STS returned $ACCOUNT — refusing"
  exit 1
fi

# 3) LOCAL_ONLY placeholder marker 거부 (모든 mode)
for v in AWS_REGION AWS_ACCOUNT_DEV AWS_ACCOUNT_STAGING AWS_ACCOUNT_PROD; do
  val="${!v:-}"
  case "$val" in
    LOCAL_ONLY_*_PENDING) echo "❌ $v 가 LOCAL_ONLY marker — apply-project-vars 재실행"; exit 1 ;;
  esac
done

# 4) Secret placeholder 거부 — deploy mode 에서만. bootstrap 은 secret 미존재/placeholder 허용 (setup-infra 가 만들 예정).
#    database-url / redis-url 은 setup-infra 가 endpoint 조회 후 채움 — 본 검사에 포함 (auto-fill 되지 않으면 deploy fail).
if [ "$MODE" = "deploy" ] && [ "$ENV" != "dev" ]; then
  for S in database-url redis-url anthropic openai gemini voyage tavily e2b jwt-secret; do
    VAL=$(aws secretsmanager get-secret-value --secret-id "${PROJECT}/${ENV}/${S}" \
            --query 'SecretString' --output text 2>/dev/null || echo "__MISSING__")
    case "$VAL" in
      __PLACEHOLDER_PLEASE_REPLACE__|__PLACEHOLDER__|__MISSING__|"")
        echo "❌ ${PROJECT}/${ENV}/${S} 가 placeholder 또는 비어있음 — 채운 후 재시도"
        exit 1
        ;;
    esac
  done

  # 5) DB role existence check — setup-infra 가 SQL 파일만 만들고 manual 실행 의존 → first-deploy 전에 두 role 실 동작 검증.
  #    migrator-url credential 로 `SELECT current_user` 호출 → 'migrator_user' 반환이어야 통과.
  MIG_URL=$(aws secretsmanager get-secret-value --secret-id "${PROJECT}/${ENV}/db-migrator-url" \
             --query 'SecretString' --output text 2>/dev/null || echo "")
  if [ -z "$MIG_URL" ]; then
    echo "❌ db-migrator-url secret 비어있음 — setup-infra 의 § 10b 가 미실행"; exit 1
  fi
  # SSM bastion 통해 psql 호출. bastion 미존재 시 (e.g. ECS exec 환경) skip 가능 — 명시적 SKIP_DB_ROLE_CHECK=1 환경변수만 우회 허용.
  if [ "${SKIP_DB_ROLE_CHECK:-0}" != "1" ]; then
    if command -v psql > /dev/null 2>&1; then
      CUR=$(PGOPTIONS='-c statement_timeout=5000' psql "$MIG_URL" -tAc "SELECT current_user" 2>/dev/null || echo "")
      if [ "$CUR" != "migrator_user" ]; then
        echo "❌ db-migrator-url 가 'migrator_user' role 로 인증 안 됨 (current_user='$CUR'). setup-infra § 10b SQL 수동 실행 후 재시도. SKIP_DB_ROLE_CHECK=1 로 우회 가능 (위험)"
        exit 1
      fi
      echo "✓ migrator_user role 인증 OK"
    else
      echo "⚠️  psql 미설치 — DB role check skip (CI image 에 postgresql-client 추가 권장)"
    fi
  fi
fi

echo "✓ AWS preflight passed: env=$ENV mode=$MODE account=$ACCOUNT region=$REGION"
```

본 스크립트는 `setup-infra.sh`, `first-deploy.sh`, `deploy.sh`, `rollback.sh` 의 **첫 줄** 에 호출 강제 — 어떤 경로로 AWS 를 변경하든 동일 gate 통과 의무.

### Migration 정책 (expand/contract — rollback 안전성)

> 매 라운드 LLM 검토에서 "rollback 이 DB schema 를 안 되돌림" 이 반복 지적되는데, 이는 **plan 의 의도된 expand/contract 정책** 이라 별도 답변.

**원칙**: 매 마이그레이션은 **backward-compatible (expand only)** — 이전 버전 server 가 새 schema 로도 동작. destructive 변경 (`DROP COLUMN`, `DROP TABLE`, `RENAME`, `CHECK constraint 좁히기`) 은 별도 PR + 인간 승인 + 2 단계 절차.

**2 단계 절차 (destructive 변경 시)**:
1. **Expand PR**: 새 컬럼/테이블 추가 (nullable, default), 새 코드는 양쪽 호환. 머지 → 배포.
2. (배포 안정 확인 후 별도 PR)
3. **Contract PR**: 옛 컬럼/테이블 drop. 머지 → 배포.

**rollback 안전성 보장**: 매 배포 시점에 DB schema 는 항상 이전 코드 버전과도 호환 → ECS task definition rollback (`rollback.sh` 의 last-known-good 복원) 만으로 충분. DB schema rollback 불요. 본 정책이 깨지면 rollback 도 깨짐 — 그래서 `destructive 변경 시 별도 승인` 이 강제 gate.

**검증**: CI 의 `migration-dry-run` job 이 빈 DB 에 매 migration 순차 적용 후 idempotency 검증. destructive 변경 검출 시 (DROP / RENAME 등) `pr-template-lint` 가 PR description 의 "## Destructive Migration" 섹션 + 인간 승인 강제 ([10-DEV-WORKFLOW § Tier B](10-DEV-WORKFLOW.md)).

### Prod smoke 의 boundary (반복 질문 차단)

> "prod smoke 가 health/share 만 → MVP 검증 부족" 도 매 라운드 반복 지적. 이는 **plan 의 의도된 분리**.

**boundary**:
- **prod 환경에는 seed 미실행** — admin 은 `scripts/bootstrap-admin.ts` 별도 1회 실행, smoke 계정 없음.
- prod smoke = `/health` + `/api/v1/share/<expired>` (404/410) — 인증 흐름 미사용.
- **MVP 동작 검증은 staging smoke 에서 의무** — staging 은 seed 적용 → smoke-test 계정으로 login + session + SSE + upload + share read 의 e2e flow 검증 (15 § smoke-test.sh).

**확신 강화 옵션 (배포자 선택)**: prod 에 별도 `synthetic-prod-smoke` 계정을 SSM Secret 으로 관리. 본 계정은 invite-only 도메인 (e.g., `synthetic@internal-monitor.{{ORG_DOMAIN}}`) 으로 production seed 의 명시 예외. CI 의 `smoke-prod-deep` 옵션 job 이 그 계정으로 login + chat smoke. v1.0 default 는 health/share 만 — 이는 prod data 오염 회피와 single source of truth (seed = dev/staging 만) 정책 때문.

**mode 매핑** (setup-infra 는 secret 생성자, 나머지는 secret 소비자):
- `setup-infra.sh` → `aws-preflight.sh $ENV bootstrap` (secret placeholder 허용)
- `first-deploy.sh` → `aws-preflight.sh $ENV deploy` (secret 채워졌어야)
- `deploy.sh` → `aws-preflight.sh $ENV deploy`
- `rollback.sh` → `aws-preflight.sh $ENV deploy`

```bash
# 위 4 스크립트 모두 시작 부분에:
bash "$(dirname "$0")/../../scripts/aws-preflight.sh" "$ENV"
```

## 부록 E · `infra/aws/setup-infra.sh` 본문

신규 환경 (dev/staging/prod) 의 인프라를 1회 셋업. idempotent (resource 이미 존재하면 skip).

```bash
#!/usr/bin/env bash
# infra/aws/setup-infra.sh — VPC/RDS/Redis/ECR/ECS/ALB/S3 신규 환경 부트스트랩
# 사용법:
#   AWS_PROFILE=ci-dev bash infra/aws/setup-infra.sh dev
set -euo pipefail

ENV="${1:?env required (dev/staging/prod)}"
REGION="${AWS_REGION:-{{AWS_REGION}}}"
PROJECT="${PROJECT_SLUG:-{{PROJECT_SLUG}}}"
NAME_PREFIX="${PROJECT}-${ENV}"

# Fail-closed preflight — bootstrap mode (secret placeholder 허용. setup 이 만들 예정).
bash "$(dirname "$0")/../../scripts/aws-preflight.sh" "$ENV" bootstrap

case "$ENV" in
  prod)    DB_CLASS="db.r6g.large"; REDIS_CLASS="cache.m6g.large"; MULTI_AZ="true" ;;
  staging) DB_CLASS="db.t3.medium"; REDIS_CLASS="cache.t3.small"; MULTI_AZ="false" ;;
  dev)     DB_CLASS="db.t3.small";  REDIS_CLASS="cache.t3.micro"; MULTI_AZ="false" ;;
  *) echo "unknown env: $ENV"; exit 1 ;;
esac

VPC_CIDR="${INTERNAL_CIDR_DEFAULT:-{{INTERNAL_CIDR_DEFAULT}}}"
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
echo "==> [${ENV}] setup-infra in ${REGION} (account ${ACCOUNT})"

# subnet CIDR 은 VPC CIDR 의 /16 prefix 기반으로 자동 분할 — VPC_CIDR 가 10.0.0.0/16 이 아니어도 동작.
# (예: 192.168.0.0/16 → 192.168.0/24 public, 192.168.10/24 private, 192.168.20/24 db)
VPC_PREFIX=$(echo "$VPC_CIDR" | cut -d/ -f1 | cut -d. -f1-2)   # "10.0" 또는 "192.168" 등
SUBNET_PUB_A="${VPC_PREFIX}.0.0/24"
SUBNET_PUB_B="${VPC_PREFIX}.1.0/24"
SUBNET_PRV_A="${VPC_PREFIX}.10.0/24"
SUBNET_PRV_B="${VPC_PREFIX}.11.0/24"
SUBNET_DB_A="${VPC_PREFIX}.20.0/24"
SUBNET_DB_B="${VPC_PREFIX}.21.0/24"

# ── 1) VPC + Subnets + IGW + NAT ──
VPC_ID=$(aws ec2 describe-vpcs --filters "Name=tag:Name,Values=${NAME_PREFIX}-vpc" \
  --query 'Vpcs[0].VpcId' --output text)
if [ "$VPC_ID" = "None" ]; then
  VPC_ID=$(aws ec2 create-vpc --cidr-block "$VPC_CIDR" \
    --tag-specifications "ResourceType=vpc,Tags=[{Key=Name,Value=${NAME_PREFIX}-vpc}]" \
    --query Vpc.VpcId --output text)
  aws ec2 modify-vpc-attribute --vpc-id "$VPC_ID" --enable-dns-hostnames
fi

AZS=( $(aws ec2 describe-availability-zones --region "$REGION" \
        --query 'AvailabilityZones[0:2].ZoneName' --output text) )

create_subnet() {
  local cidr="$1" az="$2" tier="$3"
  local name="${NAME_PREFIX}-${tier}-${az##*-}"
  local id=$(aws ec2 describe-subnets --filters "Name=tag:Name,Values=${name}" \
             --query 'Subnets[0].SubnetId' --output text)
  if [ "$id" = "None" ]; then
    id=$(aws ec2 create-subnet --vpc-id "$VPC_ID" --cidr-block "$cidr" \
         --availability-zone "$az" \
         --tag-specifications "ResourceType=subnet,Tags=[{Key=Name,Value=${name}},{Key=Tier,Value=${tier}}]" \
         --query Subnet.SubnetId --output text)
  fi
  echo "$id"
}

PUB_A=$(create_subnet "$SUBNET_PUB_A"  "${AZS[0]}" "public")
PUB_B=$(create_subnet "$SUBNET_PUB_B"  "${AZS[1]}" "public")
PRV_A=$(create_subnet "$SUBNET_PRV_A"  "${AZS[0]}" "private")
PRV_B=$(create_subnet "$SUBNET_PRV_B"  "${AZS[1]}" "private")
DB_A=$( create_subnet "$SUBNET_DB_A"   "${AZS[0]}" "db")
DB_B=$( create_subnet "$SUBNET_DB_B"   "${AZS[1]}" "db")

# ── IGW ──
IGW_ID=$(aws ec2 describe-internet-gateways --filters "Name=attachment.vpc-id,Values=${VPC_ID}" \
  --query 'InternetGateways[0].InternetGatewayId' --output text 2>/dev/null || echo "None")
if [ "$IGW_ID" = "None" ]; then
  IGW_ID=$(aws ec2 create-internet-gateway \
    --tag-specifications "ResourceType=internet-gateway,Tags=[{Key=Name,Value=${NAME_PREFIX}-igw}]" \
    --query InternetGateway.InternetGatewayId --output text)
  aws ec2 attach-internet-gateway --internet-gateway-id "$IGW_ID" --vpc-id "$VPC_ID"
fi

# ── NAT Gateway (EIP + NAT 생성, public subnet A 에) ──
NAT_ID=$(aws ec2 describe-nat-gateways --filter "Name=vpc-id,Values=${VPC_ID}" "Name=state,Values=available,pending" \
  --query 'NatGateways[0].NatGatewayId' --output text 2>/dev/null || echo "None")
if [ "$NAT_ID" = "None" ] || [ -z "$NAT_ID" ]; then
  # EIP allocate (이미 있으면 재사용)
  EIP_ALLOC=$(aws ec2 describe-addresses \
    --filters "Name=tag:Name,Values=${NAME_PREFIX}-nat-eip" \
    --query 'Addresses[0].AllocationId' --output text 2>/dev/null || echo "None")
  if [ "$EIP_ALLOC" = "None" ]; then
    EIP_ALLOC=$(aws ec2 allocate-address --domain vpc \
      --tag-specifications "ResourceType=elastic-ip,Tags=[{Key=Name,Value=${NAME_PREFIX}-nat-eip}]" \
      --query AllocationId --output text)
  fi
  NAT_ID=$(aws ec2 create-nat-gateway \
    --subnet-id "$PUB_A" --allocation-id "$EIP_ALLOC" \
    --tag-specifications "ResourceType=natgateway,Tags=[{Key=Name,Value=${NAME_PREFIX}-nat}]" \
    --query NatGateway.NatGatewayId --output text)
  echo "  [nat] creating $NAT_ID — 1~3분 대기 필요"
  aws ec2 wait nat-gateway-available --nat-gateway-ids "$NAT_ID"
fi

# ── Route tables — public/private/db ──
ensure_rt() {
  local name="$1"
  local id=$(aws ec2 describe-route-tables \
    --filters "Name=vpc-id,Values=$VPC_ID" "Name=tag:Name,Values=${name}" \
    --query 'RouteTables[0].RouteTableId' --output text 2>/dev/null || echo "None")
  if [ "$id" = "None" ]; then
    id=$(aws ec2 create-route-table --vpc-id "$VPC_ID" \
      --tag-specifications "ResourceType=route-table,Tags=[{Key=Name,Value=${name}}]" \
      --query RouteTable.RouteTableId --output text)
  fi
  echo "$id"
}
PUB_RT=$(ensure_rt "${NAME_PREFIX}-public-rt")
PRV_RT=$(ensure_rt "${NAME_PREFIX}-private-rt")
DB_RT=$( ensure_rt "${NAME_PREFIX}-db-rt")

# Public 라우트: 0.0.0.0/0 → IGW
aws ec2 create-route --route-table-id "$PUB_RT" --destination-cidr-block 0.0.0.0/0 \
  --gateway-id "$IGW_ID" 2>/dev/null || true
aws ec2 associate-route-table --subnet-id "$PUB_A" --route-table-id "$PUB_RT" 2>/dev/null || true
aws ec2 associate-route-table --subnet-id "$PUB_B" --route-table-id "$PUB_RT" 2>/dev/null || true

# Private 라우트: 0.0.0.0/0 → NAT (ECS task 가 외부 LLM/ECR/E2B 접근하려면 필수)
aws ec2 create-route --route-table-id "$PRV_RT" --destination-cidr-block 0.0.0.0/0 \
  --nat-gateway-id "$NAT_ID" 2>/dev/null || true
aws ec2 associate-route-table --subnet-id "$PRV_A" --route-table-id "$PRV_RT" 2>/dev/null || true
aws ec2 associate-route-table --subnet-id "$PRV_B" --route-table-id "$PRV_RT" 2>/dev/null || true

# DB 라우트: 외부 없음 (내부만)
aws ec2 associate-route-table --subnet-id "$DB_A" --route-table-id "$DB_RT" 2>/dev/null || true
aws ec2 associate-route-table --subnet-id "$DB_B" --route-table-id "$DB_RT" 2>/dev/null || true

# ── 2) Security Groups ──
mk_sg() {
  local name="${NAME_PREFIX}-$1" desc="$2"
  local id=$(aws ec2 describe-security-groups --filters "Name=group-name,Values=${name}" \
             --query 'SecurityGroups[0].GroupId' --output text)
  if [ "$id" = "None" ]; then
    id=$(aws ec2 create-security-group --group-name "$name" --description "$desc" \
         --vpc-id "$VPC_ID" --query GroupId --output text)
  fi
  echo "$id"
}
SG_ALB=$(mk_sg "alb-sg" "ALB ingress")
SG_SVR=$(mk_sg "server-sg" "ECS server")
SG_WEB=$(mk_sg "web-sg" "ECS web")
SG_WRK=$(mk_sg "worker-sg" "ECS converter-worker")
SG_RDS=$(mk_sg "rds-sg" "RDS Postgres")
SG_RED=$(mk_sg "redis-sg" "ElastiCache Redis")
SG_BAS=$(mk_sg "bastion-sg" "SSM bastion (no inbound; uses SSM session manager)")

aws ec2 authorize-security-group-ingress --group-id "$SG_ALB" --protocol tcp --port 443 --cidr 0.0.0.0/0 2>/dev/null || true
aws ec2 authorize-security-group-ingress --group-id "$SG_SVR" --protocol tcp --port 4000 --source-group "$SG_ALB" 2>/dev/null || true
aws ec2 authorize-security-group-ingress --group-id "$SG_WEB" --protocol tcp --port 3000 --source-group "$SG_ALB" 2>/dev/null || true
aws ec2 authorize-security-group-ingress --group-id "$SG_WRK" --protocol tcp --port 8000 --source-group "$SG_SVR" 2>/dev/null || true
aws ec2 authorize-security-group-ingress --group-id "$SG_RDS" --protocol tcp --port 5432 --source-group "$SG_SVR" 2>/dev/null || true
aws ec2 authorize-security-group-ingress --group-id "$SG_RDS" --protocol tcp --port 5432 --source-group "$SG_WRK" 2>/dev/null || true
aws ec2 authorize-security-group-ingress --group-id "$SG_RDS" --protocol tcp --port 5432 --source-group "$SG_BAS" 2>/dev/null || true
aws ec2 authorize-security-group-ingress --group-id "$SG_RED" --protocol tcp --port 6379 --source-group "$SG_SVR" 2>/dev/null || true
aws ec2 authorize-security-group-ingress --group-id "$SG_RED" --protocol tcp --port 6379 --source-group "$SG_WRK" 2>/dev/null || true
aws ec2 authorize-security-group-ingress --group-id "$SG_RED" --protocol tcp --port 6379 --source-group "$SG_BAS" 2>/dev/null || true
# bastion-sg 자체는 ingress 없음 — SSM Session Manager 가 outbound HTTPS 만 사용

# ── 3) RDS ──
DB_SG="${NAME_PREFIX}-db-subnet-group"
aws rds create-db-subnet-group --db-subnet-group-name "$DB_SG" \
  --db-subnet-group-description "${NAME_PREFIX} db subnets" \
  --subnet-ids "$DB_A" "$DB_B" 2>/dev/null || true

RDS_ID="${NAME_PREFIX}-postgres"
if ! aws rds describe-db-instances --db-instance-identifier "$RDS_ID" > /dev/null 2>&1; then
  DB_PASS=$(openssl rand -base64 32 | tr -d '/+=' | head -c 32)
  aws secretsmanager create-secret --name "${PROJECT}/${ENV}/database-password" \
    --secret-string "$DB_PASS" > /dev/null 2>&1 || \
    aws secretsmanager update-secret --secret-id "${PROJECT}/${ENV}/database-password" \
      --secret-string "$DB_PASS" > /dev/null
  aws rds create-db-instance \
    --db-instance-identifier "$RDS_ID" \
    --db-instance-class "$DB_CLASS" \
    --engine postgres --engine-version 16 \
    --allocated-storage 20 --storage-encrypted \
    --master-username "${DB_MASTER_USERNAME:-{{DB_MASTER_USERNAME}}}" --master-user-password "$DB_PASS" \
    --db-name "${PROJECT}_${ENV}" \
    --vpc-security-group-ids "$SG_RDS" \
    --db-subnet-group-name "$DB_SG" \
    --backup-retention-period 7 \
    $( [ "$MULTI_AZ" = "true" ] && echo "--multi-az" ) > /dev/null
fi
# pgvector 확장은 첫 마이그레이션에서 CREATE EXTENSION

# ── 4) ElastiCache Redis ──
CACHE_SG="${NAME_PREFIX}-redis-subnet-group"
aws elasticache create-cache-subnet-group --cache-subnet-group-name "$CACHE_SG" \
  --cache-subnet-group-description "${NAME_PREFIX} redis subnets" \
  --subnet-ids "$DB_A" "$DB_B" 2>/dev/null || true

REDIS_ID="${NAME_PREFIX}-redis"
aws elasticache describe-cache-clusters --cache-cluster-id "$REDIS_ID" > /dev/null 2>&1 || \
  aws elasticache create-cache-cluster --cache-cluster-id "$REDIS_ID" \
    --cache-node-type "$REDIS_CLASS" --engine redis --engine-version 7.0 \
    --num-cache-nodes 1 --port 6379 \
    --cache-subnet-group-name "$CACHE_SG" \
    --security-group-ids "$SG_RED" > /dev/null

# ── 5) ECR repositories ──
for REPO in {{PROJECT_SLUG}}-server {{PROJECT_SLUG}}-web {{PROJECT_SLUG}}-converter-worker; do
  aws ecr describe-repositories --repository-names "$REPO" > /dev/null 2>&1 || \
    aws ecr create-repository --repository-name "$REPO" \
      --image-scanning-configuration scanOnPush=true \
      --image-tag-mutability IMMUTABLE > /dev/null
done

# ── 6) S3 buckets ──
# us-east-1 은 LocationConstraint 를 받지 않음 (default region). 그 외 region 만 LocationConstraint 사용.
if [ "$REGION" = "us-east-1" ]; then
  CREATE_OPTS=()
else
  CREATE_OPTS=(--create-bucket-configuration "LocationConstraint=$REGION")
fi
for BUCKET in "${NAME_PREFIX}-uploads" "${NAME_PREFIX}-artifacts" "${NAME_PREFIX}-skills" "${NAME_PREFIX}-logs"; do
  aws s3api head-bucket --bucket "$BUCKET" 2>/dev/null || {
    aws s3api create-bucket --bucket "$BUCKET" --region "$REGION" \
      "${CREATE_OPTS[@]}" > /dev/null
    aws s3api put-bucket-encryption --bucket "$BUCKET" \
      --server-side-encryption-configuration \
      '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'
    aws s3api put-public-access-block --bucket "$BUCKET" \
      --public-access-block-configuration \
      "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true"
    aws s3api put-bucket-versioning --bucket "$BUCKET" \
      --versioning-configuration Status=Enabled
  }
done

# ── 7) ECS Cluster ──
aws ecs describe-clusters --clusters "${NAME_PREFIX}" \
  --query 'clusters[?status==`ACTIVE`].clusterName' --output text | grep -q "$NAME_PREFIX" || \
  aws ecs create-cluster --cluster-name "${NAME_PREFIX}" \
    --capacity-providers FARGATE FARGATE_SPOT > /dev/null

# ── 8) ALB ──
ALB_ARN=$(aws elbv2 describe-load-balancers --names "${NAME_PREFIX}-alb" \
  --query 'LoadBalancers[0].LoadBalancerArn' --output text 2>/dev/null || echo "None")
if [ "$ALB_ARN" = "None" ]; then
  # 신규 생성 — 결과 ARN 을 ALB_ARN 에 다시 담아야 함 (이전 버전: create 후 ALB_ARN 갱신 누락 → SSM 에 'None' 저장 위험).
  ALB_ARN=$(aws elbv2 create-load-balancer --name "${NAME_PREFIX}-alb" \
    --subnets "$PUB_A" "$PUB_B" \
    --security-groups "$SG_ALB" --type application --scheme internet-facing \
    --query 'LoadBalancers[0].LoadBalancerArn' --output text)
  [ -z "$ALB_ARN" ] || [ "$ALB_ARN" = "None" ] && { echo "❌ ALB 생성 실패"; exit 1; }
fi

# Target groups + listeners — deploy.sh 가 추가

# ── 9) IAM roles + policy attach ──
# migrator-task: deploy.sh / first-deploy.sh § one-off migrator task 가 사용 (DATABASE_URL_MIGRATOR secret 읽기 + DB DDL 권한).
# 11 § 부록 D 의 migrator-task.json 본문이 본 role 의 inline policy.
for ROLE in "${PROJECT}-ecs-execution" "${PROJECT}-server-task" "${PROJECT}-web-task" "${PROJECT}-converter-task" "${PROJECT}-migrator-task"; do
  aws iam get-role --role-name "$ROLE" > /dev/null 2>&1 || \
    aws iam create-role --role-name "$ROLE" \
      --assume-role-policy-document \
      '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"ecs-tasks.amazonaws.com"},"Action":"sts:AssumeRole"}]}' > /dev/null
done
# 9a) execution role: ECR pull + CloudWatch Logs + Secrets Manager 읽기 (AWS managed)
aws iam attach-role-policy --role-name "${PROJECT}-ecs-execution" \
  --policy-arn arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy 2>/dev/null || true
# Secrets Manager 읽기 권한 — execution role 이 secrets ARN 에서 환경변수 inject
EXEC_SECRETS_POLICY=$(mktemp)
cat > "$EXEC_SECRETS_POLICY" <<JSON
{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Action":["secretsmanager:GetSecretValue","kms:Decrypt"],"Resource":"arn:aws:secretsmanager:${REGION}:${ACCOUNT}:secret:${PROJECT}/${ENV}/*"}]}
JSON
aws iam put-role-policy --role-name "${PROJECT}-ecs-execution" \
  --policy-name "${PROJECT}-${ENV}-secrets-read" \
  --policy-document "file://$EXEC_SECRETS_POLICY"
rm -f "$EXEC_SECRETS_POLICY"

# 9b) task role 들의 inline policy — § 부록 D 에 풀 본문. 본 스크립트는 파일이 있으면 attach.
for ROLE_KIND in server-task web-task converter-task; do
  POLICY_FILE="infra/aws/iam/${ROLE_KIND}.json"
  if [ -f "$POLICY_FILE" ]; then
    aws iam put-role-policy --role-name "${PROJECT}-${ROLE_KIND}" \
      --policy-name "${PROJECT}-${ENV}-${ROLE_KIND}" \
      --policy-document "file://$POLICY_FILE"
  else
    echo "  ⚠️  $POLICY_FILE 없음 — task role policy 미적용 (배포 후 추가 필요)"
  fi
done

# ── 10) Secrets Manager — placeholder + 자동 채울 수 있는 것은 실제 값으로 ──
# 10a) DB password 는 이미 § 3 RDS 단계에서 생성됨 (${PROJECT}/${ENV}/database-password)

# 10a-pre) RDS instance available 까지 wait (endpoint 조회 전에 ready 보장 — 신규 생성 시 5~10 분)
echo "==> waiting for RDS instance $RDS_ID to be available (max 15 분)..."
aws rds wait db-instance-available --db-instance-identifier "$RDS_ID"
echo "==> RDS ready"

# 10b) DATABASE_URL — RDS endpoint + password 조합으로 자동 채움.
# v1.0: master credential 로 app_user / migrator_user 두 role 을 생성 + GRANT 후, 두 secret 을 각 role credential 로 분리 저장.
# 06 § 0001 FORCE ROW LEVEL SECURITY 가 두 role 모두에 적용 — RLS policy 우회 차단.
DB_HOST=$(aws rds describe-db-instances --db-instance-identifier "$RDS_ID" \
  --query 'DBInstances[0].Endpoint.Address' --output text 2>/dev/null || echo "")
DB_PASS_VAL=$(aws secretsmanager get-secret-value --secret-id "${PROJECT}/${ENV}/database-password" \
  --query 'SecretString' --output text 2>/dev/null || echo "")
if [ -n "$DB_HOST" ] && [ -n "$DB_PASS_VAL" ]; then
  DB_NAME="${PROJECT}_${ENV}"
  DB_MASTER="${DB_MASTER_USERNAME:-{{DB_MASTER_USERNAME}}}"

  # 10b-1) master credential 로 두 role 생성 + GRANT (idempotent).
  # 두 role 의 password 는 별도 secret 에서 자동 생성 — master 와 분리.
  APP_PASS=$(aws secretsmanager get-secret-value --secret-id "${PROJECT}/${ENV}/db-app-password" --query 'SecretString' --output text 2>/dev/null \
            || (NEW=$(openssl rand -base64 32 | tr -d '\n=+/'); aws secretsmanager create-secret --name "${PROJECT}/${ENV}/db-app-password" --secret-string "$NEW" > /dev/null; echo "$NEW"))
  MIG_PASS=$(aws secretsmanager get-secret-value --secret-id "${PROJECT}/${ENV}/db-migrator-password" --query 'SecretString' --output text 2>/dev/null \
            || (NEW=$(openssl rand -base64 32 | tr -d '\n=+/'); aws secretsmanager create-secret --name "${PROJECT}/${ENV}/db-migrator-password" --secret-string "$NEW" > /dev/null; echo "$NEW"))

  # bastion 또는 ECS exec 로 SQL bootstrap 실행 — 11 § 부록 G2 본문.
  # 본 단계는 idempotent: 두 role 이 이미 존재하면 GRANT 만 재적용.
  cat > /tmp/setup-db-roles.sql <<SQL
DO \$\$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='app_user') THEN
    CREATE ROLE app_user LOGIN PASSWORD '${APP_PASS}';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='migrator_user') THEN
    CREATE ROLE migrator_user LOGIN PASSWORD '${MIG_PASS}';
  END IF;
END \$\$;
-- app_user: DML 만 (모든 public schema 의 table 에 SELECT/INSERT/UPDATE/DELETE)
GRANT CONNECT ON DATABASE "${DB_NAME}" TO app_user;
GRANT USAGE ON SCHEMA public TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO app_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE ON SEQUENCES TO app_user;
-- migrator_user: DDL + DML
GRANT CONNECT ON DATABASE "${DB_NAME}" TO migrator_user;
GRANT ALL ON SCHEMA public TO migrator_user;
GRANT ALL ON ALL TABLES IN SCHEMA public TO migrator_user;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO migrator_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO migrator_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO migrator_user;
-- 보안: BYPASSRLS 권한 부여 안 함. master 는 BYPASSRLS 보유하므로 일상 사용 금지.
SQL
  # 실제 실행은 bastion SSM tunnel 또는 ECS exec 으로 — v1.0 는 setup-infra 가 SQL 파일만 생성, 운영자가 수동 실행 후 다음 단계 진행.
  echo "==> SQL bootstrap 파일 생성: /tmp/setup-db-roles.sql"
  echo "    수동 실행: psql -h $DB_HOST -U $DB_MASTER -d $DB_NAME -f /tmp/setup-db-roles.sql"
  # BASTION_ID 는 § 11) 단계에서 만들어짐 — 본 § 10b 시점엔 아직 unbound 가능. set -u 안전: default ":-(bastion not created yet)" guard.
  echo "    또는 bastion SSM session 으로: aws ssm start-session --target ${BASTION_ID:-<bastion-id-will-be-set-in-step-11>} 후 psql 실행"

  # 10b-2) 두 connection string — 별 user credential.
  APP_URL="postgres://app_user:${APP_PASS}@${DB_HOST}:5432/${DB_NAME}?sslmode=require"
  MIG_URL="postgres://migrator_user:${MIG_PASS}@${DB_HOST}:5432/${DB_NAME}?sslmode=require"
  aws secretsmanager describe-secret --secret-id "${PROJECT}/${ENV}/database-url" > /dev/null 2>&1 \
    && aws secretsmanager update-secret --secret-id "${PROJECT}/${ENV}/database-url" --secret-string "$APP_URL" > /dev/null \
    || aws secretsmanager create-secret --name "${PROJECT}/${ENV}/database-url" --secret-string "$APP_URL" > /dev/null
  aws secretsmanager describe-secret --secret-id "${PROJECT}/${ENV}/db-migrator-url" > /dev/null 2>&1 \
    && aws secretsmanager update-secret --secret-id "${PROJECT}/${ENV}/db-migrator-url" --secret-string "$MIG_URL" > /dev/null \
    || aws secretsmanager create-secret --name "${PROJECT}/${ENV}/db-migrator-url" --secret-string "$MIG_URL" > /dev/null
fi

# 10c-pre) ElastiCache available 까지 wait (신규 생성 시 5~10 분)
echo "==> waiting for ElastiCache $REDIS_ID to be available..."
aws elasticache wait cache-cluster-available --cache-cluster-id "$REDIS_ID"
echo "==> ElastiCache ready"

# 10c) REDIS_URL — endpoint 알면 자동 채움
REDIS_EP=$(aws elasticache describe-cache-clusters --cache-cluster-id "$REDIS_ID" \
  --show-cache-node-info --query 'CacheClusters[0].CacheNodes[0].Endpoint.Address' --output text 2>/dev/null || echo "")
if [ -n "$REDIS_EP" ]; then
  REDIS_URL_VAL="redis://${REDIS_EP}:6379"
  aws secretsmanager describe-secret --secret-id "${PROJECT}/${ENV}/redis-url" > /dev/null 2>&1 \
    && aws secretsmanager update-secret --secret-id "${PROJECT}/${ENV}/redis-url" --secret-string "$REDIS_URL_VAL" > /dev/null \
    || aws secretsmanager create-secret --name "${PROJECT}/${ENV}/redis-url" --secret-string "$REDIS_URL_VAL" > /dev/null
fi

# 10d) JWT_SECRET 자동 생성 (없을 때만)
aws secretsmanager describe-secret --secret-id "${PROJECT}/${ENV}/jwt-secret" > /dev/null 2>&1 || \
  aws secretsmanager create-secret --name "${PROJECT}/${ENV}/jwt-secret" \
    --secret-string "$(openssl rand -base64 48 | tr -d '\n')" > /dev/null

# 10e) 외부 API 키 — placeholder. 운영자가 콘솔에서 실제 값 입력 후 deploy.
for SECRET in anthropic openai gemini voyage tavily e2b; do
  aws secretsmanager describe-secret --secret-id "${PROJECT}/${ENV}/${SECRET}" > /dev/null 2>&1 || \
    aws secretsmanager create-secret --name "${PROJECT}/${ENV}/${SECRET}" \
      --secret-string "__PLACEHOLDER_PLEASE_REPLACE__" > /dev/null
done

# ── 10f) Cloud Map (Service Discovery) namespace + service ──
# server → converter-worker 는 ECS service registry 로 호출. namespace + service 정의가 필요.
NS_NAME="${PROJECT}-${ENV}.local"
NS_ID=$(aws servicediscovery list-namespaces \
  --filters "Name=TYPE,Values=DNS_PRIVATE" \
  --query "Namespaces[?Name=='${NS_NAME}'].Id" --output text)
if [ -z "$NS_ID" ] || [ "$NS_ID" = "None" ]; then
  OP_ID=$(aws servicediscovery create-private-dns-namespace \
    --name "$NS_NAME" --vpc "$VPC_ID" --query 'OperationId' --output text)
  # operation 완료 대기 (간단 polling — 보통 30~60s)
  for i in $(seq 1 30); do
    STAT=$(aws servicediscovery get-operation --operation-id "$OP_ID" --query 'Operation.Status' --output text)
    [ "$STAT" = "SUCCESS" ] && break
    sleep 5
  done
  NS_ID=$(aws servicediscovery list-namespaces \
    --filters "Name=TYPE,Values=DNS_PRIVATE" \
    --query "Namespaces[?Name=='${NS_NAME}'].Id" --output text)
fi

# converter-worker discovery service (server 가 'converter-worker.<ns>' 로 호출)
SD_NAME="converter-worker"
SD_ARN=$(aws servicediscovery list-services \
  --filters "Name=NAMESPACE_ID,Values=${NS_ID}" \
  --query "Services[?Name=='${SD_NAME}'].Arn" --output text 2>/dev/null || echo "")
if [ -z "$SD_ARN" ] || [ "$SD_ARN" = "None" ]; then
  aws servicediscovery create-service \
    --name "$SD_NAME" \
    --namespace-id "$NS_ID" \
    --dns-config "NamespaceId=${NS_ID},RoutingPolicy=MULTIVALUE,DnsRecords=[{Type=A,TTL=60}]" \
    --health-check-custom-config FailureThreshold=1 > /dev/null
fi

# first-deploy.sh 가 ECS service create 시점에 --service-registries arn=$SD_ARN 로 연결.
# 본 스크립트는 namespace + service 만 만들고, service 등록은 first-deploy 에 위임.

# ── 11) SSM bastion EC2 (dev/staging 만; prod 는 별도 정책으로 결정) ──
# 목적: 개발자가 RDS/Redis private subnet 에 접근하기 위한 SSM port-forward 대상.
# 비용 최소화 위해 t4g.nano + Amazon Linux 2023 (SSM Agent 사전 설치) + IMDSv2 강제.
BASTION_ROLE="${PROJECT}-bastion-ssm"
aws iam get-role --role-name "$BASTION_ROLE" > /dev/null 2>&1 || \
  aws iam create-role --role-name "$BASTION_ROLE" \
    --assume-role-policy-document \
    '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"ec2.amazonaws.com"},"Action":"sts:AssumeRole"}]}' > /dev/null
aws iam attach-role-policy --role-name "$BASTION_ROLE" \
  --policy-arn arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore 2>/dev/null || true
aws iam get-instance-profile --instance-profile-name "$BASTION_ROLE" > /dev/null 2>&1 || {
  aws iam create-instance-profile --instance-profile-name "$BASTION_ROLE" > /dev/null
  aws iam add-role-to-instance-profile --instance-profile-name "$BASTION_ROLE" --role-name "$BASTION_ROLE"
  sleep 8  # IAM 인스턴스 프로파일 propagation
}

BASTION_NAME="${NAME_PREFIX}-bastion"
BASTION_ID=$(aws ec2 describe-instances \
  --filters "Name=tag:Name,Values=${BASTION_NAME}" "Name=instance-state-name,Values=running,pending,stopped" \
  --query 'Reservations[0].Instances[0].InstanceId' --output text 2>/dev/null || echo "None")

if [ "$BASTION_ID" = "None" ] || [ -z "$BASTION_ID" ]; then
  # Amazon Linux 2023 ARM AMI (region 별 latest) — SSM parameter 로 조회
  AMI_ID=$(aws ssm get-parameter \
    --name /aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-arm64 \
    --query 'Parameter.Value' --output text)
  BASTION_ID=$(aws ec2 run-instances \
    --image-id "$AMI_ID" \
    --instance-type t4g.nano \
    --subnet-id "$PUB_A" \
    --security-group-ids "$SG_BAS" \
    --iam-instance-profile "Name=${BASTION_ROLE}" \
    --metadata-options "HttpTokens=required,HttpPutResponseHopLimit=2,HttpEndpoint=enabled" \
    --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=${BASTION_NAME}},{Key=Project,Value=${PROJECT}},{Key=Env,Value=${ENV}}]" \
    --query 'Instances[0].InstanceId' --output text)
fi

# ── 12) SSM Parameter Store (tunnel.sh 가 읽는 값) ──
RDS_ENDPOINT=$(aws rds describe-db-instances --db-instance-identifier "$RDS_ID" \
  --query 'DBInstances[0].Endpoint.Address' --output text 2>/dev/null || echo "")
REDIS_ENDPOINT=$(aws elasticache describe-cache-clusters --cache-cluster-id "$REDIS_ID" \
  --show-cache-node-info --query 'CacheClusters[0].CacheNodes[0].Endpoint.Address' \
  --output text 2>/dev/null || echo "")

put_param() {
  local name="$1" value="$2"
  [ -z "$value" ] && return 0
  aws ssm put-parameter --name "$name" --value "$value" --type String --overwrite > /dev/null
}
put_param "/${PROJECT}/${ENV}/bastion/instance-id" "$BASTION_ID"
put_param "/${PROJECT}/${ENV}/rds/host"            "$RDS_ENDPOINT"
put_param "/${PROJECT}/${ENV}/redis/host"          "$REDIS_ENDPOINT"
# deploy.sh § expand migrate (one-off ECS task) 의존 — private subnet 과 ECS task SG 명시 export.
# 변수명은 본 스크립트 § 3) 의 create-subnet 결과 ($PRV_A/$PRV_B), § 6) mk_sg 결과 ($SG_SVR — migrator 도 server SG 재사용, RDS ingress 동일 의존).
put_param "/${PROJECT}/${ENV}/private-subnet-a"    "$PRV_A"
put_param "/${PROJECT}/${ENV}/private-subnet-b"    "$PRV_B"
put_param "/${PROJECT}/${ENV}/ecs-task-sg"         "$SG_SVR"   # migrator 는 server SG 재사용 (RDS:5432 ingress 필요)
put_param "/${PROJECT}/${ENV}/alb-arn"             "$ALB_ARN"
put_param "/${PROJECT}/${ENV}/vpc-id"              "$VPC_ID"

echo "==> [${ENV}] setup-infra done."
echo "    bastion: $BASTION_ID  rds: $RDS_ENDPOINT  redis: $REDIS_ENDPOINT"
echo "    subnet-a: $PRV_A  task-sg(server): $SG_SVR  alb: $ALB_ARN"
echo "    다음: bash infra/aws/first-deploy.sh ${ENV} <git-sha>   # 첫 배포 (migrator → service create + ALB wiring)"
```

> 본 스크립트가 만드는 리소스 ~35개 (bastion EC2 + IAM 인스턴스 프로파일 + SSM 파라미터 8개 포함 — bastion/rds/redis + private-subnet-a/b + ecs-task-sg + alb-arn + vpc-id). Route table 연결 / Target group / Listener 등은 첫 first-deploy.sh 가 수행. v1.1+ 에서 Terraform 으로 마이그레이션 시 본 스크립트가 reference.
>
> **bastion 정책**: dev/staging 환경의 RDS/Redis private subnet 접근용. prod 는 운영 정책에 따라 별도 결정 (필요 시 동일 스크립트를 prod 에 실행하거나 생략). SSM Session Manager 사용 → SSH key·22 포트 불필요, IAM 로 접근 제어.

## 부록 F · Dockerfile 3개 본문

### `infra/docker/server.Dockerfile`

```dockerfile
# syntax=docker/dockerfile:1.7
FROM node:22-bookworm-slim AS deps
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.29.3 --activate
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json tsconfig.base.json ./
COPY apps/server/package.json apps/server/
COPY packages/shared/package.json packages/shared/
COPY packages/interfaces/package.json packages/interfaces/
# HUSKY=0: root package.json 의 `prepare: husky` 가 build context 의 .git 없이 fail — Docker build 차단.
ENV HUSKY=0
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile \
    --filter @{{PROJECT_SLUG}}/server... --filter @{{PROJECT_SLUG}}/shared --filter @{{PROJECT_SLUG}}/interfaces

FROM deps AS build
COPY packages packages
COPY apps/server apps/server
RUN pnpm --filter @{{PROJECT_SLUG}}/shared build && \
    pnpm --filter @{{PROJECT_SLUG}}/interfaces build && \
    pnpm --filter @{{PROJECT_SLUG}}/server build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl wget && \
    rm -rf /var/lib/apt/lists/*
# ECS Exec 가 migrate/seed 실행할 수 있도록 corepack + pnpm 활성화 (§ 부록 D ECS Exec 4-condition)
RUN corepack enable && corepack prepare pnpm@10.29.3 --activate
# LibreOffice 설치 금지 — L17 (converter-worker 로 분리)
RUN groupadd -r app && useradd -r -g app -d /app app
COPY --from=build --chown=app:app /app/node_modules /app/node_modules
COPY --from=build --chown=app:app /app/apps/server /app/apps/server
COPY --from=build --chown=app:app /app/packages /app/packages
COPY --from=build --chown=app:app /app/pnpm-workspace.yaml /app/package.json /app/turbo.json ./
# drizzle-kit (devDep) 가 ECS Exec migrate 의 의존 — production install 에 포함되도록 위 COPY 가 node_modules 통째 복사.
USER app
ENV NODE_ENV=production PORT=4000
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -q -O- http://localhost:4000/health || exit 1
CMD ["node", "apps/server/dist/index.js"]
```

### `infra/docker/web.Dockerfile`

```dockerfile
# syntax=docker/dockerfile:1.7
FROM node:22-bookworm-slim AS deps
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.29.3 --activate
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json tsconfig.base.json ./
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
ENV HUSKY=0
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter @{{PROJECT_SLUG}}/web... --filter @{{PROJECT_SLUG}}/shared

FROM deps AS build
ARG NEXT_PUBLIC_API_BASE
ARG NEXT_PUBLIC_APP_NAME={{PROJECT_NAME}}
ENV NEXT_PUBLIC_API_BASE=$NEXT_PUBLIC_API_BASE
ENV NEXT_PUBLIC_APP_NAME=$NEXT_PUBLIC_APP_NAME
COPY packages packages
COPY apps/web apps/web
RUN pnpm --filter @{{PROJECT_SLUG}}/shared build && \
    pnpm --filter @{{PROJECT_SLUG}}/web build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates wget && rm -rf /var/lib/apt/lists/*
RUN groupadd -r app && useradd -r -g app -d /app app
COPY --from=build --chown=app:app /app/apps/web/.next/standalone /app
COPY --from=build --chown=app:app /app/apps/web/.next/static /app/apps/web/.next/static
COPY --from=build --chown=app:app /app/apps/web/public /app/apps/web/public
USER app
ENV NODE_ENV=production PORT=3000
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -q -O- http://localhost:3000/ || exit 1
CMD ["node", "apps/web/server.js"]
```

### `infra/docker/converter-worker.Dockerfile`

```dockerfile
# syntax=docker/dockerfile:1.7
FROM python:3.12-bookworm AS runtime
WORKDIR /app

# LibreOffice + 한글 fonts (L17 — 본 worker 만 사용, server 는 사용 금지)
RUN apt-get update && apt-get install -y --no-install-recommends \
    libreoffice-impress libreoffice-writer libreoffice-calc \
    fonts-nanum fonts-noto-cjk \
    curl ca-certificates && \
    rm -rf /var/lib/apt/lists/*

RUN groupadd -r app && useradd -r -g app -d /app app

COPY apps/converter-worker/pyproject.toml apps/converter-worker/poetry.lock* /app/
RUN pip install --no-cache-dir poetry==1.8.0 && \
    poetry config virtualenvs.create false && \
    poetry install --no-root --no-interaction --no-ansi

COPY --chown=app:app apps/converter-worker/src /app/src

USER app
ENV PORT=8000
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -fsS http://localhost:8000/health || exit 1
CMD ["uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

> 3개 모두 multi-stage + non-root user + healthcheck. CI 의 `docker-build` job (15) 이 `--platform linux/amd64` 로 buildx push.

---

## 부록 H · 첫 배포 (target group / listener / service create) — `infra/aws/first-deploy.sh`

setup-infra.sh 가 만든 인프라 위에 ALB target group / listener / ECS service 를 처음 만드는 스크립트. 한 번만 실행 (이후 deploy.sh 가 update).

```bash
#!/usr/bin/env bash
# infra/aws/first-deploy.sh — 신규 환경의 첫 배포 (target group/listener/service create)
# 사용법: AWS_PROFILE=ci-prod ACM_CERT_ARN=arn:... bash infra/aws/first-deploy.sh prod <git-sha>
set -euo pipefail

ENV="${1:?env required}"
TAG="${2:?image tag required}"
REGION="${AWS_REGION:-{{AWS_REGION}}}"
PROJECT="${PROJECT_SLUG:-{{PROJECT_SLUG}}}"
NAME_PREFIX="${PROJECT}-${ENV}"

# Fail-closed preflight — deploy mode (setup-infra 가 secret 채운 후의 진입)
bash "$(dirname "$0")/../../scripts/aws-preflight.sh" "$ENV" deploy

ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
ECR="${ACCOUNT}.dkr.ecr.${REGION}.amazonaws.com"

VPC_ID=$(aws ec2 describe-vpcs --filters "Name=tag:Name,Values=${NAME_PREFIX}-vpc" --query 'Vpcs[0].VpcId' --output text)
ALB_ARN=$(aws elbv2 describe-load-balancers --names "${NAME_PREFIX}-alb" --query 'LoadBalancers[0].LoadBalancerArn' --output text)
SUBNETS=( $(aws ec2 describe-subnets --filters "Name=tag:Name,Values=${NAME_PREFIX}-private-*" --query 'Subnets[].SubnetId' --output text) )
SG_SVR=$(aws ec2 describe-security-groups --filters "Name=group-name,Values=${NAME_PREFIX}-server-sg" --query 'SecurityGroups[0].GroupId' --output text)
SG_WEB=$(aws ec2 describe-security-groups --filters "Name=group-name,Values=${NAME_PREFIX}-web-sg" --query 'SecurityGroups[0].GroupId' --output text)
SG_WRK=$(aws ec2 describe-security-groups --filters "Name=group-name,Values=${NAME_PREFIX}-worker-sg" --query 'SecurityGroups[0].GroupId' --output text)

# 1) Target groups
mk_tg() {
  local name="$1" port="$2" health="$3"
  aws elbv2 describe-target-groups --names "$name" --query 'TargetGroups[0].TargetGroupArn' --output text 2>/dev/null || \
    aws elbv2 create-target-group --name "$name" --protocol HTTP --port "$port" \
      --vpc-id "$VPC_ID" --target-type ip --health-check-path "$health" \
      --health-check-interval-seconds 30 --healthy-threshold-count 2 \
      --query 'TargetGroups[0].TargetGroupArn' --output text
}
TG_SVR=$(mk_tg "${NAME_PREFIX}-server-tg" 4000 "/health")
TG_WEB=$(mk_tg "${NAME_PREFIX}-web-tg"    3000 "/")

# 2) HTTPS Listener + path rules
CERT_ARN="${ACM_CERT_ARN:?ACM_CERT_ARN 필요}"
LISTENER_ARN=$(aws elbv2 describe-listeners --load-balancer-arn "$ALB_ARN" \
  --query 'Listeners[?Port==`443`].ListenerArn | [0]' --output text 2>/dev/null || echo "None")
if [ "$LISTENER_ARN" = "None" ]; then
  LISTENER_ARN=$(aws elbv2 create-listener --load-balancer-arn "$ALB_ARN" \
    --protocol HTTPS --port 443 --certificates "CertificateArn=$CERT_ARN" \
    --ssl-policy ELBSecurityPolicy-TLS13-1-2-2021-06 \
    --default-actions "Type=forward,TargetGroupArn=$TG_WEB" \
    --query 'Listeners[0].ListenerArn' --output text)
fi
# Path rules — idempotent: 존재하면 target group 검증, 없으면 create. fail-open 금지.
add_rule() {
  local priority="$1" pattern="$2" tg_arn="$3"
  # 같은 priority 가 이미 있는지 확인
  EXISTING=$(aws elbv2 describe-rules --listener-arn "$LISTENER_ARN" \
    --query "Rules[?Priority=='${priority}'].{arn:RuleArn,tg:Actions[0].TargetGroupArn,cond:Conditions[0].Values[0]}" \
    --output json 2>/dev/null)
  if [ "$EXISTING" = "[]" ]; then
    # 신규 — 생성. 실패 시 즉시 stop (fail-closed).
    aws elbv2 create-rule --listener-arn "$LISTENER_ARN" --priority "$priority" \
      --conditions "Field=path-pattern,Values=$pattern" \
      --actions "Type=forward,TargetGroupArn=$tg_arn" > /dev/null
    echo "    ✓ ALB rule p$priority created: $pattern → ${tg_arn##*/}"
  else
    # 존재 — target group + pattern 일치 검증. mismatch 면 fail (덮어쓰기 금지, 운영자 개입 필요).
    EXISTING_TG=$(echo "$EXISTING" | jq -r '.[0].tg')
    EXISTING_COND=$(echo "$EXISTING" | jq -r '.[0].cond')
    if [ "$EXISTING_TG" != "$tg_arn" ] || [ "$EXISTING_COND" != "$pattern" ]; then
      echo "❌ ALB rule p$priority drift — expected: ($pattern → $tg_arn), got: ($EXISTING_COND → $EXISTING_TG). 운영자가 console 에서 정리 필요."
      exit 1
    fi
    echo "    ✓ ALB rule p$priority already correct: $pattern → ${tg_arn##*/}"
  fi
}
add_rule 10 "/health"         "$TG_SVR"
add_rule 20 "/api/v1/share/*" "$TG_SVR"
add_rule 30 "/api/*"          "$TG_SVR"
# /share/* 와 / 는 default (web target)

# 3) ECS services 생성 (각각 1회)
TASK_DEF_RENDER() {
  local f="$1"
  sed -e "s|__ACCOUNT__|${ACCOUNT}|g" -e "s|__ECR_REGISTRY__|${ECR}|g" -e "s|__SHA__|${TAG}|g" \
    "infra/aws/task-definitions/${f}.${ENV}.json"
}

REV_SVR=$(TASK_DEF_RENDER server | aws ecs register-task-definition --cli-input-json file:///dev/stdin \
  --query 'taskDefinition.revision' --output text)
REV_WEB=$(TASK_DEF_RENDER web    | aws ecs register-task-definition --cli-input-json file:///dev/stdin \
  --query 'taskDefinition.revision' --output text)
REV_WRK=$(TASK_DEF_RENDER converter-worker | aws ecs register-task-definition --cli-input-json file:///dev/stdin \
  --query 'taskDefinition.revision' --output text)
REV_MIG=$(TASK_DEF_RENDER migrator | aws ecs register-task-definition --cli-input-json file:///dev/stdin \
  --query 'taskDefinition.revision' --output text)

# 4a) one-off migrator 먼저 실행 — 빈 DB 에 schema 초기화. service create 전 완료 보장.
# (이전 v1.0 에선 service 먼저 만들고 migrate 했으나, 빈 DB 위에서 app task 가 startup probe 실패 →
#  CrashLoopBackOff 형태로 service stable 도달 못 함. 본 순서 변경으로 first-deploy 안정화.)
echo "[first-deploy] launching initial migrator task (schema bootstrap)…"
# SG: migrator 는 server SG 재사용 — RDS:5432 ingress 동일 의존 ([setup-infra § 6 mk_sg](#부록-e--scriptssetup-infrash) 와 일관).
# Command override: drizzle migrate. migrator task def 의 default ("pnpm","db:migrate:expand") 와 동일 effect — 두 wrapper 모두 drizzle migrate 호출.
# DATABASE_URL_MIGRATOR 가 secret 으로 주입 — db-migrate-expand.ts 가 우선 (DATABASE_URL_MIGRATOR), 없으면 DATABASE_URL fallback.
MIGRATE_ARN=$(aws ecs run-task --cluster "$NAME_PREFIX" \
  --task-definition "${NAME_PREFIX}-migrator:${REV_MIG}" --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[${SUBNETS[0]},${SUBNETS[1]}],securityGroups=[$SG_SVR],assignPublicIp=DISABLED}" \
  --overrides '{"containerOverrides":[{"name":"migrator","command":["pnpm","db:migrate:expand"]}]}' \
  --query 'tasks[0].taskArn' --output text)
aws ecs wait tasks-stopped --cluster "$NAME_PREFIX" --tasks "$MIGRATE_ARN"
EXIT_CODE=$(aws ecs describe-tasks --cluster "$NAME_PREFIX" --tasks "$MIGRATE_ARN" \
            --query 'tasks[0].containers[0].exitCode' --output text)
if [ "$EXIT_CODE" != "0" ]; then
  echo "❌ initial migrate 실패 (exit=${EXIT_CODE}) — service create 차단"
  exit 1
fi
echo "✓ initial migrate 완료 (task ${MIGRATE_ARN##*/}). 이제 service create 안전."

# 4b) service create — 이제 schema 가 존재해 app task 가 startup probe 통과 가능.
# --enable-execute-command 필수: CI 의 db:migrate / db:seed 가 ECS Exec 로 server 컨테이너에 진입.
# task role (server-task) 에 ssmmessages:CreateControlChannel, OpenDataChannel, OpenControlChannel + s3 도 필요 (§ 부록 D).
aws ecs create-service --cluster "$NAME_PREFIX" --service-name "${NAME_PREFIX}-server" \
  --task-definition "${NAME_PREFIX}-server:${REV_SVR}" --desired-count 2 --launch-type FARGATE \
  --enable-execute-command \
  --network-configuration "awsvpcConfiguration={subnets=[${SUBNETS[0]},${SUBNETS[1]}],securityGroups=[$SG_SVR],assignPublicIp=DISABLED}" \
  --load-balancers "targetGroupArn=$TG_SVR,containerName=server,containerPort=4000" > /dev/null

aws ecs create-service --cluster "$NAME_PREFIX" --service-name "${NAME_PREFIX}-web" \
  --task-definition "${NAME_PREFIX}-web:${REV_WEB}" --desired-count 2 --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[${SUBNETS[0]},${SUBNETS[1]}],securityGroups=[$SG_WEB],assignPublicIp=DISABLED}" \
  --load-balancers "targetGroupArn=$TG_WEB,containerName=web,containerPort=3000" > /dev/null

# Cloud Map service ARN — setup-infra § 10f 가 이미 만들었으므로 조회만.
NS_ID=$(aws servicediscovery list-namespaces --filters "Name=TYPE,Values=DNS_PRIVATE" \
  --query "Namespaces[?Name=='${NAME_PREFIX}.local'].Id" --output text)
SD_ARN=$(aws servicediscovery list-services --filters "Name=NAMESPACE_ID,Values=${NS_ID}" \
  --query "Services[?Name=='converter-worker'].Arn" --output text)
[ -z "$SD_ARN" ] && { echo "❌ Cloud Map service 'converter-worker' 없음 — setup-infra.sh 먼저 실행"; exit 1; }

# converter-worker service: 다른 service 와 달리 ALB 미연결, Cloud Map 으로 service discovery 노출
aws ecs create-service --cluster "$NAME_PREFIX" --service-name "${NAME_PREFIX}-converter-worker" \
  --task-definition "${NAME_PREFIX}-converter-worker:${REV_WRK}" --desired-count 1 --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[${SUBNETS[0]},${SUBNETS[1]}],securityGroups=[$SG_WRK],assignPublicIp=DISABLED}" \
  --service-registries "registryArn=${SD_ARN},containerName=converter-worker,containerPort=8000" > /dev/null

# server 는 환경변수 CONVERTER_WORKER_URL=http://converter-worker.{{PROJECT_SLUG}}-{env}.local:8000 으로 호출.

# 5) Wait + smoke
aws ecs wait services-stable --cluster "$NAME_PREFIX" \
  --services "${NAME_PREFIX}-server" "${NAME_PREFIX}-web" "${NAME_PREFIX}-converter-worker"

# 6) Route53 ALIAS — APP_DOMAIN_{ENV} → ALB
if [ -n "${ROUTE53_ZONE_ID:-}" ]; then
  case "$ENV" in
    prod)    APP_DOMAIN="{{APP_DOMAIN_PROD}}" ;;
    staging) APP_DOMAIN="{{APP_DOMAIN_STAGING}}" ;;
    dev)     APP_DOMAIN="{{APP_DOMAIN_DEV}}" ;;
  esac
  ALB_HOST=$(aws elbv2 describe-load-balancers --load-balancer-arns "$ALB_ARN" \
    --query 'LoadBalancers[0].DNSName' --output text)
  ALB_HOSTED_ZONE=$(aws elbv2 describe-load-balancers --load-balancer-arns "$ALB_ARN" \
    --query 'LoadBalancers[0].CanonicalHostedZoneId' --output text)
  aws route53 change-resource-record-sets --hosted-zone-id "$ROUTE53_ZONE_ID" \
    --change-batch "$(cat <<JSON
{
  "Changes": [{
    "Action": "UPSERT",
    "ResourceRecordSet": {
      "Name": "${APP_DOMAIN}",
      "Type": "A",
      "AliasTarget": {
        "HostedZoneId": "${ALB_HOSTED_ZONE}",
        "DNSName": "${ALB_HOST}",
        "EvaluateTargetHealth": true
      }
    }
  }]
}
JSON
    )" > /dev/null
  echo "  Route53: ${APP_DOMAIN} → ${ALB_HOST}"
else
  echo "  ⚠️  ROUTE53_ZONE_ID 미설정 — DNS alias 수동 등록 필요"
fi

# 7) DB migrate (첫 배포 후 빈 DB 에 schema 생성) + seed (dev/staging 만)
TASK_ARN=$(aws ecs list-tasks --cluster "$NAME_PREFIX" \
  --service-name "${NAME_PREFIX}-server" --query 'taskArns[0]' --output text)
aws ecs execute-command --cluster "$NAME_PREFIX" --task "$TASK_ARN" \
  --container server --interactive --command "pnpm db:migrate"
if [ "$ENV" != "prod" ]; then
  aws ecs execute-command --cluster "$NAME_PREFIX" --task "$TASK_ARN" \
    --container server --interactive \
    --command "SMOKE_EMAIL_LOCAL=${SMOKE_EMAIL_LOCAL:-smoke-test} SMOKE_PASSWORD=${SMOKE_PASSWORD:?} pnpm db:seed"
fi

bash scripts/smoke-test.sh "$ENV"
echo "✓ first-deploy 완료. 이후 update 는 deploy.sh."
```

## 부록 I · 라우트 테이블 (참고용 — `setup-infra.sh` 본문에 이미 포함됨)

> setup-infra.sh 의 NAT/IGW/Route table 본문이 통합됨 (부록 E § 1). 본 부록은 동일 SQL/CLI 흐름의 참고 자료. 새로 실행할 필요 없음.

setup-infra.sh 의 6번 단계 (Subnets 생성) 직후 다음 호출이 실제 운영에 필요:

```bash
# Public route table — 0.0.0.0/0 → IGW
PUB_RT=$(aws ec2 create-route-table --vpc-id "$VPC_ID" \
  --tag-specifications "ResourceType=route-table,Tags=[{Key=Name,Value=${NAME_PREFIX}-public-rt}]" \
  --query RouteTable.RouteTableId --output text)
aws ec2 create-route --route-table-id "$PUB_RT" --destination-cidr-block 0.0.0.0/0 \
  --gateway-id "$IGW_ID"
aws ec2 associate-route-table --subnet-id "$PUB_A" --route-table-id "$PUB_RT"
aws ec2 associate-route-table --subnet-id "$PUB_B" --route-table-id "$PUB_RT"

# Private route table — 0.0.0.0/0 → NAT
PRV_RT=$(aws ec2 create-route-table --vpc-id "$VPC_ID" \
  --tag-specifications "ResourceType=route-table,Tags=[{Key=Name,Value=${NAME_PREFIX}-private-rt}]" \
  --query RouteTable.RouteTableId --output text)
# NAT gateway 의 ID 받기 (위에서 만든)
NAT_ID=$(aws ec2 describe-nat-gateways --filter "Name=vpc-id,Values=$VPC_ID" \
  --query 'NatGateways[0].NatGatewayId' --output text)
aws ec2 create-route --route-table-id "$PRV_RT" --destination-cidr-block 0.0.0.0/0 \
  --nat-gateway-id "$NAT_ID"
aws ec2 associate-route-table --subnet-id "$PRV_A" --route-table-id "$PRV_RT"
aws ec2 associate-route-table --subnet-id "$PRV_B" --route-table-id "$PRV_RT"

# DB route table — 외부 X (내부만)
DB_RT=$(aws ec2 create-route-table --vpc-id "$VPC_ID" \
  --tag-specifications "ResourceType=route-table,Tags=[{Key=Name,Value=${NAME_PREFIX}-db-rt}]" \
  --query RouteTable.RouteTableId --output text)
aws ec2 associate-route-table --subnet-id "$DB_A" --route-table-id "$DB_RT"
aws ec2 associate-route-table --subnet-id "$DB_B" --route-table-id "$DB_RT"
```

위 본문을 `setup-infra.sh` 의 1번 단계 (VPC) 와 2번 (SG) 사이에 삽입.

## 부록 G · `docker-compose.local.yml` (완전 로컬 dev 경로)

> AWS 없이 노트북에서만 개발할 때 사용. `pnpm tunnel` 대신 이 compose 로 pgvector + redis 를 띄움.
> 첫 quickstart (05 § Phase 0 quickstart 의 옵션 B) 가 이걸 가리킴.

```yaml
# docker-compose.local.yml
services:
  postgres:
    image: pgvector/pgvector:pg16
    environment:
      POSTGRES_USER: {{PROJECT_SLUG}}
      POSTGRES_PASSWORD: localdev
      POSTGRES_DB: {{PROJECT_SLUG}}_dev
    ports: ["5432:5432"]
    volumes: ["pgdata:/var/lib/postgresql/data"]
    healthcheck:
      test: ["CMD", "pg_isready", "-U", "{{PROJECT_SLUG}}"]
      interval: 5s
      timeout: 5s
      retries: 10

  redis:
    image: redis:7-alpine
    ports: ["6379:6379"]
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s

volumes:
  pgdata:
```

사용:
```bash
docker compose -f docker-compose.local.yml up -d
# .env.local 의 DATABASE_URL=postgres://{{PROJECT_SLUG}}:localdev@localhost:5432/{{PROJECT_SLUG}}_dev
# .env.local 의 REDIS_URL=redis://localhost:6379
pnpm db:migrate && pnpm db:seed && pnpm dev
```

> 운영 환경엔 사용 안 함 — Fargate + RDS + ElastiCache 가 유일한 prod 경로.

