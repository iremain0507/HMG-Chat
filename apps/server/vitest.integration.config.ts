import { defineConfig } from "vitest/config";

// 통합테스트 전용 config — test:integration 만 --config 로 사용.
// (기본 test/test:unit 은 config 파일을 지정하지 않으므로 영향 없음.)
export default defineConfig({
  test: {
    dir: "src/__tests__/integration",
    // 매 실행 전 dev DB 리셋 + 재마이그레이션 (편집한 마이그레이션 즉시 반영).
    globalSetup: "./src/__tests__/integration/global-setup.ts",
    // 통합테스트는 공유 DB 를 쓰므로 파일 병렬 금지 (GRANT/seed race 방지).
    fileParallelism: false,
  },
});
