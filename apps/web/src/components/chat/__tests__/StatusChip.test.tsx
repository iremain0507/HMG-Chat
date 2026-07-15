// @vitest-environment jsdom
// components/chat/StatusChip.tsx — design-reference 「StatusChip 5종」 핸드오프 정렬 검증.
//   대기/실행 중/완료/오류/승인 필요 5상태 공용 어휘 + running 도트만 펄스.
import React from "react";
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { StatusChip } from "../StatusChip";

describe("StatusChip", () => {
  afterEach(() => cleanup());

  it("5번째 상태 pending-approval 을 '승인 필요' 라벨로 렌더한다", () => {
    render(<StatusChip status="pending-approval" />);
    const chip = screen.getByTestId("status-chip");
    expect(chip).toHaveAttribute("data-status", "pending-approval");
    expect(chip).toHaveTextContent("승인 필요");
  });

  it("모든 상태가 좌측 상태 도트를 갖는다(대기/완료/오류도 running과 동일하게)", () => {
    const statuses = [
      "queued",
      "running",
      "done",
      "error",
      "pending-approval",
    ] as const;
    for (const status of statuses) {
      cleanup();
      render(<StatusChip status={status} />);
      const chip = screen.getByTestId("status-chip");
      const dot = chip.querySelector('[data-testid="status-chip-dot"]');
      expect(dot).not.toBeNull();
    }
  });

  it("running 상태의 도트만 펄스 애니메이션 클래스를 갖는다", () => {
    render(<StatusChip status="running" />);
    const dot = screen.getByTestId("status-chip-dot");
    expect(dot.className).toMatch(/animate-\[pulse/);
  });

  it("queued/done/error/pending-approval 도트는 펄스 클래스가 없다", () => {
    const statuses = ["queued", "done", "error", "pending-approval"] as const;
    for (const status of statuses) {
      cleanup();
      render(<StatusChip status={status} />);
      const dot = screen.getByTestId("status-chip-dot");
      expect(dot.className).not.toMatch(/animate-\[pulse/);
    }
  });

  it("done 상태는 success 시맨틱 토큰을, error 는 danger/accent 토큰을 쓴다(primary 오분류 회귀 가드)", () => {
    render(<StatusChip status="done" />);
    const doneChip = screen.getByTestId("status-chip");
    expect(doneChip.className).toMatch(/success/);
    expect(doneChip.className).not.toMatch(/text-primary\b/);
  });

  it("하드코딩 hex 를 쓰지 않는다(시맨틱 토큰 유틸 클래스만)", () => {
    render(<StatusChip status="pending-approval" />);
    const chip = screen.getByTestId("status-chip");
    expect(chip.outerHTML).not.toMatch(/#[0-9a-fA-F]{3,6}/);
  });
});
