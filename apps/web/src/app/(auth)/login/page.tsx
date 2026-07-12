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
    </main>
  );
}
