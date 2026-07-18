// @vitest-environment jsdom
// components/InstallPwaButton.tsx — P22-T6-07 PWA install affordance.
//   Captures beforeinstallprompt, shows an install button, calls prompt() on click.
//   Open WebUI reference flow: install affordance appears only when installable.
import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  cleanup,
  act,
} from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { InstallPwaButton } from "../InstallPwaButton";

afterEach(() => cleanup());

function fireBeforeInstallPrompt(prompt: () => Promise<void>) {
  const evt = new Event("beforeinstallprompt") as Event & {
    prompt: () => Promise<void>;
    userChoice: Promise<{ outcome: string }>;
  };
  evt.prompt = prompt;
  evt.userChoice = Promise.resolve({ outcome: "accepted" });
  act(() => {
    window.dispatchEvent(evt);
  });
  return evt;
}

describe("InstallPwaButton", () => {
  it("is hidden until beforeinstallprompt fires", () => {
    render(<InstallPwaButton />);
    expect(screen.queryByRole("button", { name: /설치|install/i })).toBeNull();
  });

  it("shows the install button and calls prompt() on click once installable", async () => {
    render(<InstallPwaButton />);
    const prompt = vi.fn().mockResolvedValue(undefined);
    fireBeforeInstallPrompt(prompt);

    const btn = screen.getByRole("button", { name: /설치|install/i });
    expect(btn).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(btn);
    });
    expect(prompt).toHaveBeenCalledTimes(1);
  });

  it("hides the button after the app is installed (appinstalled)", () => {
    render(<InstallPwaButton />);
    fireBeforeInstallPrompt(vi.fn().mockResolvedValue(undefined));
    expect(
      screen.getByRole("button", { name: /설치|install/i }),
    ).toBeInTheDocument();

    act(() => {
      window.dispatchEvent(new Event("appinstalled"));
    });
    expect(screen.queryByRole("button", { name: /설치|install/i })).toBeNull();
  });
});
