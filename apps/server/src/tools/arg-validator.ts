// arg-validator.ts — 20-MULTI-AGENT-TOOL.md § P11-T2-10
// 순수함수 validateArgs(args, spec.inputSchema). runTurn 이 tool.invoke 직전 호출해
// 스키마 불일치 args 가 invoke 로 새는(tool 환각 side-effect) 것을 차단한다.
import type { JsonSchema, JsonSchemaType } from "@wchat/interfaces";

export interface ValidationResult {
  valid: boolean;
  errors?: string[];
}

function typeOf(value: unknown): JsonSchemaType {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "number") {
    return Number.isInteger(value) ? "integer" : "number";
  }
  if (typeof value === "string") return "string";
  if (typeof value === "boolean") return "boolean";
  return "object";
}

function matchesType(value: unknown, type: JsonSchemaType): boolean {
  const actual = typeOf(value);
  if (actual === type) return true;
  // integer 는 number 스키마도 만족한다 (JSON Schema 관례).
  return type === "number" && actual === "integer";
}

function validate(
  value: unknown,
  schema: JsonSchema,
  path: string,
  errors: string[],
): void {
  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((type) => matchesType(value, type))) {
      errors.push(
        `${path}: 타입 불일치 (기대: ${types.join("|")}, 실제: ${typeOf(value)})`,
      );
      return;
    }
  }

  if (schema.enum && !schema.enum.some((allowed) => allowed === value)) {
    errors.push(`${path}: enum 값이 아님`);
  }

  if (typeOf(value) === "object" && value !== null) {
    const obj = value as Record<string, unknown>;
    for (const required of schema.required ?? []) {
      if (!(required in obj)) {
        errors.push(`${path}${path ? "." : ""}${required}: 필수 필드 누락`);
      }
    }
    for (const [key, propSchema] of Object.entries(schema.properties ?? {})) {
      if (key in obj) {
        validate(
          obj[key],
          propSchema,
          `${path}${path ? "." : ""}${key}`,
          errors,
        );
      }
    }
  }

  if (typeOf(value) === "array" && Array.isArray(schema.items)) {
    // items 가 tuple 형태인 경우는 이 태스크 스코프 밖 — 스킵.
  } else if (typeOf(value) === "array" && schema.items) {
    (value as unknown[]).forEach((item, index) => {
      validate(item, schema.items as JsonSchema, `${path}[${index}]`, errors);
    });
  }
}

export function validateArgs(
  args: unknown,
  schema: JsonSchema,
): ValidationResult {
  const errors: string[] = [];
  validate(args, schema, "", errors);
  return errors.length > 0 ? { valid: false, errors } : { valid: true };
}
