import React from "react";
import { SharePublicView } from "../../../components/share/SharePublicView";

export default async function SharePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  return (
    <main className="flex min-h-screen items-center justify-center bg-bg p-8">
      <SharePublicView token={token} />
    </main>
  );
}
