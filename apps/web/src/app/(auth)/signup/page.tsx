import React from "react";
import { SignupForm } from "../../../components/auth/SignupForm";

export default function SignupPage() {
  return (
    <main className="p-8">
      <h1 className="text-2xl font-semibold">가입하기</h1>
      <p className="mt-2 text-gray-600">
        이메일과 이름을 입력하면 가입 확인 링크를 보내드립니다.
      </p>
      <div className="mt-6">
        <SignupForm />
      </div>
    </main>
  );
}
