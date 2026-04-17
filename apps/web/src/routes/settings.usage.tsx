import { createFileRoute } from "@tanstack/react-router";

import { UsageSettingsPanel } from "../components/settings/SettingsPanels";

export const Route = createFileRoute("/settings/usage")({
  component: UsageSettingsPanel,
});
