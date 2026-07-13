Now I have everything needed for the phase verification report.

---

## PHASE VERIFICATION REPORT — Phase P3 (Projects & Members)

### Acceptance 항목별 판정

| #                             | Acceptance (feature_list.json / 08-SPRINT-PLAN)                                                   | 판정                                 | 근거                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ----------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P3-T1-01                      | `0004_projects_members.sql` — 빈 DB migrate 0 exit, project_members RLS                           | **PASS**                             | 파일 존재(`apps/server/src/db/migrations/0004_projects_members.sql`), `0004-projects-members.test.ts` 7건 통과, `rls-projects.test.ts`(실 Postgres) 존재                                                                                                                                                                                                                                                                                                             |
| P3-T1-02                      | `0015_project_team_scope_rls.sql` — visibility 매트릭스 9케이스                                   | **PASS**                             | 파일 존재, `0015-project-team-scope-rls.test.ts` 9건 통과, `rls-projects-team-scope.test.ts`(실 Postgres) 존재                                                                                                                                                                                                                                                                                                                                                       |
| P3-T1-03                      | **`routes/projects.ts`** + `db/project-service.ts` — CRUD/멤버관리, orgUnitId, owner row 자동생성 | **FAIL**                             | `db/project-service.ts`만 존재(17 unit test 통과). **`apps/server/src/routes/projects.ts` 파일 자체가 존재하지 않음**, `app.ts`에 `/api/v1/projects` 마운트 없음(다른 라우트: auth/sessions/messages/artifacts는 모두 존재/마운트됨). API 계약(16-API-CONTRACT.md § `POST/GET /projects`, `/projects/:id/members`)이 요구하는 HTTP 엔드포인트가 실앱에 전혀 배선되지 않음                                                                                            |
| P3-T6-01                      | web/projects 목록+상세, 다른 org private 프로젝트 조회 → 404 (existence leak 방지)                | **FAIL (실질)** / 단위테스트만 GREEN | `page.tsx`/`ProjectDetail.tsx`/`useProjects.ts`가 `fetch("/api/v1/projects...")`로 실 API를 호출하도록 구현됐으나, 그 백엔드 라우트가 없어 **런타임에서 절대 동작 불가**. 모든 프론트 테스트(`useProjects.test.ts`, `ProjectDetail.test.tsx`, `page.test.tsx`)가 `vi.stubGlobal("fetch", ...)`로 fetch를 완전 mock — 서버 라우트 부재를 검증 범위 밖에 둠. `pnpm test` 커버리지에서 `app.ts` 0%, `messages.ts`/`sessions.ts`류와 달리 projects 통합 경로 자체가 없음 |
| Phase 3 Gate (08-SPRINT-PLAN) | "다른 org 의 private 프로젝트 조회 시도 → 404 (existence leak 방지)"                              | **FAIL**                             | 위와 동일 사유 — 서버에 해당 엔드포인트가 없으므로 이 gate는 실제로 검증된 적이 없음                                                                                                                                                                                                                                                                                                                                                                                 |

### 구조적 원인

`scripts/verify-gates.sh`는 `pnpm typecheck/lint/test`만 실행하며, 서버 `test` 스크립트는 `--exclude src/__tests__/integration`로 실 Postgres 기반 RLS 테스트를 제외한다. Projects 관련 서버 테스트는 전부 `db/project-service.ts` 또는 raw RLS 계층만 직접 호출하고, 프론트 테스트는 `fetch`를 mock한다. 그 결과 **"HTTP 라우트가 실제로 마운트되어 있는가"를 검증하는 테스트가 하나도 없다** — 정확히 P2에서 이미 한 번 발생했던 것과 동일한 패턴(commit `f6018b8`: "독립검증이 잡은 실앱 라우트 미배선 gap")이 P3에서 재발.

### 격리 항목(blocked_tasks) 확인

`.ralph/blocked_tasks`에는 P0-T1-01(AWS 프로비저닝) 한 건만 있음 — P3 관련 격리 항목 없음. 즉 P3-T1-03/T6-01의 gap은 격리되지 않은 채 `passes: true`로 잘못 기록된 상태.

### 다음 phase 리스크

Phase 4(Knowledge)/Phase 5(Artifact)의 T3/T4 라우트가 `mcp_servers.project_id`, `sessions.project_id` 등 projects FK에 의존하며, 08-SPRINT-PLAN Phase 8은 "`mcp_servers` FK projects 의존 — Phase 3 끝나야 함"이라 명시. `routes/projects.ts` 없이 다음 phase로 진행하면 동일 gap이 누적된다.

### 권고 조치

- `P3-T1-03`, `P3-T6-01`을 `feature_list.json`에서 `passes: false`로 되돌리고 `attempts` 유지 규칙에 따라 재작업.
- `routes/projects.ts` 구현 + `app.ts` 마운트 + 실앱 통합 테스트(createApp 기반, P2-T2-06 패턴과 동일하게 HTTP 레벨로 cross-org 404 검증) 추가 필요.

```
PHASE_VERDICT: FAIL
```
