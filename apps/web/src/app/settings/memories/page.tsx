import React from "react";
import { MemoryManager } from "../../../components/settings/MemoryManager";

export default function MemoriesSettingsPage() {
  return (
    <main className="p-8">
      <h1 className="text-2xl font-semibold text-fg">Memories</h1>
      <MemoryManager />
    </main>
  );
}
