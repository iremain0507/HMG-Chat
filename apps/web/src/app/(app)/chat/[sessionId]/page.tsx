import React from "react";
import { ChatView } from "../../../../components/chat/ChatView";

export default async function ChatPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;

  // ChatView 가 h-[100dvh] 로 자체 풀-높이 레이아웃(헤더/스크롤/컴포저)을 관리 → p-8 래퍼 제거.
  return <ChatView sessionId={sessionId} />;
}
