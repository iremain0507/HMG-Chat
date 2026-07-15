---
name: run-local
description: 로컬 W-Chat 앱(web+server+DB+redis) 기동·검증·접속. 서비스를 띄우거나 테스트 환경을 올릴 때 사용.
---

# 로컬 W-Chat 기동 런북 (LOCAL_ONLY)

## 언제 쓰나

W-Chat 로컬 스택(web:3000 + server:4000 + Postgres/pgvector:5432 + redis:6379, 옵션 converter-worker:8000)을 띄우고 헬스 검증 후 로그인해 조작할 때.

## 1) Preflight — 이미 떠 있는 것부터 확인

```bash
lsof -ti tcp:3000   # web (Next 15)
lsof -ti tcp:4000   # server (Hono)
lsof -ti tcp:5432   # postgres/pgvector
lsof -ti tcp:6379   # redis
# DB가 wchat_dev + pgvector 를 갖췄는지 (1 이면 OK)
PGPASSWORD=localdev psql -h localhost -U wchat -d wchat_dev -tAc "select count(*) from pg_extension where extname='vector'"
```

- 경고: DB 이름은 **`wchat_dev`** 다. `wchat` 아님.
- 경고: 포트 죽이기 전 소유 프로세스 확인. **3000 을 다른 프로젝트의 Next v16 서버가 점유**할 수 있다. W-Chat 은 **Next 15.0.0** 이고 프로세스 cwd 가 이 repo 하위다. `lsof -ti tcp:3000` PID 의 cwd 를 확인하고 **W-Chat 것만** 죽인다.

## 2) 의존성(DB+Redis) 기동

```bash
# 경로 A: Docker (docker-compose.local.yml = pgvector/pgvector:pg16 + redis:7-alpine)
docker compose -f docker-compose.local.yml up -d
# 경로 B: 이 머신은 Homebrew postgresql@16 + redis 가 이미 5432/6379 를 서빙(wchat_dev+pgvector, ~28 tables) → 별도 기동 불필요
# 둘 중 무엇이든 5432=wchat_dev(pgvector), 6379=redis 면 유효.
```

이어서 (필요 시):

```bash
cp .env.local.example .env.local   # .env.local 없을 때만(이 머신엔 이미 존재). apps/server/.env.local 도 필요.
pnpm install        # node_modules 없거나 lockfile 갱신 시
pnpm db:migrate     # drizzle-kit 마이그레이션 적용
```

## 3) 앱 기동

```bash
pnpm dev            # turbo run dev --parallel → web:3000 + server:4000 (+ shared/interfaces tsc --watch)
# pnpm dev:full     # 위 + Python converter-worker:8000 (문서변환/업로드 필요 시)
```

- 첫 `/login` 요청은 라우트 그래프 컴파일로 **~26s** 걸린다(이후 즉시). 첫 curl 타임아웃을 넉넉히.

## 4) Verify — 스모크 테스트 (그대로 복붙)

```bash
# 서버 헬스 → 200
curl -s -o /dev/null -w '%{http_code}\n' localhost:4000/health
# 웹 /login → 200 (첫 컴파일 지연 허용: --max-time 60)
curl -s -o /dev/null -w '%{http_code}\n' --max-time 60 localhost:3000/login
# 프록시(web→server) ping → {"ok":true,"env":...}
curl -s localhost:3000/api/v1/_ping
# dev 로그인 → 302 + Set-Cookie: wchat_at / wchat_rt
curl -si localhost:3000/api/v1/auth/dev-login | grep -Ei 'HTTP/|set-cookie'
```

- 헬스 경로는 `/health` 와 `/api/v1/_ping` 이다. **`/api/v1/health` 아님**.

## 5) 로그인 & 조작

- 브라우저로 http://localhost:3000 접속 → `/login` 페이지의 **dev-login 링크** 클릭(또는 직접 `http://localhost:3000/api/v1/auth/dev-login` 이동).
- Dev User(`dev@wchat.dev`, role **owner**, Dev Org)로 로그인 → 302 `/` + HttpOnly 쿠키 `wchat_at`(15m)/`wchat_rt`(30d) 설정.
- dev-login 은 `NODE_ENV!==production` 일 때만 활성(prod 는 404).
- 외부접속: Tailscale `http://<tailscale-ip>:3000`(예: http://100.101.234.112:3000). next dev 가 전 인터페이스 바인딩 + auth 리다이렉트가 **상대경로**라 Tailscale 호스트가 보존된다(localhost 로 튕기지 않음).

## 6) 정지

```bash
pkill -f 'turbo run dev'   # dev 스택(web+server) 종료
```

- DB/Redis(Homebrew)는 그대로 유지된다. Docker 경로면 `docker compose -f docker-compose.local.yml down`.

## 7) 게이트/테스트 (선택)

```bash
bash scripts/verify-gates.sh    # typecheck+lint+test+state (커밋 오라클, exit 0 필수)
bash scripts/verify-browser.sh  # Playwright /preview (격리 포트 3100)
```

- verify-gates 는 내장 타임아웃이 없다. 미종료 SSE ReadableStream 이 vitest 를 멈출 수 있어 `scripts/loop-watchdog.sh` 가 방어. macOS 엔 GNU `timeout` 없음.

## 8) Troubleshooting

| 증상                                  | 원인 → 조치                                                                                                                         |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `EADDRINUSE` 3000/4000                | 포트 점유. `lsof -ti tcp:3000` 로 PID 확인, cwd 가 이 repo 인 **W-Chat 프로세스만** kill(다른 프로젝트 Next v16 이 3000 점유 가능). |
| 웹이 000/404 (기동 직후)              | 아직 컴파일 중. 잠시 후 `--max-time 60` 으로 재시도.                                                                                |
| `database "wchat_dev" does not exist` | DB 이름 오타(`wchat` 아님) 또는 DB 미기동. Preflight/2) 재확인, `pnpm db:migrate`.                                                  |
| SSE 중 "연결이 끊어졌습니다"          | server 다운 또는 프록시 gzip 버퍼링. server 기동 확인 + `apps/web/next.config.ts` 의 `compress:false` 유지(SSE 미버퍼).             |

## 참고

- LOCAL_ONLY 스텁: 실 Voyage 임베딩 / S3 오브젝트스토어 / E2B 샌드박스 / Tavily 검색은 dev-stub·in-memory fake 로 대체. AWS 배포 시 실 provider 로 교체.
- Env 파일은 **읽거나 커밋하지 말 것**: root `.env.local` + `apps/server/.env.local`(PORT/DATABASE_URL/REDIS_URL/JWT/LOCAL_ONLY provider), `apps/web/.env.local`(옵션).
