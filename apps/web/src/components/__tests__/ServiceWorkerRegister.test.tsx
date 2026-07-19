// @vitest-environment jsdom
// components/ServiceWorkerRegister.tsx — P22-T6-07 PWA service-worker registrar.
//   Acceptance: navigator.serviceWorker.register('/sw.js') on mount; no-op/no-throw
//   in environments lacking serviceWorker support.
import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, waitFor } from "@testing-library/react";
import { ServiceWorkerRegister } from "../ServiceWorkerRegister";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  // clean the injected serviceWorker between tests
  delete (navigator as unknown as Record<string, unknown>).serviceWorker;
});

describe("ServiceWorkerRegister", () => {
  it("registers /sw.js when the browser supports service workers", async () => {
    const register = vi.fn().mockResolvedValue({});
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: { register },
    });

    render(<ServiceWorkerRegister />);

    await waitFor(() => expect(register).toHaveBeenCalledWith("/sw.js"));
  });

  it("does nothing and throws no error when serviceWorker is unsupported", () => {
    expect(
      (navigator as unknown as Record<string, unknown>).serviceWorker,
    ).toBeUndefined();
    expect(() => render(<ServiceWorkerRegister />)).not.toThrow();
  });
});
