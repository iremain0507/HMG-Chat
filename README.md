# WChat

개인/사내용 AI 채팅 어시스턴트 (RAG·도구·아티팩트)

## 30분 onboarding (Phase 0 · 인프라/툴체인 부트스트랩)

Phase 0 acceptance 는 인프라/툴체인 부트스트랩만 검증합니다. 로그인/메시지 흐름은
Phase 1(auth) + Phase 2(sessions/messages) 통과 이후부터 검증 대상입니다.

```
00:00  laptop 켜기
00:02  git clone https://github.com/iremain0507/wchat
00:03  bash scripts/setup-git.sh    → email 입력
00:04  pnpm install                  (캐시 hit 30s, miss 시 ~2분)
00:08  cp .env.local.example .env.local            # Phase 0 default (시나리오 B). secret stub 포함, 수정 불요.
       # 시나리오 A (SSM tunnel) 사용 시: cp .env.example .env.local + 받은 dev secrets 채움.
00:12  docker compose -f docker-compose.local.yml up -d --wait   # Phase 0 default. --wait: healthcheck 통과까지 block. 시나리오 A 면 'pnpm tunnel'.
00:14  pnpm db:migrate                  # 빈 schema (Phase 0) 또는 Phase 1+ 적용된 schema
00:16  pnpm dev                          # web:3000 + server:4000 (Node only — worker 는 Phase 4 부터)
00:18  curl http://localhost:4000/health  → {"status":"ok",...}
00:19  curl http://localhost:4000/api/v1/_ping  → {"data":{"ok":true},"meta":{...}}
00:21  http://localhost:3000 접속 → "WChat" 홈 페이지 표시 (login 화면은 Phase 1 부터)
00:25  pnpm typecheck && pnpm lint && pnpm test 모두 0 exit
00:30  완료 ✓
```

> Phase 0 = Node only. converter-worker (Python) 는 Phase 4 (Knowledge & RAG) 에서 처음
> 사용 — 그때 `cd apps/converter-worker && poetry install` + `pnpm dev:full`.

## 핵심 자동화 스크립트

| 작업            | 명령                                                                  |
| --------------- | --------------------------------------------------------------------- |
| 환경 셋업       | `pnpm install`                                                        |
| AWS SSM 터널    | `pnpm tunnel` (AWS 프로비저닝 전까지는 docker compose 로컬 스택 사용) |
| 개발 서버       | `pnpm dev` = web:3000 + server:4000                                   |
| DB 마이그레이션 | `pnpm db:migrate`                                                     |
| 타입 체크       | `pnpm typecheck`                                                      |
| 린트            | `pnpm lint`                                                           |
| 게이트 일괄     | `bash scripts/verify-gates.sh`                                        |

자세한 내용은 `rebuild_plan/` 문서를 참조하세요 (`08-SPRINT-PLAN.md`, `10-DEV-WORKFLOW.md`).
