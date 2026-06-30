# 12 · Ops & Security — 운영/보안/관측

## 보안 모델

### 인증 (Authentication)
- HttpOnly cookie + JWT (15분 access + 30일 refresh)
- 도메인 검증: `*@{{ORG_DOMAIN}}` 만 (L08)
- 사내 SSO 통합은 v1.1 (OIDC, SAML 차후)
- 매직 링크 or 비밀번호 (해시: bcrypt cost 12)

### 권한 (Authorization)
4계층 모델 (L05):
1. **System** — 모델 내장
2. **Project** — 조직/프로젝트 관리자
3. **User** — 본인 영구 지시사항 (메모리)
4. **Tool** — 도구 결과 메타데이터

API 레벨 권한:
- RLS (PostgreSQL row-level security) — `current_setting('app.user_id')`, `app.org_id`
- middleware/rls-context.ts 가 모든 요청에 SET LOCAL
- 도구 정책 (policy-engine.ts) — org/project/user 별 도구 허용/HITL/거부

### 데이터 보호
- TLS 1.3 (ALB ACM 인증서, 만료 자동 갱신)
- S3 SSE (또는 KMS CMK)
- RDS encryption at rest (KMS)
- 비밀: AWS Secrets Manager + IAM role (코드/env 에 평문 없음)
- 사용자 PII (이메일, 이름): DB 저장만, 로그/메트릭에는 user_id 만

### 입력 검증
- 모든 API 입력: Zod 스키마 (packages/shared/schemas/)
- SQL injection: Drizzle parameterized query (raw query 금지, ESLint rule)
- XSS: React 의 기본 escape + Markdown sanitizer
- CSRF: same-site cookie + custom header check

### 외부 호출 안전 (SSRF — L16)
- `apps/server/src/mcp/url-validator.ts` 가 모든 MCP URL 검증:
  - RFC-1918 차단 (10.0.0.0/8, 172.16/12, 192.168/16) default
  - localhost / 127.0.0.0/8 차단
  - 메타데이터 IP (169.254.169.254) 차단
  - 명시적 화이트리스트 CIDR (`MCP_ALLOWED_INTERNAL_CIDRS=10.20.0.0/16`)
- `web-fetch` 도구도 동일 validator 적용

### 컨테이너/이미지 보안
- ECR 이미지 immutable (tag overwrite 금지)
- trivy CVE scan: high → 배포 차단
- Base image: pinned digest (`node:22.x.y@sha256:...`)
- Multi-stage build, distroless 또는 alpine

### Sandbox 격리 (L11)
- E2B 외부 sandbox — 서버 host 와 무관
- Sandbox 안에서 egress: domain whitelist (서버측 proxy 옵션)
- 시간/메모리/CPU limit 강제 (E2B side)

## 관측 (Observability)

### Logs

#### 구조화 (L07)
모든 로그는 typed object:

```typescript
logger.info({
  category: "tool",
  tool: "knowledge_search",
  duration_ms: 234,
  user_id: ctx.userId,
  org_id: ctx.orgId,
  request_id: ctx.requestId,
  msg: "knowledge search ok",
});
```

#### Categories (enum)
`auth | tool | db | mcp | sandbox | rate-limit | external-api | parser | orchestrator | http | system`

#### Levels
`debug | info | warn | error | fatal`

#### 보존
- CloudWatch Logs: 90일 (운영) / 1년 (audit)
- 장기 보존 필요한 audit 은 S3 archive (Glacier)

### Metrics

Custom metrics (CloudWatch PutMetricData, namespace `{{PROJECT_NAME_PASCAL}}`):

| Metric | Dimensions |
|---|---|
| `request_count` | route, status |
| `request_duration_ms` | route, status, percentile |
| `tool_calls_total` | tool, status, org |
| `tool_call_duration_ms` | tool, percentile |
| `llm_tokens_total` | provider, model, direction (in/out) |
| `llm_request_duration_ms` | provider, model, percentile |
| `llm_error_total` | provider, error_type |
| `e2b_sandbox_lifecycle` | event (start/stop/timeout), status |
| `mcp_tool_calls` | server, tool, status |
| `quota_remaining_micros` | user_id |
| `error_logs_total` | category, level |

### Traces
- OpenTelemetry SDK + AWS X-Ray
- 모든 request 에 trace_id 부여 (`request-context.ts` middleware)
- LLM 호출, DB 쿼리, 외부 API 호출은 별도 span

### Alarms (SNS → Slack `{{ALERT_SLACK_CHANNEL}}`)

| Alarm | 조건 | 액션 |
|---|---|---|
| Server 5xx | rate > 1% (5min) | on-call page |
| LLM provider down | error > 50% (5min) | on-call + fallback 자동 |
| E2B failure | failure > 30% (10min) | sandbox 재시작 + on-call |
| RDS CPU | > 85% (10min) | scale-up 검토 |
| Redis memory | > 85% (5min) | scale-up 검토 |
| Disk free | < 10% | host 교체 |
| ALB target unhealthy | > 0 (1min) | auto-replace task |
| Quota near limit | user.used > 90% | 사용자 알림 |
| Cost anomaly | day-on-day > 200% | finance 알림 |
| Auth bruteforce | failed login > 50 (1min, per IP) | block IP |

## 운영 절차

### On-call rotation
- T1 Platform 주도, 다른 팀 1주씩 rotation
- on-call 책임:
  - 알람 수신 → 5분 내 응답
  - incident 진단 → 회사 정책에 따라 escalate
  - 임시 mitigation 적용 (롤백, traffic shift)
  - post-mortem 24시간 내

### Runbooks
`docs/runbooks/` 디렉토리:
- `incident-server-5xx-spike.md`
- `incident-llm-provider-down.md`
- `incident-rds-failover.md`
- `incident-e2b-quota-exceeded.md`
- `runbook-rollback.md`
- `runbook-database-restore.md`
- `runbook-secret-rotation.md`

각 runbook 형식:
```
# Incident: <title>
## 증상
## 즉시 mitigation (5분 안에)
## 진단 (10~30분)
## 근본 수정
## 회고 link
```

### Post-mortem
- Blameless culture: 사람이 아닌 시스템에 초점
- Template: `docs/postmortems/<date>-<title>.md`
  - Timeline
  - Root cause (5 whys)
  - Impact
  - Action items (각각 owner + due date)
- 매월 1회 review meeting

## 비용 운영

### 비용 가시성
- AWS Cost Explorer + Tag 기반 분리 (`Environment`, `Project={{PROJECT_SLUG}}`)
- 매주 cost report Slack 발송

### 비용 최적화 액션
- Reserved Instance / Savings Plan (RDS, ECS)
- Spot Fargate (worker, dev)
- LLM cost-aware routing
- S3 lifecycle (Glacier 전환)
- Idle sandbox aggressive shutdown (E2B)

### Quota 정책
- 사용자별 기본 budget: 100K 토큰/월 (org admin 이 override 가능)
- budget 90% 시 사용자 알림
- 100% 도달 시 사용자에게 LLM 호출 거부
- 비상시 admin 이 emergency budget 부여

## 데이터 보존 & 삭제

| 데이터 | 보존 | 정책 |
|---|---|---|
| 메시지 | 90일 (default) | org 별 override 가능 |
| 메모리 | 영구 (사용자 삭제까지) | |
| 업로드 (S3) | 30일 | lifecycle |
| Artifact | 90일 | 공유 링크 활성이면 expires_at 까지 |
| Artifact share | expires_at (max 90일) | 만료 후 즉시 410 |
| Usage logs | 1년 | audit |
| Error logs | 90일 (운영) / 1년 (audit) | |
| Health history | 30일 | |

### GDPR/사용자 삭제 요청
- `DELETE /api/v1/auth/me` 엔드포인트 ([16-API-CONTRACT.md § 1 Auth](16-API-CONTRACT.md) 단일 출처)
- 30일 grace period 후 hard delete (cascade)
- 메시지/세션은 anonymize (`user_id=deleted_user_*`)

## Audit Log (v1.1+)

v1.0 에서는 usage_logs + error_logs 로 대체. v1.1 에서 별도 immutable audit_logs:
- 모든 도구 호출
- 모든 LLM 호출 (prompt 첫 500자만)
- 모든 admin 액션
- 모든 권한 변경
- S3 (또는 별도 immutable storage) 로 daily archive

## 컴플라이언스

- 데이터: 사내 RDS (Korea region), 외부 LLM 호출은 API 만 (데이터 학습 거부 헤더)
- LLM provider 별 Data Processing Agreement (DPA) 확인:
  - Anthropic: training opt-out
  - OpenAI: zero data retention enterprise
- 비밀번호 정책: bcrypt cost 12, 8자+, 사내 정책에 따라 조정

## Incident severity levels

- **SEV1**: 전체 down or 데이터 유실 — 5분 응답
- **SEV2**: 핵심 기능 장애 (인증, 메시지) — 15분 응답
- **SEV3**: 부분 장애 (한 도구 fail) — 1시간 응답
- **SEV4**: 미세 영향 — 다음 영업일

## 보안 정기 점검

- 분기 1회: 비밀번호/토큰 회전
- 분기 1회: trivy + semgrep + gitleaks 전체 audit
- 반기 1회: 침투 테스트 (외부 또는 사내 보안팀)
- 연 1회: DR drill (재해 복구 실전)

---

## 부록 A · JWT claim 구조

`apps/server/src/middleware/jwt.ts` 단일 출처.

### Access token (15분)
```json
{
  "iss": "{{PROJECT_SLUG}}",
  "sub": "<userId-uuid>",
  "org": "<orgId-uuid>",
  "role": "member|admin|owner",
  "scope": "access",
  "iat": 1716100000,
  "exp": 1716100900,
  "jti": "<random>"
}
```

### Refresh token (30일)
```json
{
  "iss": "{{PROJECT_SLUG}}",
  "sub": "<userId-uuid>",
  "scope": "refresh",
  "iat": 1716100000,
  "exp": 1718692000,
  "jti": "<random>",
  "family": "<rotation-family-uuid>"
}
```

### 서명/저장
- Algorithm: **HS256** (v1.0). `JWT_SECRET` 은 Secrets Manager, 분기 회전.
- 저장: **HttpOnly + Secure + SameSite=Lax cookie**
  - 이름: `{{PROJECT_SLUG}}_at` (access), `{{PROJECT_SLUG}}_rt` (refresh)
  - path: `/` (access), `/api/v1/auth/refresh` (refresh)
  - 도메인: `.{{ORG_DOMAIN}}` (sub-domain 공유)
- Refresh rotation: refresh 사용 시 같은 family 안에서 새 token 발급, 이전 token 즉시 무효. 가족 단위 도난 감지 (한 family 의 동시 사용 → 전체 family revoke).

### 발급 흐름
1. POST `/api/v1/auth/login` (email + password 또는 magic link)
2. 이메일 도메인 검증: `*@{{ORG_DOMAIN}}` 만 허용 (L08)
3. password: bcrypt cost 12
4. access + refresh 둘 다 발급, Set-Cookie 2개
5. 응답 body = `AuthMeResponse` (`{ user: AuthUser, org: AuthOrganization }`) — [16-API-CONTRACT § 부록 A AuthMeResponse](16-API-CONTRACT.md) 와 단일 출처. token 은 cookie 전용, body 노출 X.

### 검증 미들웨어
- `Cookie: {{PROJECT_SLUG}}_at=...` 추출 → verify → `ctx.{userId, orgId, role}` 주입 (server 내부 RequestContext 의 필드 — wire-level response 와 별개).
- 만료 시 401 + `WWW-Authenticate: refresh`. 클라이언트가 자동 `/refresh` 호출.
- refresh 도 만료/revoke 시 강제 로그아웃 (cookie 제거).

### v1.1 (out of scope)
- 사내 SSO (OIDC) — {{ORG_NAME}} IdP 가 발급한 JWT 를 {{PROJECT_NAME}} access token 으로 swap

---

## 부록 B · SSRF validator 알고리즘 (`apps/server/src/mcp/url-validator.ts`)

목적: MCP 서버 등록 시 + `web_fetch` 도구 호출 시 URL 안전성 검증.

### 단계
```
1. URL parse: new URL(input)
   - 실패 시 throw INVALID_URL

2. Protocol allowlist: ["https:"]
   - dev 환경에 한해 ["http:", "https:"]
   - 외에는 throw PROTOCOL_NOT_ALLOWED

3. Hostname 추출 (반드시 punycode 정규화)

4. Hostname → IP 해석 (DNS resolve)
   - dns.lookup({hostname, all: true})
   - resolved IP 목록 반환

5. 각 IP 에 대해 cidr check:
   denyList = [
     "0.0.0.0/8",          # this network
     "10.0.0.0/8",         # private (denyList 기본 — 화이트리스트 통해서만 허용)
     "127.0.0.0/8",        # loopback
     "169.254.0.0/16",     # link-local + metadata
     "172.16.0.0/12",      # private
     "192.168.0.0/16",     # private
     "198.18.0.0/15",      # benchmarking
     "224.0.0.0/4",        # multicast
     "240.0.0.0/4",        # reserved
     # IPv6
     "::1/128",            # loopback
     "fc00::/7",           # private
     "fe80::/10",          # link-local
     "ff00::/8",           # multicast
   ]
   allowList = parseCidrEnv("MCP_ALLOWED_INTERNAL_CIDRS")  # 예: ["10.20.0.0/16"]

   if ip ∈ allowList: continue
   if ip ∈ denyList:  throw INTERNAL_IP_FORBIDDEN

6. DNS rebinding 보호:
   - resolved IP 목록을 caller 에게 함께 반환
   - HTTP client 가 connection 시 그 IP 로 명시 binding (Node http.Agent 의 lookup 옵션)
   - host header 는 원래 URL 의 hostname 유지

7. timeout: 5초 (DNS) + 10초 (request)
```

### 테스트 케이스
```
http://example.com/foo               → INVALID (http 차단, prod)
https://localhost/                   → INTERNAL_IP_FORBIDDEN
https://127.0.0.1/                   → INTERNAL_IP_FORBIDDEN
https://10.20.5.10/                  → OK (화이트리스트)
https://10.0.0.1/                    → INTERNAL_IP_FORBIDDEN (화이트리스트 외)
https://[::1]/                       → INTERNAL_IP_FORBIDDEN
https://internal-only.local/         → DNS resolve 결과에 따라 결정
https://attacker.com → CNAME → 10.0.0.5  → INTERNAL_IP_FORBIDDEN
https://attacker.com (rebinding 의도, A 레코드 TTL=0)  → 첫 resolve 시 OK / connection 시 같은 IP 강제
```

### 호출 정책
- `web_fetch` 도구는 매 호출마다 validator 통과 의무 (캐시 없음)
- MCP 서버 등록 시 1회 통과 + 매 호출마다 health check 시 재검증

---

## 부록 C · Runbook — SEV1: 서버 5xx Spike

`docs/runbooks/incident-server-5xx-spike.md`

### 증상
- CloudWatch alarm `Server 5xx — rate > 1% 5min` 발생
- 사용자가 채팅에서 "오류가 발생했습니다" 토스트
- Slack `{{ALERT_SLACK_CHANNEL}}` 알림

### 즉시 mitigation (5분 안에)
1. CloudWatch Logs Insights:
   ```
   fields @timestamp, level, category, msg, request_id, path
   | filter level in ["error","fatal"]
   | filter @timestamp > ago(10m)
   | stats count() by category, msg
   | sort count desc
   ```
2. 카테고리 분포 확인:
   - `external-api` 다수 → LLM/외부 dep 장애 → 부록 D (LLM down) 으로 escalate
   - `db` 다수 → RDS 상태 확인 (`CPUUtilization`, `FreeableMemory`) → 부록 E
   - `tool/sandbox` 다수 → E2B 상태 확인
   - 알 수 없음 → 직전 배포 의심 → 3단계
3. 직전 30분 배포 있었나? (`aws ecs describe-services --cluster {{PROJECT_SLUG}}-prod`)
   - 있으면: `bash scripts/rollback.sh prod`
   - smoke 통과 확인 → 알람 해제 대기 (5~10분)
4. 그래도 해소 안 되면 SEV1 escalate (전화 on-call lead)

### 진단 (10~30분)
- 위 query 의 request_id 1개 골라 trace
- DB query 시간, LLM latency, S3 호출 횟수 확인
- 5xx 의 응답 본문 sample 확인

### 근본 수정
- 원인 PR 식별 → revert PR 또는 hot-fix PR
- `docs/postmortems/<date>-server-5xx.md` 작성

---

## 부록 D · Runbook — SEV1: LLM Provider Down

`docs/runbooks/incident-llm-provider-down.md`

### 증상
- `external-api` 카테고리 에러 > 50% (5min)
- LLM 응답 stream timeout

### 즉시 mitigation (5분)
1. provider 별 분포 확인:
   ```
   filter category = "external-api"
   | stats count() by msg, provider
   ```
2. Anthropic status (`status.anthropic.com`) 확인
3. fallback provider 강제:
   - `apps/server` 의 ENV `FORCE_LLM_PROVIDER=openai` 또는 `gemini` 추가
   - `aws ecs update-service --force-new-deployment` (~3분)
4. 사용자에게 banner 노출 (web/app 의 status 페이지 업데이트)

### 진단/수정
- provider 가 long down 이면 cost-aware routing 일시 비활성 → 모든 요청 fallback
- 복구 후 routing 재활성, banner 제거

---

## 부록 E · Runbook — SEV2: RDS CPU 고

`docs/runbooks/incident-rds-cpu-high.md`

### 증상
- `RDS CPU > 85% 10분` alarm

### 즉시 mitigation
1. Performance Insights 확인: top SQL by CPU
2. slow query 가 있는가? → `pg_stat_statements`
3. 단순 traffic spike 라면: read replica 추가 검토 or instance class 일시 scale-up
4. slow query 원인 식별:
   - 인덱스 미스 → 임시 인덱스 추가
   - N+1 쿼리 → 코드 수정 PR

### 알람 해소
- CPU < 50% 5분 지속 → close

---

## 부록 F · Runbook — SEV2: E2B Quota Exceeded

`docs/runbooks/incident-e2b-quota-exceeded.md`

### 증상
- `e2b_sandbox_lifecycle status=quota_exceeded` 메트릭
- 사용자에게 "sandbox 시작 실패" 에러

### 즉시 mitigation
1. E2B dashboard → 현재 quota usage 확인
2. 다른 환경 (staging) 의 sandbox 정리 (수동 stop)
3. 필요 시 E2B 영업에 quota 증액 요청
4. 일시적으로 sandbox 의무 도구 (`bash`, `create_file`) deny 정책 → 사용자에게는 "잠시 후 다시 시도" 안내

### 진단
- 단순 traffic spike? → quota 증액
- sandbox leak (stop 누락)? → 코드 fix + warm pool 정책 재검토

---

## 부록 G · Runbook 형식 (모든 신규 runbook 의 template)

`docs/runbooks/_TEMPLATE.md`:

```markdown
# Incident: <title>
**Severity**: SEV1/2/3/4
**Symptoms**:
- alarm: ...
- 사용자 영향: ...

**즉시 mitigation (5분 안에)**:
1. ...

**진단 (10~30분)**:
- ...

**근본 수정**:
- ...

**알람 해소 조건**:
- ...

**Postmortem 링크**: docs/postmortems/...
```

---

## 부록 H · 데이터 retention job (I4 보완)

위치: `apps/server/src/lib/data-retention.ts`
실행: 매일 03:00 KST cron (in-process, node-cron 또는 별도 scheduled task)

```ts
async function runRetention(da: DataAccess) {
  // 1. expired artifact_shares → 410 (logical delete)
  await da.artifactShares.list({ expiresAtLt: new Date() }).then(...);

  // 2. 30일 지난 uploads (S3 lifecycle 보조)
  await artifactStore.cleanupExpired();

  // 3. 90일 지난 messages (org 별 retention override 적용)
  // ... (org.retention_days 컬럼 추가 필요 — v1.1)

  // 4. 90일 지난 error_logs (운영 retention 외)
  await da.errorLogs.deleteOlderThan(90);

  // 5. 30일 지난 health_history
  await da.healthHistory.deleteOlderThan(30);
}
```

실패 시 alert → `{{ALERT_SLACK_CHANNEL}}`. partial 실패 허용 (각 단계 try/catch).

