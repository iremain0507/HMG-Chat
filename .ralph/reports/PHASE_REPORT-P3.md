# PHASE REPORT — P3 (Projects & Members)

검증 방식: 자동 phase-verifier(`claude -p`)가 결과 미산출(빈 리포트, 기존 jq/제어문자 이슈) →
integration owner 직접 실행검증. 1차 검증에서 실제 gap(routes/projects.ts 미배선) 포착 →
재작업 후 재검증.

## acceptance별 판정 (직접 실행 근거)

| task     | 판정             | 근거                                                                                                                                                                                               |
| -------- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P3-T1-01 | ✅ PASS          | 0004 projects+project_members 마이그레이션, rls-projects.test.ts 7건(실 Postgres) 통과                                                                                                             |
| P3-T1-02 | ✅ PASS          | 0015 team-scope RLS 4-policy, rls-projects-team-scope.test.ts 9건 통과                                                                                                                             |
| P3-T1-03 | ✅ PASS (재작업) | routes/projects.ts + app.ts `/api/v1/projects` 마운트 + **projects-composition.test.ts 3건**: 미인증 POST→401, POST→201+owner GET, **다른 org private 조회→404(existence-leak 방지)** 실 HTTP 검증 |
| P3-T6-01 | ✅ PASS          | web/projects 목록+상세, CI(Hyundai WIA) 시맨틱 토큰 적용, cross-org 404 흐름(백엔드 라우트 배선 후 실동작)                                                                                         |

## 게이트

- `bash scripts/verify-gates.sh` → exit 0 (typecheck/lint/test/state).
- `pnpm --filter @wchat/server test:integration` → 7 files / **34 tests 통과**(globalSetup 이 매회 DB 리셋+재마이그레이션).

## 1차 검증에서 잡은 gap (P2 재발 → 수정 완료)

- P3-T1-03 이 db/project-service.ts(DB층)만 구현하고 routes/projects.ts+app.ts 마운트 누락.
- web/projects 가 없는 `/api/v1/projects` 호출 → 런타임 불가(프론트 테스트는 fetch mock).
- 조치: T1-03 passes=false 복원 + desc 명확화 → 루프가 routes/projects.ts + 마운트 + 실 HTTP 통합테스트 구현(07fcf55).

## 시스템 리스크 (권고)

"route 파일은 있으나 app.ts 미마운트" gap 이 P2·P3 연속 발생. verify-gates 의 `test` 는 통합테스트를
제외하고 프론트는 fetch mock 이라 단위게이트가 못 잡음. P4+ 라우트 태스크(documents/artifacts/memories/
mcp-servers)에서 재발 방지 위해 **DB 불필요한 route-mount 스모크 테스트**(createApp 부팅→각 계약 prefix 가
401 반환=마운트됨, 404=미마운트) 를 기본 `test` 게이트에 추가 권장.

## 격리

- P0-T1-01 (AWS) 만 — P3 acceptance 무관.

PHASE_VERDICT: PASS
