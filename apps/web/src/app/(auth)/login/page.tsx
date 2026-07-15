import React from "react";
import { LoginForm } from "../../../components/auth/LoginForm";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <main className="p-8">
      <h1 className="text-2xl font-semibold">로그인</h1>
      <p className="mt-2 text-gray-600">
        이메일로 매직 링크를 받아 로그인하세요.
      </p>
      <div className="mt-6">
        <LoginForm errorCode={error} />
      </div>
      {process.env.NODE_ENV !== "production" && (
        <div className="mt-8 border-t border-border pt-4">
          <a
            href="/api/v1/auth/dev-login"
            className="inline-block rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-fg"
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
