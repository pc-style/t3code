import { type PiAgentSettings, type ServerProviderModel } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import { ChildProcess } from "effect/unstable/process";

import { createModelCapabilities } from "@t3tools/shared/model";
import {
  mergePiProviderModels,
  parsePiListModelsOutput,
  PI_PROVIDER,
  piListedModelsToServerModels,
} from "../pi/PiModelList.ts";
import {
  buildServerProvider,
  DEFAULT_TIMEOUT_MS,
  parseGenericCliVersion,
  spawnAndCollect,
  type ServerProviderDraft,
} from "../providerSnapshot.ts";

const PI_PRESENTATION = {
  displayName: "Pi",
  showInteractionModeToggle: true,
} as const;

const DEFAULT_PI_MODEL_CAPABILITIES = createModelCapabilities({ optionDescriptors: [] });

const BUILTIN_PI_MODELS: ReadonlyArray<ServerProviderModel> = [
  {
    slug: "anthropic/claude-sonnet-4-6",
    name: "Claude Sonnet 4.6",
    isCustom: false,
    capabilities: DEFAULT_PI_MODEL_CAPABILITIES,
  },
  {
    slug: "openai/gpt-5.4",
    name: "GPT-5.4",
    isCustom: false,
    capabilities: DEFAULT_PI_MODEL_CAPABILITIES,
  },
  {
    slug: "opencode-go/deepseek-v4-flash",
    name: "DeepSeek V4 Flash (OpenCode Go)",
    isCustom: false,
    capabilities: DEFAULT_PI_MODEL_CAPABILITIES,
  },
];

const PI_AUTH_ENV_BY_PROVIDER: Record<string, readonly string[]> = {
  anthropic: ["ANTHROPIC_API_KEY"],
  openai: ["OPENAI_API_KEY"],
  "opencode-go": ["OPENCODE_GO_API_KEY", "OPENCODE_API_KEY"],
  google: ["GOOGLE_GENERATIVE_AI_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY"],
  gemini: ["GEMINI_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY", "GOOGLE_API_KEY"],
  groq: ["GROQ_API_KEY"],
  openrouter: ["OPENROUTER_API_KEY"],
};

export function parsePiModelSlug(
  slug: string,
): { readonly provider: string; readonly modelId: string } | undefined {
  const trimmed = slug.trim();
  const slashIndex = trimmed.indexOf("/");
  if (slashIndex <= 0 || slashIndex >= trimmed.length - 1) {
    return undefined;
  }
  return {
    provider: trimmed.slice(0, slashIndex),
    modelId: trimmed.slice(slashIndex + 1),
  };
}

function buildPiProviderModels(
  piAgentSettings: PiAgentSettings,
  discoveredOutput?: string,
): ReadonlyArray<ServerProviderModel> {
  const discoveredModels = discoveredOutput
    ? piListedModelsToServerModels(parsePiListModelsOutput(discoveredOutput))
    : [];
  return mergePiProviderModels({
    builtInModels: BUILTIN_PI_MODELS,
    discoveredModels,
    customModelSlugs: piAgentSettings.customModels,
  });
}

export function resolvePiAuthStatus(input: {
  readonly models: ReadonlyArray<ServerProviderModel>;
  readonly environment: NodeJS.ProcessEnv;
}) {
  const providers = new Set(
    input.models
      .map((model) => parsePiModelSlug(model.slug)?.provider)
      .filter((provider): provider is string => typeof provider === "string"),
  );
  const envNames = [...providers].flatMap((provider) => PI_AUTH_ENV_BY_PROVIDER[provider] ?? []);
  const uniqueEnvNames = [...new Set(envNames)];
  if (uniqueEnvNames.length === 0) {
    return { status: "unknown" as const };
  }
  const presentEnvName = uniqueEnvNames.find((envName) => input.environment[envName]?.trim());
  if (presentEnvName) {
    return {
      status: "authenticated" as const,
      type: "environment",
      label: `Detected ${presentEnvName}`,
    };
  }
  return {
    status: "unauthenticated" as const,
    type: "environment",
    label: `Set one of ${uniqueEnvNames.join(", ")} for the configured Pi models.`,
  };
}

export const makePendingPiAgentProvider = (
  piAgentSettings: PiAgentSettings,
): Effect.Effect<ServerProviderDraft> =>
  Effect.gen(function* () {
    const checkedAt = yield* Effect.map(DateTime.now, DateTime.formatIso);
    const models = buildPiProviderModels(piAgentSettings);

    if (!piAgentSettings.enabled) {
      return buildServerProvider({
        driver: PI_PROVIDER,
        presentation: PI_PRESENTATION,
        enabled: false,
        checkedAt,
        models,
        probe: {
          installed: false,
          version: null,
          status: "warning",
          auth: { status: "unknown" },
          message: "Pi Agent is disabled in T3 Code settings.",
        },
      });
    }

    return buildServerProvider({
      driver: PI_PROVIDER,
      presentation: PI_PRESENTATION,
      enabled: true,
      checkedAt,
      models,
      probe: {
        installed: false,
        version: null,
        status: "warning",
        auth: { status: "unknown" },
        message: "Pi Agent provider status has not been checked in this session yet.",
      },
    });
  });

export const checkPiAgentProviderStatus = Effect.fn("checkPiAgentProviderStatus")(function* (
  piAgentSettings: PiAgentSettings,
  environment: NodeJS.ProcessEnv = process.env,
) {
  const checkedAt = DateTime.formatIso(yield* DateTime.now);
  const models = buildPiProviderModels(piAgentSettings);

  if (!piAgentSettings.enabled) {
    return buildServerProvider({
      driver: PI_PROVIDER,
      presentation: PI_PRESENTATION,
      enabled: false,
      checkedAt,
      models,
      probe: {
        installed: false,
        version: null,
        status: "warning",
        auth: { status: "unknown" },
        message: "Pi Agent is disabled in T3 Code settings.",
      },
    });
  }

  const binaryPath = piAgentSettings.binaryPath?.trim() || "pi";
  const versionProbe = yield* spawnAndCollect(
    binaryPath,
    ChildProcess.make(binaryPath, ["--version"], { env: environment }),
  ).pipe(Effect.timeoutOption(DEFAULT_TIMEOUT_MS), Effect.result);

  if (Result.isFailure(versionProbe)) {
    const error = versionProbe.failure;
    const message =
      error.message.toLowerCase().includes("enoent") ||
      error.message.toLowerCase().includes("notfound")
        ? "Pi Agent CLI (`pi`) is not installed or not on PATH. Install with `npm install -g @earendil-works/pi-coding-agent` or https://pi.dev/install.sh."
        : `Failed to execute Pi Agent CLI health check: ${error.message}`;
    return buildServerProvider({
      driver: PI_PROVIDER,
      presentation: PI_PRESENTATION,
      enabled: true,
      checkedAt,
      models,
      probe: {
        installed: false,
        version: null,
        status: "error",
        auth: { status: "unknown" },
        message,
      },
    });
  }

  if (Option.isNone(versionProbe.success)) {
    return buildServerProvider({
      driver: PI_PROVIDER,
      presentation: PI_PRESENTATION,
      enabled: true,
      checkedAt,
      models,
      probe: {
        installed: true,
        version: null,
        status: "error",
        auth: { status: "unknown" },
        message: "Pi Agent CLI is installed but `--version` timed out.",
      },
    });
  }

  const versionResult = versionProbe.success.value;
  const parsedVersion = parseGenericCliVersion(`${versionResult.stdout}\n${versionResult.stderr}`);
  if (versionResult.code !== 0) {
    return buildServerProvider({
      driver: PI_PROVIDER,
      presentation: PI_PRESENTATION,
      enabled: true,
      checkedAt,
      models,
      probe: {
        installed: true,
        version: parsedVersion,
        status: "error",
        auth: { status: "unknown" },
        message: "Pi Agent CLI is installed but failed to run. Check `pi --help` in a terminal.",
      },
    });
  }

  const listModelsProbe = yield* spawnAndCollect(
    binaryPath,
    ChildProcess.make(binaryPath, ["--list-models"], { env: environment }),
  ).pipe(Effect.timeoutOption(DEFAULT_TIMEOUT_MS), Effect.result);

  const listModelsResult =
    Result.isSuccess(listModelsProbe) && Option.isSome(listModelsProbe.success)
      ? listModelsProbe.success.value
      : null;

  const resolvedModels =
    listModelsResult !== null && listModelsResult.code === 0
      ? buildPiProviderModels(
          piAgentSettings,
          `${listModelsResult.stdout}\n${listModelsResult.stderr}`,
        )
      : models;
  const auth = resolvePiAuthStatus({ models: resolvedModels, environment });

  return buildServerProvider({
    driver: PI_PROVIDER,
    presentation: PI_PRESENTATION,
    enabled: true,
    checkedAt,
    models: resolvedModels,
    probe: {
      installed: true,
      version: parsedVersion,
      status: auth.status === "unauthenticated" ? "warning" : "ready",
      auth,
      message:
        auth.status === "unauthenticated"
          ? "Pi Agent CLI is installed, but no matching provider credential environment variable was detected."
          : resolvedModels.length > models.length
            ? `Pi Agent CLI is installed. Discovered ${resolvedModels.length} models via \`pi --list-models\`.`
            : "Pi Agent CLI is installed. Authenticate with provider API keys or run `pi /login` in a terminal.",
    },
  });
});
