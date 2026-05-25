import { describe, expect, it } from "vitest";
import { PiAgentSettings } from "@t3tools/contracts";
import { createModelCapabilities } from "@t3tools/shared/model";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import {
  makePendingPiAgentProvider,
  parsePiModelSlug,
  resolvePiAuthStatus,
} from "./PiAgentProvider.ts";

const decodePiSettings = Schema.decodeSync(PiAgentSettings);
const EMPTY_CAPABILITIES = createModelCapabilities({ optionDescriptors: [] });

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

describe("Pi provider snapshots", () => {
  it("disabled snapshot includes display metadata, models, and version advisory", async () => {
    const snapshot = await Effect.runPromise(makePendingPiAgentProvider(decodePiSettings({})));

    expect(snapshot.displayName).toBe("Pi");
    expect(snapshot.enabled).toBe(false);
    expect(snapshot.status).toBe("disabled");
    expect(snapshot.showInteractionModeToggle).toBe(true);
    expect(snapshot.models.map((model) => model.slug)).toContain("anthropic/claude-sonnet-4-6");
    expect(snapshot.slashCommands).toContainEqual({
      name: "login",
      description: "Open Pi's provider login flow inside this session.",
    });
    expect(snapshot.versionAdvisory).toBeDefined();
  });

  it("enabled pending snapshot advertises plan mode support and Pi model traits", async () => {
    const snapshot = await Effect.runPromise(
      makePendingPiAgentProvider(
        decodePiSettings({
          enabled: true,
          customModels: ["custom-provider/custom-model"],
        }),
      ),
    );
    const customModel = snapshot.models.find(
      (model) => model.slug === "custom-provider/custom-model",
    );

    expect(snapshot.enabled).toBe(true);
    expect(snapshot.showInteractionModeToggle).toBe(true);
    expect(
      customModel?.capabilities?.optionDescriptors?.map((descriptor) => descriptor.id),
    ).toEqual(["thinking", "tools", "steering"]);
  });
});

describe("resolvePiAuthStatus", () => {
  it("marks Pi authenticated when a matching provider env var is present", () => {
    expect(
      resolvePiAuthStatus({
        models: [
          {
            slug: "openai/gpt-5.4",
            name: "GPT-5.4",
            isCustom: false,
            capabilities: EMPTY_CAPABILITIES,
          },
        ],
        environment: { OPENAI_API_KEY: "secret" },
      }),
    ).toMatchObject({ status: "authenticated", type: "environment" });
  });

  it("returns unauthenticated guidance when credentials are missing", () => {
    expect(
      resolvePiAuthStatus({
        models: [
          {
            slug: "anthropic/claude-sonnet-4-6",
            name: "Claude Sonnet 4.6",
            isCustom: false,
            capabilities: EMPTY_CAPABILITIES,
          },
        ],
        environment: {},
      }),
    ).toMatchObject({ status: "unauthenticated", type: "environment" });
  });

  it("supports custom Pi providers with derived API key env names", () => {
    expect(
      resolvePiAuthStatus({
        models: [
          {
            slug: "private-provider/custom",
            name: "Custom",
            isCustom: true,
            capabilities: EMPTY_CAPABILITIES,
          },
        ],
        environment: { PRIVATE_PROVIDER_API_KEY: "secret" },
      }),
    ).toMatchObject({ status: "authenticated", label: "Detected PRIVATE_PROVIDER_API_KEY" });
  });

  it("returns unauthenticated for custom Pi providers when derived credentials are missing", () => {
    expect(
      resolvePiAuthStatus({
        models: [
          {
            slug: "private-provider/custom",
            name: "Custom",
            isCustom: true,
            capabilities: EMPTY_CAPABILITIES,
          },
        ],
        environment: {},
      }),
    ).toMatchObject({
      status: "unauthenticated",
      label: "Set one of PRIVATE_PROVIDER_API_KEY for the configured Pi models.",
    });
  });
});
