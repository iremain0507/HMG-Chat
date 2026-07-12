"use client";

import React, { useState, type FormEvent } from "react";

const ERROR_MESSAGES: Record<string, string> = {
  invalid: "링크가 유효하지 않습니다. 다시 시도해주세요.",
  expired: "링크가 만료되었습니다. 새 링크를 요청해주세요.",
  used: "이미 사용된 링크입니다. 새 링크를 요청해주세요.",
};

export function LoginForm({ errorCode }: { errorCode?: string | undefined }) {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/auth/magic-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) {
        const body = (await res.json()) as { error?: { message?: string } };
        setError(body.error?.message ?? "요청이 실패했습니다.");
        return;
      }
      setSent(true);
    } finally {
      setSubmitting(false);
    }
  }

  if (sent) {
    return <p role="status">이메일을 확인하세요 — 로그인 링크를 보냈습니다.</p>;
  }

  return (
    <form onSubmit={handleSubmit}>
      {errorCode && ERROR_MESSAGES[errorCode] && (
        <p role="alert">{ERROR_MESSAGES[errorCode]}</p>
      )}
      {error && <p role="alert">{error}</p>}
      <label htmlFor="login-email">이메일</label>
      <input
        id="login-email"
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        required
      />
      <button type="submit" disabled={submitting}>
        매직 링크 받기
      </button>
    </form>
  );
}
