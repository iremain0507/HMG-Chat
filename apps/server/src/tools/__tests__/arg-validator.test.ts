import { describe, it, expect } from "vitest";
import type { JsonSchema } from "@wchat/interfaces";
import { validateArgs } from "../arg-validator.js";

describe("arg-validator.validateArgs — 순수 함수 (P11-T2-10)", () => {
  it("필수 필드가 모두 있고 타입이 일치하면 valid=true", () => {
    const schema: JsonSchema = {
      type: "object",
      properties: { query: { type: "string" }, limit: { type: "number" } },
      required: ["query"],
    };
    expect(validateArgs({ query: "widget", limit: 5 }, schema)).toEqual({
      valid: true,
    });
  });

  it("필수 필드가 누락되면 valid=false + 사유에 필드명 포함", () => {
    const schema: JsonSchema = {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
    };
    const result = validateArgs({}, schema);
    expect(result.valid).toBe(false);
    expect(result.errors?.[0]).toMatch(/query/);
  });

  it("필드 타입이 스키마와 불일치하면 valid=false", () => {
    const schema: JsonSchema = {
      type: "object",
      properties: { limit: { type: "number" } },
    };
    const result = validateArgs({ limit: "not-a-number" }, schema);
    expect(result.valid).toBe(false);
    expect(result.errors?.[0]).toMatch(/limit/);
  });

  it("최상위 args 가 object 타입이 아니면 valid=false", () => {
    const schema: JsonSchema = { type: "object", properties: {} };
    const result = validateArgs("not-an-object", schema);
    expect(result.valid).toBe(false);
  });

  it("스키마에 required/properties 가 없으면(빈 스키마) 항상 valid=true", () => {
    const schema: JsonSchema = {};
    expect(validateArgs({ anything: 1 }, schema)).toEqual({ valid: true });
  });
});
