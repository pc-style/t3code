import { createFileRoute } from "@tanstack/react-router";

import { KeybindingsSettings } from "../components/settings/KeybindingsSettings";

export const Route = createFileRoute("/settings/keybindings")({
  component: KeybindingsSettings,
});
