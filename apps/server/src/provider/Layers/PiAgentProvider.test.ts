import { describe, expect, it } from "vitest";

import { parsePiModelSlug } from "./PiAgentProvider.ts";

describe("parsePiModelSlug", () => {
  it("parses provider/model slugs", () => {
    expect(parsePiModelSlug("anthropic/claude-sonnet-4-6")).toEqual({
      provider: "anthropic",
      modelId: "claude-sonnet-4-6",
    });
  });

  it("rejects slugs without a provider prefix", () => {
    expect(parsePiModelSlug("claude-sonnet-4-6")).toBeUndefined();
  });
});
