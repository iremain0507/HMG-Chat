// 0010_quotas_usage.sql / 0011_observability.sql / 0016_indexes_vacuum.sql 정적 검증
// (06-DATA-MODEL.md § 0010/0011/0016 본문 + 14-INTERFACES UserQuotaInfo/UsageLogEntry/
// ErrorLogEntry/ToolMetricEntry/HealthCheckResult/AlertEvent 컬럼과 일치 여부).
// 0009-mcp-servers-skill-assets.test.ts 와 동일 패턴 — 실 Postgres 없이도 실행 가능.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const QUOTAS_PATH = new URL(
  "../migrations/0010_quotas_usage.sql",
  import.meta.url,
);
const OBSERVABILITY_PATH = new URL(
  "../migrations/0011_observability.sql",
  import.meta.url,
);
const INDEXES_PATH = new URL(
  "../migrations/0016_indexes_vacuum.sql",
  import.meta.url,
);
const JOURNAL_PATH = new URL(
  "../migrations/meta/_journal.json",
  import.meta.url,
);

describe("0010_quotas_usage migration", () => {
  const sql = readFileSync(QUOTAS_PATH, "utf-8");

  it("user_quotas 테이블을 14-INTERFACES UserQuotaInfo 컬럼으로 생성한다", () => {
    expect(sql).toMatch(/CREATE TABLE user_quotas/);
    expect(sql).toMatch(
      /user_id UUID PRIMARY KEY REFERENCES users\(id\) ON DELETE CASCADE/,
    );
    expect(sql).toMatch(/budget_micros BIGINT NOT NULL/);
    expect(sql).toMatch(/used_micros BIGINT NOT NULL DEFAULT 0/);
    expect(sql).toMatch(/period_start TIMESTAMPTZ NOT NULL/);
    expect(sql).toMatch(/period_end TIMESTAMPTZ NOT NULL/);
  });

  it("usage_logs 테이블을 14-INTERFACES UsageLogEntry 컬럼으로 생성한다", () => {
    expect(sql).toMatch(/CREATE TABLE usage_logs/);
    expect(sql).toMatch(
      /user_id UUID NOT NULL REFERENCES users\(id\) ON DELETE CASCADE/,
    );
    expect(sql).toMatch(
      /org_id UUID NOT NULL REFERENCES organizations\(id\) ON DELETE CASCADE/,
    );
    expect(sql).toMatch(
      /session_id UUID REFERENCES sessions\(id\) ON DELETE SET NULL/,
    );
    expect(sql).toMatch(/tokens_in INT/);
    expect(sql).toMatch(/tokens_out INT/);
    expect(sql).toMatch(/cost_micros BIGINT/);
  });

  it("user/org별 조회 인덱스를 생성한다", () => {
    expect(sql).toMatch(
      /CREATE INDEX usage_logs_user_created_idx ON usage_logs\(user_id, created_at\)/,
    );
    expect(sql).toMatch(
      /CREATE INDEX usage_logs_org_created_idx\s+ON usage_logs\(org_id, created_at\)/,
    );
  });

  it("RLS 를 활성화하고 owner/admin 만 조회 가능하게 한다", () => {
    expect(sql).toMatch(/ALTER TABLE user_quotas ENABLE ROW LEVEL SECURITY/);
    expect(sql).toMatch(/ALTER TABLE usage_logs\s+ENABLE ROW LEVEL SECURITY/);
    expect(sql).toMatch(/CREATE POLICY user_quotas_owner ON user_quotas/);
    expect(sql).toMatch(
      /CREATE POLICY user_quotas_admin_modify ON user_quotas/,
    );
    expect(sql).toMatch(
      /CREATE POLICY usage_logs_owner_or_admin ON usage_logs/,
    );
    expect(sql).toMatch(/current_user_is_admin\(\)/);
    // 0001~0009 와 동일 사유 — bare current_setting(...)::uuid 캐스트 금지 (P1-T1-01 버그 패턴).
    expect(sql).not.toMatch(/[^F]current_setting\('app\.\w+', true\)::uuid/);
  });
});

describe("0011_observability migration", () => {
  const sql = readFileSync(OBSERVABILITY_PATH, "utf-8");

  it("error_logs 테이블을 14-INTERFACES ErrorLogEntry 컬럼으로 생성한다", () => {
    expect(sql).toMatch(/CREATE TABLE error_logs/);
    expect(sql).toMatch(
      /level TEXT NOT NULL CHECK \(level IN \('debug','info','warn','error','fatal'\)\)/,
    );
    expect(sql).toMatch(
      /category TEXT NOT NULL CHECK \(category IN \('auth','tool','db','mcp','sandbox','rate-limit','external-api','parser','orchestrator','http','system'\)\)/,
    );
  });

  it("tool_metrics 테이블을 14-INTERFACES ToolMetricEntry 컬럼으로 생성한다", () => {
    expect(sql).toMatch(/CREATE TABLE tool_metrics/);
    expect(sql).toMatch(/tool_name TEXT NOT NULL/);
    expect(sql).toMatch(
      /status TEXT NOT NULL CHECK \(status IN \('ok','error','timeout','denied','hitl-pending'\)\)/,
    );
    expect(sql).toMatch(/duration_ms INT/);
  });

  it("health_check_history 테이블을 14-INTERFACES HealthCheckResult 컬럼으로 생성한다", () => {
    expect(sql).toMatch(/CREATE TABLE health_check_history/);
    expect(sql).toMatch(
      /status TEXT NOT NULL CHECK \(status IN \('healthy','degraded','down'\)\)/,
    );
    expect(sql).toMatch(/latency_ms INT/);
  });

  it("alert_events 테이블을 14-INTERFACES AlertEvent 컬럼으로 생성한다", () => {
    expect(sql).toMatch(/CREATE TABLE alert_events/);
    expect(sql).toMatch(
      /severity TEXT NOT NULL CHECK \(severity IN \('info','warn','critical'\)\)/,
    );
    expect(sql).toMatch(/resolved_at TIMESTAMPTZ/);
  });

  it("네 테이블 모두 RLS 를 활성화하고 admin 만 조회 가능하게 한다", () => {
    expect(sql).toMatch(/ALTER TABLE error_logs\s+ENABLE ROW LEVEL SECURITY/);
    expect(sql).toMatch(/ALTER TABLE tool_metrics\s+ENABLE ROW LEVEL SECURITY/);
    expect(sql).toMatch(
      /ALTER TABLE health_check_history ENABLE ROW LEVEL SECURITY/,
    );
    expect(sql).toMatch(/ALTER TABLE alert_events\s+ENABLE ROW LEVEL SECURITY/);
    expect(sql).toMatch(/CREATE POLICY error_logs_admin ON error_logs/);
    expect(sql).toMatch(/CREATE POLICY tool_metrics_admin ON tool_metrics/);
    expect(sql).toMatch(/CREATE POLICY health_admin ON health_check_history/);
    expect(sql).toMatch(/CREATE POLICY alerts_admin ON alert_events/);
  });
});

describe("0016_indexes_vacuum migration", () => {
  const sql = readFileSync(INDEXES_PATH, "utf-8");

  it("messages/usage_logs/error_logs 의 autovacuum 파라미터를 튜닝한다", () => {
    expect(sql).toMatch(/ALTER TABLE messages SET \(/);
    expect(sql).toMatch(/autovacuum_vacuum_scale_factor = 0\.05/);
    expect(sql).toMatch(/autovacuum_analyze_scale_factor = 0\.02/);
    expect(sql).toMatch(/ALTER TABLE usage_logs SET \(/);
    expect(sql).toMatch(/ALTER TABLE error_logs SET \(/);
  });

  it("CREATE INDEX CONCURRENTLY 를 포함하지 않는다 (트랜잭션 안전)", () => {
    expect(sql).not.toMatch(/CONCURRENTLY/);
  });
});

describe("migration journal", () => {
  it("0010/0011/0016 이 0009_mcp_servers_skill_assets 이후 순서로 등록돼 있다", () => {
    const journal = JSON.parse(readFileSync(JOURNAL_PATH, "utf-8")) as {
      entries: { tag: string }[];
    };
    const tags = journal.entries.map((e) => e.tag);
    expect(tags).toContain("0010_quotas_usage");
    expect(tags).toContain("0011_observability");
    expect(tags).toContain("0016_indexes_vacuum");

    const idx9 = tags.indexOf("0009_mcp_servers_skill_assets");
    const idx10 = tags.indexOf("0010_quotas_usage");
    const idx11 = tags.indexOf("0011_observability");
    const idx16 = tags.indexOf("0016_indexes_vacuum");
    expect(idx10).toBeGreaterThan(idx9);
    expect(idx11).toBeGreaterThan(idx10);
    expect(idx16).toBeGreaterThan(idx11);
  });
});
