import {
  type PiAgentSettings,
  type ServerProviderModel,
  type ServerProviderSlashCommand,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { ChildProcess } from "effect/unstable/process";
import { homedir } from "node:os";

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
const PI_SLASH_COMMANDS: ReadonlyArray<ServerProviderSlashCommand> = [
  {
    name: "login",
    description: "Open Pi's provider login flow inside this session.",
    input: { hint: "provider" },
  },
  {
    name: "logout",
    description: "Log out of a Pi provider inside this session.",
    input: { hint: "provider" },
  },
  {
    name: "settings",
    description: "Open Pi settings.",
  },
  {
    name: "model",
    description: "Switch the active Pi model.",
    input: { hint: "provider/model" },
  },
  {
    name: "scoped-models",
    description: "Configure Pi scoped models.",
  },
  {
    name: "export",
    description: "Export the current Pi session.",
  },
  {
    name: "import",
    description: "Import a Pi session.",
  },
  {
    name: "share",
    description: "Share the current Pi session.",
  },
  {
    name: "copy",
    description: "Copy the current Pi session.",
  },
  {
    name: "name",
    description: "Rename the current Pi session.",
    input: { hint: "name" },
  },
  {
    name: "session",
    description: "Show Pi session details.",
  },
  {
    name: "changelog",
    description: "Show the Pi changelog.",
  },
  {
    name: "hotkeys",
    description: "Show Pi hotkeys.",
  },
  {
    name: "fork",
    description: "Fork the current Pi session.",
  },
  {
    name: "clone",
    description: "Clone a Pi session.",
    input: { hint: "session" },
  },
  {
    name: "tree",
    description: "Show the Pi session tree.",
  },
  {
    name: "new",
    description: "Start a new Pi session.",
  },
  {
    name: "compact",
    description: "Compact the current Pi session context.",
  },
  {
    name: "resume",
    description: "Resume a Pi session.",
    input: { hint: "session" },
  },
  {
    name: "reload",
    description: "Reload the current Pi session.",
  },
  {
    name: "quit",
    description: "Quit the Pi session.",
  },
];

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
  {
    slug: "openai-codex/gpt-5-codex",
    name: "GPT-5 Codex",
    isCustom: false,
    capabilities: DEFAULT_PI_MODEL_CAPABILITIES,
  },
  {
    slug: "github-copilot/gpt-5",
    name: "GPT-5 (GitHub Copilot)",
    isCustom: false,
    capabilities: DEFAULT_PI_MODEL_CAPABILITIES,
  },
];

const PI_AUTH_ENV_BY_PROVIDER: Record<string, readonly string[]> = {
  anthropic: ["ANTHROPIC_OAUTH_TOKEN", "ANTHROPIC_API_KEY"],
  "amazon-bedrock": [
    "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY",
    "AWS_PROFILE",
    "AWS_WEB_IDENTITY_TOKEN_FILE",
    "AWS_BEARER_TOKEN_BEDROCK",
    "AWS_CONTAINER_CREDENTIALS_RELATIVE_URI",
    "AWS_CONTAINER_CREDENTIALS_FULL_URI",
  ],
  azure: ["AZURE_OPENAI_API_KEY", "AZURE_API_KEY"],
  "azure-openai": ["AZURE_OPENAI_API_KEY", "AZURE_API_KEY"],
  "azure-openai-responses": ["AZURE_OPENAI_API_KEY", "AZURE_API_KEY"],
  bedrock: [
    "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY",
    "AWS_PROFILE",
    "AWS_WEB_IDENTITY_TOKEN_FILE",
    "AWS_BEARER_TOKEN_BEDROCK",
    "AWS_CONTAINER_CREDENTIALS_RELATIVE_URI",
    "AWS_CONTAINER_CREDENTIALS_FULL_URI",
  ],
  cerebras: ["CEREBRAS_API_KEY"],
  "cloudflare-ai-gateway": ["CLOUDFLARE_API_KEY", "CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_GATEWAY_ID"],
  "cloudflare-workers-ai": ["CLOUDFLARE_API_KEY"],
  cohere: ["COHERE_API_KEY"],
  deepseek: ["DEEPSEEK_API_KEY"],
  fireworks: ["FIREWORKS_API_KEY"],
  "github-copilot": ["COPILOT_GITHUB_TOKEN"],
  "google-vertex": [
    "GOOGLE_CLOUD_API_KEY",
    "GOOGLE_APPLICATION_CREDENTIALS",
    "GOOGLE_CLOUD_PROJECT",
    "GCLOUD_PROJECT",
    "GOOGLE_CLOUD_LOCATION",
  ],
  huggingface: ["HF_TOKEN"],
  "kimi-coding": ["KIMI_API_KEY"],
  minimax: ["MINIMAX_API_KEY"],
  "minimax-cn": ["MINIMAX_CN_API_KEY"],
  moonshotai: ["MOONSHOT_API_KEY"],
  "moonshotai-cn": ["MOONSHOT_API_KEY"],
  openai: ["OPENAI_API_KEY"],
  "openai-codex": [],
  "openai-compatible": ["OPENAI_API_KEY"],
  opencode: ["OPENCODE_API_KEY"],
  "opencode-go": ["OPENCODE_API_KEY"],
  google: ["GOOGLE_GENERATIVE_AI_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY"],
  gemini: ["GEMINI_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY", "GOOGLE_API_KEY"],
  groq: ["GROQ_API_KEY"],
  mistral: ["MISTRAL_API_KEY"],
  openrouter: ["OPENROUTER_API_KEY"],
  perplexity: ["PERPLEXITY_API_KEY"],
  together: ["TOGETHER_API_KEY"],
  "vercel-ai-gateway": ["AI_GATEWAY_API_KEY"],
  vertex: [
    "GOOGLE_CLOUD_API_KEY",
    "GOOGLE_APPLICATION_CREDENTIALS",
    "GOOGLE_CLOUD_PROJECT",
    "GCLOUD_PROJECT",
    "GOOGLE_CLOUD_LOCATION",
  ],
  xai: ["XAI_API_KEY"],
  xiaomi: ["XIAOMI_API_KEY"],
  "xiaomi-token-plan-ams": ["XIAOMI_TOKEN_PLAN_AMS_API_KEY"],
  "xiaomi-token-plan-cn": ["XIAOMI_TOKEN_PLAN_CN_API_KEY"],
  "xiaomi-token-plan-sgp": ["XIAOMI_TOKEN_PLAN_SGP_API_KEY"],
  zai: ["ZAI_API_KEY"],
};

const PI_OAUTH_PROVIDERS = new Set(["anthropic", "github-copilot", "openai-codex"]);

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

function defaultPiProviderAuthEnv(provider: string): string | undefined {
  const normalized = provider
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/gu, "_")
    .replace(/^_+|_+$/gu, "");
  return normalized ? `${normalized}_API_KEY` : undefined;
}

function piAuthEnvNamesForProvider(provider: string): ReadonlyArray<string> {
  const configured = PI_AUTH_ENV_BY_PROVIDER[provider] ?? [];
  if (configured.length > 0) {
    return configured;
  }
  if (provider in PI_AUTH_ENV_BY_PROVIDER) {
    return [];
  }
  const fallback = defaultPiProviderAuthEnv(provider);
  return fallback ? [fallback] : [];
}

function resolvePiConfigDir(
  path: Path.Path,
  settings?: Pick<PiAgentSettings, "configDir">,
): string {
  const configured = settings?.configDir.trim();
  return configured ? configured : path.join(homedir(), ".pi");
}

function resolvePiAuthJsonPath(
  path: Path.Path,
  settings?: Pick<PiAgentSettings, "configDir">,
): string {
  return path.join(resolvePiConfigDir(path, settings), "agent", "auth.json");
}

function resolvePiSettingsJsonPath(
  path: Path.Path,
  settings?: Pick<PiAgentSettings, "configDir">,
): string {
  return path.join(resolvePiConfigDir(path, settings), "agent", "settings.json");
}

const collectProcSelfEnvironment = Effect.fn("collectProcSelfEnvironment")(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const rawEnvironment = yield* fileSystem
    .readFileString("/proc/self/environ")
    .pipe(Effect.orElseSucceed(() => ""));
  if (!rawEnvironment) {
    return {};
  }
  return Object.fromEntries(
    rawEnvironment
      .split("\0")
      .filter(Boolean)
      .map((entry) => {
        const separatorIndex = entry.indexOf("=");
        return separatorIndex === -1
          ? [entry, ""]
          : [entry.slice(0, separatorIndex), entry.slice(separatorIndex + 1)];
      }),
  );
});

function hasProviderCredentialInAuthJson(value: unknown, providers: ReadonlySet<string>): boolean {
  if (!value || typeof value !== "object") {
    return false;
  }
  if (Array.isArray(value)) {
    return value.some((nested) => hasProviderCredentialInAuthJson(nested, providers));
  }
  return Object.entries(value).some(([key, nested]) => {
    if (providers.has(key) && nested !== null && nested !== undefined) {
      return true;
    }
    if (
      key === "provider" &&
      typeof nested === "string" &&
      providers.has(nested) &&
      Object.keys(value).some((entryKey) =>
        [
          "apiKey",
          "api_key",
          "accessToken",
          "access_token",
          "refreshToken",
          "refresh_token",
        ].includes(entryKey),
      )
    ) {
      return true;
    }
    return hasProviderCredentialInAuthJson(nested, providers);
  });
}

function parseJsonObject(contents: string): Option.Option<Record<string, unknown>> {
  const parsed = Schema.decodeUnknownOption(Schema.UnknownFromJsonString)(contents);
  if (
    Option.isNone(parsed) ||
    !parsed.value ||
    typeof parsed.value !== "object" ||
    Array.isArray(parsed.value)
  ) {
    return Option.none();
  }
  return Option.some(parsed.value as Record<string, unknown>);
}

const resolvePiAuthJsonStatus = Effect.fn("resolvePiAuthJsonStatus")(function* (input: {
  readonly providers: ReadonlySet<string>;
  readonly settings?: Pick<PiAgentSettings, "configDir">;
  readonly authJsonPath?: string;
}) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const authJsonPath = input.authJsonPath ?? resolvePiAuthJsonPath(path, input.settings);
  const exists = yield* fileSystem.exists(authJsonPath).pipe(Effect.orElseSucceed(() => false));
  if (!exists) {
    return undefined;
  }
  const raw = yield* fileSystem.readFileString(authJsonPath).pipe(
    Effect.map((contents) => ({ _tag: "Right" as const, contents })),
    Effect.orElseSucceed(() => ({ _tag: "Left" as const })),
  );
  if (raw._tag === "Left") {
    return {
      status: "unknown" as const,
      type: "file",
      label: `Could not read Pi auth store at ${authJsonPath}`,
    };
  }
  const parsed = parseJsonObject(raw.contents);
  if (Option.isNone(parsed)) {
    return {
      status: "unknown" as const,
      type: "file",
      label: `Could not read Pi auth store at ${authJsonPath}`,
    };
  }
  if (hasProviderCredentialInAuthJson(parsed.value, input.providers)) {
    return {
      status: "authenticated" as const,
      type: "file",
      label: `Detected Pi credentials in ${authJsonPath}`,
    };
  }
  return undefined;
});

export const resolvePiScopedModelPatterns = Effect.fn("resolvePiScopedModelPatterns")(function* (
  settings?: Pick<PiAgentSettings, "configDir">,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const settingsPath = resolvePiSettingsJsonPath(path, settings);
  const exists = yield* fileSystem.exists(settingsPath).pipe(Effect.orElseSucceed(() => false));
  if (!exists) {
    return [] as ReadonlyArray<string>;
  }
  const raw = yield* fileSystem.readFileString(settingsPath).pipe(Effect.orElseSucceed(() => ""));
  const parsed = parseJsonObject(raw);
  if (Option.isNone(parsed) || !Array.isArray(parsed.value.enabledModels)) {
    return [] as ReadonlyArray<string>;
  }
  return parsed.value.enabledModels
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter(Boolean);
});

function piScopedModelPatternToSlug(pattern: string): string | undefined {
  const scoped = pattern.trim();
  if (!scoped || /[*?[\]{}]/u.test(scoped)) {
    return undefined;
  }
  const slashIndex = scoped.indexOf("/");
  if (slashIndex <= 0) {
    return undefined;
  }
  const thinkingSeparator = scoped.indexOf(":", slashIndex + 1);
  const slug = (thinkingSeparator === -1 ? scoped : scoped.slice(0, thinkingSeparator)).trim();
  return parsePiModelSlug(slug) ? slug : undefined;
}

function scopedModelPatternsToServerModels(
  patterns: ReadonlyArray<string>,
): ReadonlyArray<ServerProviderModel> {
  const slugs = [
    ...new Set(
      patterns
        .map(piScopedModelPatternToSlug)
        .filter((slug): slug is string => typeof slug === "string"),
    ),
  ];
  return slugs.map((slug) => ({
    slug,
    name: slug,
    isCustom: false,
    capabilities: DEFAULT_PI_MODEL_CAPABILITIES,
  }));
}

export const resolvePiAuthStatus = Effect.fn("resolvePiAuthStatus")(function* (input: {
  readonly models: ReadonlyArray<ServerProviderModel>;
  readonly environment: NodeJS.ProcessEnv;
  readonly settings?: Pick<PiAgentSettings, "configDir">;
  readonly authJsonPath?: string;
  readonly includeProcSelfEnvironment?: boolean;
}) {
  const providers = new Set(
    input.models
      .map((model) => parsePiModelSlug(model.slug)?.provider)
      .filter((provider): provider is string => typeof provider === "string"),
  );
  const environment = input.includeProcSelfEnvironment
    ? { ...(yield* collectProcSelfEnvironment()), ...input.environment }
    : input.environment;
  const envNames = [...providers].flatMap(piAuthEnvNamesForProvider);
  const uniqueEnvNames = [...new Set(envNames)];
  const presentEnvName = uniqueEnvNames.find((envName) => environment[envName]?.trim());
  if (presentEnvName) {
    return {
      status: "authenticated" as const,
      type: "environment",
      label: `Detected ${presentEnvName}`,
    };
  }
  const authJsonStatus = yield* resolvePiAuthJsonStatus({
    providers,
    ...(input.settings ? { settings: input.settings } : {}),
    ...(input.authJsonPath ? { authJsonPath: input.authJsonPath } : {}),
  });
  if (authJsonStatus) {
    return authJsonStatus;
  }
  if (uniqueEnvNames.length === 0) {
    return {
      status: "unknown" as const,
      label: [...providers].some((provider) => PI_OAUTH_PROVIDERS.has(provider))
        ? "Run `/login` to authenticate this Pi OAuth provider."
        : undefined,
    };
  }
  return {
    status: "unauthenticated" as const,
    type: "environment",
    label: `Set one of ${uniqueEnvNames.join(", ")} or run \`/login\` for Pi-managed auth.`,
  };
});

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
        slashCommands: PI_SLASH_COMMANDS,
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
      slashCommands: PI_SLASH_COMMANDS,
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
      slashCommands: PI_SLASH_COMMANDS,
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
      slashCommands: PI_SLASH_COMMANDS,
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
      slashCommands: PI_SLASH_COMMANDS,
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
      slashCommands: PI_SLASH_COMMANDS,
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
  const scopedModelPatterns = yield* resolvePiScopedModelPatterns(piAgentSettings);
  const scopedModels = scopedModelPatternsToServerModels(scopedModelPatterns);

  const resolvedModels =
    listModelsResult !== null && listModelsResult.code === 0
      ? mergePiProviderModels({
          builtInModels: buildPiProviderModels(
            piAgentSettings,
            `${listModelsResult.stdout}\n${listModelsResult.stderr}`,
          ),
          discoveredModels: scopedModels,
          customModelSlugs: [],
        })
      : mergePiProviderModels({
          builtInModels: models,
          discoveredModels: scopedModels,
          customModelSlugs: [],
        });
  const discoveredViaListModels = listModelsResult !== null && listModelsResult.code === 0;
  const hasScopedModels = scopedModels.length > 0;
  const auth = yield* resolvePiAuthStatus({
    models: resolvedModels,
    environment,
    settings: piAgentSettings,
    includeProcSelfEnvironment: true,
  });

  return buildServerProvider({
    driver: PI_PROVIDER,
    presentation: PI_PRESENTATION,
    enabled: true,
    checkedAt,
    models: resolvedModels,
    slashCommands: PI_SLASH_COMMANDS,
    probe: {
      installed: true,
      version: parsedVersion,
      status: auth.status === "authenticated" ? "ready" : "warning",
      auth,
      message:
        auth.status === "unauthenticated"
          ? "Pi Agent CLI is installed, but no matching provider credential was detected. Set the provider API key or run `/login`."
          : auth.status === "unknown"
            ? (auth.label ??
              "Pi Agent CLI is installed, but provider authentication could not be verified.")
            : discoveredViaListModels && resolvedModels.length > models.length
              ? `Pi Agent CLI is installed. Discovered ${resolvedModels.length} models via \`pi --list-models\`.`
              : hasScopedModels && resolvedModels.length > models.length
                ? `Pi Agent CLI is installed. Loaded ${scopedModels.length} scoped models from Pi settings.`
                : "Pi Agent CLI is installed and provider credentials were detected.",
    },
  });
});
