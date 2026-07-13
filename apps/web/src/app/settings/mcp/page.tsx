import React from "react";
import { McpServersManager } from "../../../components/settings/McpServersManager";

export default function McpSettingsPage() {
  return (
    <main className="p-8">
      <h1 className="text-2xl font-semibold text-fg">MCP Servers</h1>
      <McpServersManager />
    </main>
  );
}
