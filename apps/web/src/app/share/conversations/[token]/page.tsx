import React from "react";
import { ConversationSharePublicView } from "../../../../components/share/ConversationSharePublicView";

export default async function ConversationSharePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  return (
    <main className="flex min-h-screen items-center justify-center bg-bg p-8">
      <ConversationSharePublicView token={token} />
    </main>
  );
}
