import { describe, expect, it } from "vitest";
import { createModelCapabilities } from "@t3tools/shared/model";

import {
  mergePiProviderModels,
  parsePiListModelsOutput,
  piListedModelsToServerModels,
} from "./PiModelList.ts";

const EMPTY_CAPABILITIES = createModelCapabilities({ optionDescriptors: [] });

describe("parsePiListModelsOutput", () => {
  it("parses pi --list-models table rows", () => {
    const parsed =
      parsePiListModelsOutput(`provider     model              context  max-out  thinking  images
opencode-go  deepseek-v4-flash  1M       384K     yes       no
opencode-go  glm-5              202.8K   32.8K    yes       no`);

    expect(parsed).toEqual([
      {
        provider: "opencode-go",
        modelId: "deepseek-v4-flash",
        slug: "opencode-go/deepseek-v4-flash",
      },
      {
        provider: "opencode-go",
        modelId: "glm-5",
        slug: "opencode-go/glm-5",
      },
    ]);
  });

  it("keeps model rows when provider names start with provider", () => {
    const parsed =
      parsePiListModelsOutput(`provider     model              context  max-out  thinking  images
provider-one my-model            1M       384K     yes       no`);

    expect(parsed).toEqual([
      {
        provider: "provider-one",
        modelId: "my-model",
        slug: "provider-one/my-model",
      },
    ]);
  });

  it("deduplicates repeated slugs", () => {
    const parsed = parsePiListModelsOutput(`opencode-go deepseek-v4-flash 1M 384K yes no
opencode-go deepseek-v4-flash 1M 384K yes no`);
    expect(parsed).toHaveLength(1);
  });
});

describe("mergePiProviderModels", () => {
  it("merges built-in, discovered, and custom models", () => {
    const merged = mergePiProviderModels({
      builtInModels: [
        {
          slug: "anthropic/claude-sonnet-4-6",
          name: "Claude Sonnet 4.6",
          isCustom: false,
          capabilities: EMPTY_CAPABILITIES,
        },
      ],
      discoveredModels: piListedModelsToServerModels([
        {
          provider: "opencode-go",
          modelId: "deepseek-v4-flash",
          slug: "opencode-go/deepseek-v4-flash",
        },
      ]),
      customModelSlugs: ["my-proxy/custom-model"],
    });

    expect(merged.map((model) => model.slug)).toEqual([
      "anthropic/claude-sonnet-4-6",
      "my-proxy/custom-model",
      "opencode-go/deepseek-v4-flash",
    ]);
    expect(
      merged.map((model) =>
        model.capabilities?.optionDescriptors?.map((descriptor) => descriptor.id),
      ),
    ).toEqual([
      ["thinking", "tools", "steering"],
      ["thinking", "tools", "steering"],
      ["thinking", "tools", "steering"],
    ]);
  });
});
