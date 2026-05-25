import { ProviderDriverKind, type ServerProviderModel } from "@t3tools/contracts";

import { createModelCapabilities } from "@t3tools/shared/model";

const PROVIDER = ProviderDriverKind.make("piAgent");
export const PI_THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh"] as const;
export const PI_TOOL_MODES = ["full", "read-only", "off"] as const;
export const PI_STEERING_MODES = ["steer", "followUp"] as const;

export type PiThinkingLevel = (typeof PI_THINKING_LEVELS)[number];
export type PiToolMode = (typeof PI_TOOL_MODES)[number];
export type PiSteeringMode = (typeof PI_STEERING_MODES)[number];

function makePiOption(
  value: string,
  label: string,
  isDefault: boolean,
): { readonly id: string; readonly label: string; readonly isDefault?: true } {
  return Object.assign({ id: value, label }, isDefault ? { isDefault: true as const } : {});
}

const DEFAULT_CAPABILITIES = createModelCapabilities({
  optionDescriptors: [
    {
      id: "thinking",
      label: "Thinking",
      type: "select",
      currentValue: "medium",
      options: PI_THINKING_LEVELS.map((value) =>
        makePiOption(
          value,
          value === "xhigh" ? "XHigh" : value.charAt(0).toUpperCase() + value.slice(1),
          value === "medium",
        ),
      ),
    },
    {
      id: "tools",
      label: "Tools",
      type: "select",
      options: PI_TOOL_MODES.map((value) => ({
        id: value,
        label: value === "off" ? "Off" : value === "read-only" ? "Read-only" : "Full",
      })),
    },
    {
      id: "steering",
      label: "Streaming input",
      type: "select",
      currentValue: "steer",
      options: PI_STEERING_MODES.map((value) =>
        makePiOption(value, value === "followUp" ? "Follow-up" : "Steer", value === "steer"),
      ),
    },
  ],
});

export interface PiListedModel {
  readonly provider: string;
  readonly modelId: string;
  readonly slug: string;
}

export function formatPiModelSlug(provider: string, modelId: string): string {
  return `${provider}/${modelId}`;
}

function isPiListModelsHeaderLine(line: string): boolean {
  const match = line.match(/^(\S+)\s+(\S+)/);
  return match?.[1]?.toLowerCase() === "provider" && match?.[2]?.toLowerCase() === "model";
}

export function parsePiListModelsOutput(output: string): ReadonlyArray<PiListedModel> {
  const lines = output.split(/\r?\n/);
  const models: PiListedModel[] = [];
  const seen = new Set<string>();

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || isPiListModelsHeaderLine(trimmed)) {
      continue;
    }
    const match = trimmed.match(/^(\S+)\s+(\S+)/);
    if (!match) {
      continue;
    }
    const provider = match[1]!;
    const modelId = match[2]!;
    const slug = formatPiModelSlug(provider, modelId);
    if (seen.has(slug)) {
      continue;
    }
    seen.add(slug);
    models.push({ provider, modelId, slug });
  }

  return models;
}

export function piListedModelsToServerModels(
  listed: ReadonlyArray<PiListedModel>,
): ReadonlyArray<ServerProviderModel> {
  return listed.map((entry) => ({
    slug: entry.slug,
    name: entry.modelId,
    isCustom: false,
    capabilities: DEFAULT_CAPABILITIES,
  }));
}

export function withPiModelCapabilities(model: ServerProviderModel): ServerProviderModel {
  return {
    ...model,
    capabilities: DEFAULT_CAPABILITIES,
  };
}

export function mergePiProviderModels(input: {
  readonly builtInModels: ReadonlyArray<ServerProviderModel>;
  readonly discoveredModels: ReadonlyArray<ServerProviderModel>;
  readonly customModelSlugs: ReadonlyArray<string>;
}): ReadonlyArray<ServerProviderModel> {
  const merged = new Map<string, ServerProviderModel>();

  for (const model of input.builtInModels) {
    merged.set(model.slug, withPiModelCapabilities(model));
  }
  for (const model of input.discoveredModels) {
    merged.set(model.slug, withPiModelCapabilities(model));
  }
  for (const rawSlug of input.customModelSlugs) {
    const slug = rawSlug.trim();
    if (!slug.includes("/") || merged.has(slug)) {
      continue;
    }
    merged.set(slug, {
      slug,
      name: slug,
      isCustom: true,
      capabilities: DEFAULT_CAPABILITIES,
    });
  }

  return [...merged.values()].toSorted((left, right) => left.slug.localeCompare(right.slug));
}

export const PI_PROVIDER = PROVIDER;
