import js from "@eslint/js";
import ts from "typescript-eslint";
import globals from "globals";

export default [
  js.configs.recommended,
  ...ts.configs.recommended,
  // Node 환경: server, scripts, config
  {
    files: ["apps/server/**/*.ts", "scripts/**/*.{ts,mjs}", "**/*.config.{ts,mjs}", "apps/server/scripts/**/*.ts"],
    languageOptions: {
      globals: { ...globals.node, crypto: "readonly" },
    },
  },
  // Browser 환경: web (Next.js)
  {
    files: ["apps/web/**/*.{ts,tsx}"],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
  },
  // Vitest 환경: 테스트 파일
  {
    files: ["**/*.test.ts", "**/*.spec.ts", "**/__tests__/**/*.ts"],
    languageOptions: {
      globals: { ...globals.node, ...globals.vitest },
    },
  },
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "warn",
      "no-console": ["error", { allow: ["warn", "error"] }],
    },
  },
  {
    ignores: ["**/dist/**", "**/.next/**", "**/coverage/**", "**/*.generated.ts"],
  },
];
