import React from "react";
import { SignupForm } from "../../../components/auth/SignupForm";

export default function SignupPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-bg p-8 text-fg">
      <div
        aria-hidden="true"
        data-testid="signup-signature-placeholder"
        className="flex h-[26px] w-28 items-center justify-center rounded-sm border border-dashed border-fg-subtle px-1 text-center text-[8px] leading-tight text-fg-subtle"
      >
        HYUNDAI WIA
        <br />
        시그니처 원본
      </div>
      <div className="text-center">
        <h1 className="text-2xl font-semibold text-fg">가입하기</h1>
        <p className="mt-2 text-sm text-fg-muted">
          이메일과 이름을 입력하면 가입 확인 링크를 보내드립니다.
        </p>
      </div>
      <SignupForm />
    </main>
  );
}
