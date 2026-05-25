import { describe, expect, it } from "vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { PiAgentSettings } from "@t3tools/contracts";
import { createModelCapabilities } from "@t3tools/shared/model";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import {
  makePendingPiAgentProvider,
  parsePiModelSlug,
  resolvePiAuthStatus,
} from "./PiAgentProvider.ts";

const decodePiSettings = Schema.decodeSync(PiAgentSettings);
const EMPTY_CAPABILITIES = createModelCapabilities({ optionDescriptors: [] });
const runNode = <A, E>(
  effect: Effect.Effect<A, E, FileSystem.FileSystem | Path.Path>,
): Promise<A> => Effect.runPromise(effect.pipe(Effect.provide(NodeServices.layer)));

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
    expect(snapshot.slashCommands.map((command) => command.name)).toEqual([
      "login",
      "logout",
      "settings",
      "model",
      "scoped-models",
      "export",
      "import",
      "share",
      "copy",
      "name",
      "session",
      "changelog",
      "hotkeys",
      "fork",
      "clone",
      "tree",
      "new",
      "compact",
      "resume",
      "reload",
      "quit",
    ]);
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
  it("marks Pi authenticated when a matching provider env var is present", async () => {
    expect(
      await runNode(
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
      ),
    ).toMatchObject({ status: "authenticated", type: "environment" });
  });

  it("returns unauthenticated guidance when credentials are missing", async () => {
    expect(
      await runNode(
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
      ),
    ).toMatchObject({ status: "unauthenticated", type: "environment" });
  });

  it("does not accept synthesized env names for known Pi providers", async () => {
    expect(
      await runNode(
        resolvePiAuthStatus({
          models: [
            {
              slug: "openai/gpt-5.4",
              name: "GPT-5.4",
              isCustom: false,
              capabilities: EMPTY_CAPABILITIES,
            },
          ],
          environment: { OPENAI_COMPATIBLE_API_KEY: "secret" },
        }),
      ),
    ).toMatchObject({
      status: "unauthenticated",
      label: "Set one of OPENAI_API_KEY or run `/login` for Pi-managed auth.",
    });
  });

  it("supports custom Pi providers with derived API key env names", async () => {
    expect(
      await runNode(
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
      ),
    ).toMatchObject({ status: "authenticated", label: "Detected PRIVATE_PROVIDER_API_KEY" });
  });

  it("returns unauthenticated for custom Pi providers when derived credentials are missing", async () => {
    expect(
      await runNode(
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
      ),
    ).toMatchObject({
      status: "unauthenticated",
      label: "Set one of PRIVATE_PROVIDER_API_KEY or run `/login` for Pi-managed auth.",
    });
  });

  it("covers Pi provider env mappings that were missing from T3", async () => {
    const cases = [
      ["vercel-ai-gateway/gpt-5", "AI_GATEWAY_API_KEY"],
      ["zai/glm-4.6", "ZAI_API_KEY"],
      ["minimax/minimax-m2", "MINIMAX_API_KEY"],
      ["minimax-cn/minimax-m2", "MINIMAX_CN_API_KEY"],
      ["moonshotai/kimi-k2", "MOONSHOT_API_KEY"],
      ["moonshotai-cn/kimi-k2", "MOONSHOT_API_KEY"],
      ["huggingface/deepseek-v3", "HF_TOKEN"],
      ["opencode/deepseek-v4-flash", "OPENCODE_API_KEY"],
      ["kimi-coding/kimi-k2", "KIMI_API_KEY"],
      ["cloudflare-workers-ai/llama", "CLOUDFLARE_API_KEY"],
      ["cloudflare-ai-gateway/gpt-5", "CLOUDFLARE_API_KEY"],
      ["xiaomi/mi-model", "XIAOMI_API_KEY"],
      ["xiaomi-token-plan-cn/mi-model", "XIAOMI_TOKEN_PLAN_CN_API_KEY"],
      ["xiaomi-token-plan-ams/mi-model", "XIAOMI_TOKEN_PLAN_AMS_API_KEY"],
      ["xiaomi-token-plan-sgp/mi-model", "XIAOMI_TOKEN_PLAN_SGP_API_KEY"],
    ] as const;

    for (const [slug, envName] of cases) {
      expect(
        await runNode(
          resolvePiAuthStatus({
            models: [{ slug, name: slug, isCustom: false, capabilities: EMPTY_CAPABILITIES }],
            environment: { [envName]: "secret" },
          }),
        ),
      ).toMatchObject({ status: "authenticated", label: `Detected ${envName}` });
    }
  });

  it("uses Pi provider slugs instead of old T3 aliases", async () => {
    const cases = [
      ["amazon-bedrock/claude-sonnet", "AWS_BEARER_TOKEN_BEDROCK"],
      ["google-vertex/gemini-pro", "GOOGLE_CLOUD_API_KEY"],
      ["azure-openai-responses/gpt-5", "AZURE_OPENAI_API_KEY"],
      ["google/gemini-pro", "GEMINI_API_KEY"],
    ] as const;

    for (const [slug, envName] of cases) {
      expect(
        await runNode(
          resolvePiAuthStatus({
            models: [{ slug, name: slug, isCustom: false, capabilities: EMPTY_CAPABILITIES }],
            environment: { [envName]: "secret" },
          }),
        ),
      ).toMatchObject({ status: "authenticated", label: `Detected ${envName}` });
    }
  });

  it("matches Pi-specific OAuth and token environment names", async () => {
    const cases = [
      ["anthropic/claude-sonnet-4-6", "ANTHROPIC_OAUTH_TOKEN"],
      ["github-copilot/gpt-5", "COPILOT_GITHUB_TOKEN"],
      ["opencode-go/deepseek-v4-flash", "OPENCODE_API_KEY"],
    ] as const;

    for (const [slug, envName] of cases) {
      expect(
        await runNode(
          resolvePiAuthStatus({
            models: [{ slug, name: slug, isCustom: false, capabilities: EMPTY_CAPABILITIES }],
            environment: { [envName]: "secret" },
          }),
        ),
      ).toMatchObject({ status: "authenticated", label: `Detected ${envName}` });
    }
  });

  it("detects Pi-managed OAuth and auth.json credentials", async () => {
    await runNode(
      Effect.scoped(
        Effect.gen(function* () {
          const fileSystem = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-pi-auth-" });
          const authDir = path.join(root, "agent");
          const authJsonPath = path.join(authDir, "auth.json");
          yield* fileSystem.makeDirectory(authDir, { recursive: true });
          yield* fileSystem.writeFileString(
            authJsonPath,
            `{"openai-codex":{"type":"oauth","accessToken":"token"}}`,
          );

          const status = yield* resolvePiAuthStatus({
            models: [
              {
                slug: "openai-codex/gpt-5-codex",
                name: "GPT-5 Codex",
                isCustom: false,
                capabilities: EMPTY_CAPABILITIES,
              },
            ],
            environment: {},
            settings: { configDir: root },
          });

          expect(status).toMatchObject({ status: "authenticated", type: "file" });
        }),
      ),
    );
  });

  it("does not match auth.json provider keys by substring", async () => {
    await runNode(
      Effect.scoped(
        Effect.gen(function* () {
          const fileSystem = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-pi-auth-" });
          const authDir = path.join(root, "agent");
          yield* fileSystem.makeDirectory(authDir, { recursive: true });
          yield* fileSystem.writeFileString(
            path.join(authDir, "auth.json"),
            `{"openai-codex":{"type":"oauth","accessToken":"token"}}`,
          );

          const status = yield* resolvePiAuthStatus({
            models: [
              {
                slug: "openai/gpt-5.4",
                name: "GPT-5.4",
                isCustom: false,
                capabilities: EMPTY_CAPABILITIES,
              },
            ],
            environment: {},
            settings: { configDir: root },
          });

          expect(status).toMatchObject({ status: "unauthenticated" });
        }),
      ),
    );
  });

  it("does not treat unrelated auth.json entries as OAuth authentication", async () => {
    await runNode(
      Effect.scoped(
        Effect.gen(function* () {
          const fileSystem = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-pi-auth-" });
          const authDir = path.join(root, "agent");
          yield* fileSystem.makeDirectory(authDir, { recursive: true });
          yield* fileSystem.writeFileString(
            path.join(authDir, "auth.json"),
            `{"anthropic":{"type":"oauth","accessToken":"token"}}`,
          );

          const status = yield* resolvePiAuthStatus({
            models: [
              {
                slug: "openai-codex/gpt-5-codex",
                name: "GPT-5 Codex",
                isCustom: false,
                capabilities: EMPTY_CAPABILITIES,
              },
            ],
            environment: {},
            settings: { configDir: root },
          });

          expect(status).toMatchObject({ status: "unknown" });
        }),
      ),
    );
  });
});
