import React from "react";
import { ChatView } from "../../../../components/chat/ChatView";

export default async function ChatPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;

  return (
    <main className="p-8">
      <ChatView sessionId={sessionId} />
    </main>
  );
}
