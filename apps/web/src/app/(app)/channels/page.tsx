import React from "react";
import { ChannelsWorkspace } from "../../../components/channels/ChannelsWorkspace";

// app/(app)/channels/page.tsx — P22-T6-12 채널 라우트(실시간 멀티유저 + @model 협업).
//   (app) 레이아웃 하위라 인증/내비게이션은 상위 layout 이 담당한다.
export default function ChannelsPage() {
  return (
    <main className="mx-auto h-[calc(100vh-4rem)] max-w-6xl p-8">
      <ChannelsWorkspace />
    </main>
  );
}
