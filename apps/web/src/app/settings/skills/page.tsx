import React from "react";
import { SkillsManager } from "../../../components/settings/SkillsManager";

export default function SkillsSettingsPage() {
  return (
    <main className="p-8">
      <h1 className="text-2xl font-semibold text-fg">Skills</h1>
      <SkillsManager />
    </main>
  );
}
