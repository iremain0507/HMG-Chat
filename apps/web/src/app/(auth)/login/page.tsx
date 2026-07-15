import React from "react";
import { LoginForm } from "../../../components/auth/LoginForm";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-bg p-8 text-fg">
      <div
        aria-hidden="true"
        data-testid="login-signature-placeholder"
        className="flex h-[26px] w-28 items-center justify-center rounded-sm border border-dashed border-fg-subtle px-1 text-center text-[8px] leading-tight text-fg-subtle"
      >
        HYUNDAI WIA
        <br />
        시그니처 원본
      </div>
      <div className="text-center">
        <h1 className="text-2xl font-semibold text-fg">로그인</h1>
        <p className="mt-2 text-sm text-fg-muted">
          이메일로 매직 링크를 받아 로그인하세요.
        </p>
      </div>
      <LoginForm errorCode={error} />
      {process.env.NODE_ENV !== "production" && (
        <div className="w-full max-w-sm border-t border-border pt-4">
          <a
            href="/api/v1/auth/dev-login"
            className="inline-block rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-fg transition hover:opacity-90"
          >
            ⚡ 바로 로그인 (dev)
          </a>
          <p className="mt-2 text-xs text-fg-muted">
            매직 링크 없이 테스트 유저로 접속합니다. production 에선 비활성(SSO
            로 교체 예정).
          </p>
        </div>
      )}
    </main>
  );
}
