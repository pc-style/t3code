import { describe, expect, it } from "vitest";
import {
  defaultInstanceIdForDriver,
  PROVIDER_DISPLAY_NAMES,
  ProviderDriverKind,
} from "@t3tools/contracts";

import { PROVIDER_OPTIONS } from "./session-logic";
import { PROVIDER_ICON_BY_PROVIDER } from "./components/chat/providerIconUtils";
import { getProviderDisplayName, getProviderInteractionModeToggle } from "./providerModels";

const PI_PROVIDER = ProviderDriverKind.make("piAgent");
const PI_INSTANCE_ID = defaultInstanceIdForDriver(PI_PROVIDER);

describe("Pi provider metadata", () => {
  it("appears in the primary provider picker with a new badge", () => {
    expect(PROVIDER_OPTIONS).toContainEqual({
      value: PI_PROVIDER,
      label: "Pi",
      available: true,
      pickerSidebarBadge: "new",
    });
  });

  it("has an icon and display name mapping", () => {
    expect(PROVIDER_ICON_BY_PROVIDER[PI_PROVIDER]).toBeDefined();
    expect(PROVIDER_DISPLAY_NAMES[PI_PROVIDER]).toBe("Pi");
  });

  it("uses Pi snapshot metadata for labels and plan toggle visibility", () => {
    expect(
      getProviderDisplayName(
        [
          {
            instanceId: PI_INSTANCE_ID,
            driver: PI_PROVIDER,
            displayName: "Pi",
            enabled: true,
            installed: true,
            version: "1.0.0",
            status: "ready",
            auth: { status: "unknown" },
            checkedAt: "2026-01-01T00:00:00.000Z",
            models: [],
            slashCommands: [],
            skills: [],
            showInteractionModeToggle: true,
          },
        ],
        PI_PROVIDER,
      ),
    ).toBe("Pi");
    expect(
      getProviderInteractionModeToggle(
        [
          {
            instanceId: PI_INSTANCE_ID,
            driver: PI_PROVIDER,
            displayName: "Pi",
            enabled: true,
            installed: true,
            version: "1.0.0",
            status: "ready",
            auth: { status: "unknown" },
            checkedAt: "2026-01-01T00:00:00.000Z",
            models: [],
            slashCommands: [],
            skills: [],
            showInteractionModeToggle: true,
          },
        ],
        PI_PROVIDER,
      ),
    ).toBe(true);
  });
});
