-- 0039 · tool_metrics.source (툴 출처 구분, P22-T6-19)
-- 계약 승인: .ralph/CONTRACT_APPROVED 의 C17(B) (docs/rfc/P22-contract-batch.md § C17).
-- 단일 출처: packages/interfaces/src/types.ts 의 ToolMetricEntry.source,
--   apps/server/src/lib/tool-metrics.ts(toolSourceFromName 도출),
--   apps/server/src/db/admin-data-access.ts(toolMetricsSummary 집계 → GET /admin/tool-metrics).
-- 설계: 툴 이름 네임스페이스(mcp:/openapi:/skill:)에서 기록 시점에 출처를 도출해 저장한다.
--   기록 시점 값이라 사후 재계산이 필요 없고, 툴이 사라진 뒤에도 집계가 유지된다.
-- nullable-first: NULL = 0039 이전에 쌓인 기존 행. 백필하지 않는다 —
--   조회측(admin-data-access.pickPredominantSource)과 UI 가 NULL 을 'builtin'(=내장)으로
--   해석하므로 기존 행/기존 쿼리(SELECT 목록에 source 없음)는 전부 무변경으로 동작한다.
-- CHECK 제약은 NULL 허용(IS NULL OR IN (...)) — 기존 행이 제약을 위반하지 않는다.
-- 롤백 경로: dev/staging 전용 — ALTER TABLE tool_metrics DROP COLUMN source;
--   (컬럼만 제거하면 되고 인덱스/뷰/FK 의존이 없다. prod 는 forward-only 정책.)

ALTER TABLE tool_metrics ADD COLUMN source TEXT
  CHECK (source IS NULL OR source IN ('builtin','mcp','skill','openapi'));
