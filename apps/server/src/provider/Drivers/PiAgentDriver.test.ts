import { describe, expect, it } from "vitest";
import { ProviderInstanceId } from "@t3tools/contracts";

import { buildPiContinuationGroupKey } from "./PiAgentDriver.ts";

describe("buildPiContinuationGroupKey", () => {
  it("includes both configDir and sessionDir when isolating Pi continuation state", () => {
    const instanceId = ProviderInstanceId.make("piAgent");

    expect(
      buildPiContinuationGroupKey({
        instanceId,
        configDir: "/tmp/pi-config-a",
        sessionDir: "/tmp/pi-sessions-a",
      }),
    ).not.toBe(
      buildPiContinuationGroupKey({
        instanceId,
        configDir: "/tmp/pi-config-a",
        sessionDir: "/tmp/pi-sessions-b",
      }),
    );
    expect(
      buildPiContinuationGroupKey({
        instanceId,
        configDir: "/tmp/pi-config-a",
        sessionDir: "/tmp/pi-sessions-a",
      }),
    ).not.toBe(
      buildPiContinuationGroupKey({
        instanceId,
        configDir: "/tmp/pi-config-b",
        sessionDir: "/tmp/pi-sessions-a",
      }),
    );
  });
});
