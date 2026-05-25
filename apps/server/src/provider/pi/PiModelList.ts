import { ProviderDriverKind, type ServerProviderModel } from "@t3tools/contracts";

import { createModelCapabilities } from "@t3tools/shared/model";

const PROVIDER = ProviderDriverKind.make("piAgent");
const DEFAULT_CAPABILITIES = createModelCapabilities({ optionDescriptors: [] });

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

export function mergePiProviderModels(input: {
  readonly builtInModels: ReadonlyArray<ServerProviderModel>;
  readonly discoveredModels: ReadonlyArray<ServerProviderModel>;
  readonly customModelSlugs: ReadonlyArray<string>;
}): ReadonlyArray<ServerProviderModel> {
  const merged = new Map<string, ServerProviderModel>();

  for (const model of input.builtInModels) {
    merged.set(model.slug, model);
  }
  for (const model of input.discoveredModels) {
    merged.set(model.slug, model);
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
