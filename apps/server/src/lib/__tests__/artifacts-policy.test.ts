import { describe, it, expect } from "vitest";
import {
  ARTIFACTS_POLICY,
  buildArtifactsPolicyBlock,
} from "../artifacts-policy.js";

describe("artifacts-policy (claude.ai <artifacts_info> 이식)", () => {
  it("system-tier PromptBlock 으로 아티팩트 사용 지침을 반환한다", () => {
    const block = buildArtifactsPolicyBlock();
    expect(block.tier).toBe("system");
    expect(block.content).toBe(ARTIFACTS_POLICY);
    expect(block.content.length).toBeGreaterThan(200);
  });

  it("claude.ai 4대 '쓰는 조건' 신호를 담는다 (유의미·자립>15줄 / 편집·반복·재사용 / 맥락 독립 / 재참조)", () => {
    const t = ARTIFACTS_POLICY;
    expect(t).toMatch(/15줄/);
    expect(t).toMatch(/편집/);
    expect(t).toMatch(/반복|재사용/);
    expect(t).toMatch(/독립|자립/);
    expect(t).toMatch(/다시 참조|재참조/);
  });

  it("'안 쓰는 조건'(가능하면 인라인 선호)을 담는다", () => {
    const t = ARTIFACTS_POLICY;
    expect(t).toMatch(/인라인/);
    expect(t).toMatch(/짧|사소|일회성/);
    expect(t).toMatch(/맥락에 종속|종속적/);
  });

  it("명시 요청 강제 + 타입 안내(markdown/html) + 중복 금지 운영 규칙을 담는다", () => {
    const t = ARTIFACTS_POLICY;
    expect(t).toMatch(/명시/);
    expect(t).toMatch(/markdown/);
    expect(t).toMatch(/html/);
    // 리포트를 아티팩트로 냈으면 본문에 전문을 반복하지 말 것.
    expect(t).toMatch(/다시 옮겨|반복하지|중복/);
  });

  it("사용자가 스캔할 헤더 마커('아티팩트 사용 지침')를 포함한다", () => {
    expect(ARTIFACTS_POLICY).toContain("아티팩트 사용 지침");
  });
});
