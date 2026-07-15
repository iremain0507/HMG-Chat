#!/usr/bin/env node
// P9-T1-05 — 08-SPRINT-PLAN.md § Week 11 Performance test 단일 출처.
// 사용: node scripts/load-test.mjs --users <N> [--base-url <url>] [--path <path>] [--threshold-ms <ms>]
// Gate: p95 응답 시간 < 500ms (LLM 제외) — 기본 대상은 /api/v1/_ping (DB/LLM 미접근).

function parseArgs(argv) {
  const opts = {
    users: null,
    baseUrl: process.env.LOAD_TEST_BASE_URL ?? "http://localhost:4000",
    path: "/api/v1/_ping",
    thresholdMs: 500,
    batchSize: 100,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => argv[(i += 1)];
    switch (arg) {
      case "--users":
        opts.users = Number(next());
        break;
      case "--base-url":
        opts.baseUrl = next();
        break;
      case "--path":
        opts.path = next();
        break;
      case "--threshold-ms":
        opts.thresholdMs = Number(next());
        break;
      case "--batch-size":
        opts.batchSize = Number(next());
        break;
      default:
        throw new Error(`알 수 없는 인자: ${arg}`);
    }
  }
  if (!Number.isInteger(opts.users) || opts.users <= 0) {
    throw new Error("--users <양의 정수> 는 필수다");
  }
  return opts;
}

export function percentile(sortedAscending, p) {
  if (sortedAscending.length === 0) return NaN;
  const rank = Math.ceil((p / 100) * sortedAscending.length);
  const index = Math.min(Math.max(rank, 1), sortedAscending.length) - 1;
  return sortedAscending[index];
}

export function summarize(latenciesMs) {
  const sorted = [...latenciesMs].sort((a, b) => a - b);
  const sum = sorted.reduce((acc, v) => acc + v, 0);
  return {
    count: sorted.length,
    min: sorted.length ? sorted[0] : NaN,
    max: sorted.length ? sorted[sorted.length - 1] : NaN,
    mean: sorted.length ? sum / sorted.length : NaN,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
  };
}

async function fireRequest(url) {
  const start = performance.now();
  try {
    const res = await fetch(url);
    const latencyMs = performance.now() - start;
    return { ok: res.ok, latencyMs };
  } catch {
    return { ok: false, latencyMs: performance.now() - start };
  }
}

async function runLoadTest(opts) {
  const url = new URL(opts.path, opts.baseUrl).toString();
  const results = [];
  for (let launched = 0; launched < opts.users; launched += opts.batchSize) {
    const batch = Math.min(opts.batchSize, opts.users - launched);
    const batchResults = await Promise.all(
      Array.from({ length: batch }, () => fireRequest(url)),
    );
    results.push(...batchResults);
  }

  const successes = results.filter((r) => r.ok);
  const failures = results.length - successes.length;
  const stats = summarize(successes.map((r) => r.latencyMs));
  const pass = failures === 0 && stats.p95 < opts.thresholdMs;

  return { url, users: opts.users, failures, stats, pass, thresholdMs: opts.thresholdMs };
}

function printReport(report) {
  const fmt = (n) => (Number.isFinite(n) ? n.toFixed(1) : "N/A");
  console.log(`── load-test: ${report.url} (users=${report.users})`);
  console.log(`   requests: ${report.stats.count} ok, ${report.failures} failed`);
  console.log(
    `   latency(ms) min=${fmt(report.stats.min)} mean=${fmt(report.stats.mean)} p50=${fmt(report.stats.p50)} p95=${fmt(report.stats.p95)} p99=${fmt(report.stats.p99)} max=${fmt(report.stats.max)}`,
  );
  console.log(
    report.pass
      ? `   ✅ PASS (p95 < ${report.thresholdMs}ms, 0 failures)`
      : `   ❌ FAIL (p95 < ${report.thresholdMs}ms 및 무실패 요구)`,
  );
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const report = await runLoadTest(opts);
  printReport(report);
  process.exit(report.pass ? 0 : 1);
}

const isMain = process.argv[1] && import.meta.url === new URL(process.argv[1], "file:").href;
if (isMain) {
  main().catch((err) => {
    console.error(err.message ?? err);
    process.exit(1);
  });
}
