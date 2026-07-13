-- 0016 · indexes / vacuum settings (Phase 9 끝)
-- 단일 출처: rebuild_plan/06-DATA-MODEL.md § 0016_indexes_vacuum.sql
-- autovacuum tuning 만 포함 (트랜잭션 안에서 가능) — 비동시(non-concurrent) 인덱스 생성은 별도로
-- scripts/post-deploy-indexes.sh 가 production 에서 트랜잭션 밖 수동 실행 (06-DATA-MODEL 주석 참조).
-- 인덱스/스토리지 튜닝만이라 RLS 무관.

ALTER TABLE messages SET (
  autovacuum_vacuum_scale_factor = 0.05,
  autovacuum_analyze_scale_factor = 0.02
);
ALTER TABLE usage_logs SET (
  autovacuum_vacuum_scale_factor = 0.1
);
ALTER TABLE error_logs SET (
  autovacuum_vacuum_scale_factor = 0.1
);
