import {
  TextGenerationError,
  type ChatAttachment,
  type ModelSelection,
  type PiAgentSettings,
} from "@t3tools/contracts";
import { sanitizeBranchFragment, sanitizeFeatureBranchName } from "@t3tools/shared/git";
import { extractJsonObject } from "@t3tools/shared/schemaJson";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import { ChildProcessSpawner } from "effect/unstable/process";
import { readFile } from "node:fs/promises";

import { ServerConfig } from "../config.ts";
import { parsePiModelSlug } from "../provider/Layers/PiAgentProvider.ts";
import {
  makePiRpcSessionRuntime,
  PiRpcSessionRuntimeError,
  type PiRpcImageContent,
} from "../provider/pi/PiRpcSessionRuntime.ts";
import { resolveAttachmentPath } from "../attachmentStore.ts";
import {
  buildBranchNamePrompt,
  buildCommitMessagePrompt,
  buildPrContentPrompt,
  buildThreadTitlePrompt,
} from "./TextGenerationPrompts.ts";
import type { TextGenerationShape } from "./TextGeneration.ts";
import {
  sanitizeCommitSubject,
  sanitizePrTitle,
  sanitizeThreadTitle,
} from "./TextGenerationUtils.ts";

const PI_TEXT_GENERATION_TIMEOUT_MS = 180_000;

function splitLaunchArgs(value: string | undefined): ReadonlyArray<string> {
  return value?.trim().split(/\s+/u).filter(Boolean) ?? [];
}

function piTextGenerationDetail(cause: unknown): string {
  if (PiRpcSessionRuntimeError.is(cause)) return cause.detail;
  if (cause instanceof Error) return cause.message;
  return String(cause);
}

export const makePiAgentEnvironment = (
  settings: Pick<PiAgentSettings, "configDir" | "sessionDir">,
  environment: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv => ({
  ...environment,
  ...(settings.configDir.trim() ? { PI_CODING_AGENT_DIR: settings.configDir.trim() } : {}),
  ...(settings.sessionDir.trim()
    ? { PI_CODING_AGENT_SESSION_DIR: settings.sessionDir.trim() }
    : {}),
});

export const makePiAgentLaunchArgs = (
  settings: Pick<PiAgentSettings, "sessionDir" | "launchArgs">,
): ReadonlyArray<string> => [
  ...(settings.sessionDir.trim() ? ["--session-dir", settings.sessionDir.trim()] : []),
  ...splitLaunchArgs(settings.launchArgs),
];

export const makePiAgentTextGeneration = Effect.fn("makePiAgentTextGeneration")(function* (
  piAgentSettings: PiAgentSettings,
  environment: NodeJS.ProcessEnv = process.env,
) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const serverConfig = yield* ServerConfig;
  const binaryPath = piAgentSettings.binaryPath.trim() || "pi";
  const processEnv = makePiAgentEnvironment(piAgentSettings, environment);
  const launchArgs = makePiAgentLaunchArgs(piAgentSettings);

  const buildPromptImages = (
    operation:
      | "generateCommitMessage"
      | "generatePrContent"
      | "generateBranchName"
      | "generateThreadTitle",
    attachments: ReadonlyArray<ChatAttachment> | undefined,
  ) =>
    Effect.gen(function* () {
      const images: PiRpcImageContent[] = [];
      for (const attachment of attachments ?? []) {
        const attachmentPath = resolveAttachmentPath({
          attachmentsDir: serverConfig.attachmentsDir,
          attachment,
        });
        if (!attachmentPath) continue;
        const bytes = yield* Effect.tryPromise({
          try: () => readFile(attachmentPath),
          catch: (cause) =>
            new TextGenerationError({
              operation,
              detail: piTextGenerationDetail(cause),
              cause,
            }),
        });
        images.push({
          type: "image",
          data: Buffer.from(bytes).toString("base64"),
          mimeType: attachment.mimeType,
        });
      }
      return images;
    });

  const runPiJson = Effect.fn("runPiJson")(function* <S extends Schema.Top>(input: {
    readonly operation:
      | "generateCommitMessage"
      | "generatePrContent"
      | "generateBranchName"
      | "generateThreadTitle";
    readonly cwd: string;
    readonly prompt: string;
    readonly outputSchemaJson: S;
    readonly modelSelection: ModelSelection;
    readonly attachments?: ReadonlyArray<ChatAttachment> | undefined;
  }) {
    const parsedModel = parsePiModelSlug(input.modelSelection.model);
    if (!parsedModel) {
      return yield* new TextGenerationError({
        operation: input.operation,
        detail: "Pi model selection must use the 'provider/model' format.",
      });
    }

    const scope = yield* Scope.make();
    const runtime = yield* makePiRpcSessionRuntime({
      spawn: {
        command: binaryPath,
        args: [],
        cwd: input.cwd,
        env: processEnv,
      },
      childProcessSpawner: spawner,
      extraArgs: [
        ...launchArgs,
        "--no-session",
        "--no-tools",
        "--provider",
        parsedModel.provider,
        "--model",
        parsedModel.modelId,
      ],
    }).pipe(Effect.provideService(Scope.Scope, scope));

    const rawOutput = yield* Effect.gen(function* () {
      yield* runtime.start();
      const images = yield* buildPromptImages(input.operation, input.attachments);
      yield* runtime.prompt({
        message: input.prompt,
        ...(images.length > 0 ? { images } : {}),
      });
      const ended = yield* runtime.waitForAgentEnd(PI_TEXT_GENERATION_TIMEOUT_MS);
      if (!ended) {
        return yield* new PiRpcSessionRuntimeError({
          detail: "Timed out waiting for Pi agent_end.",
        });
      }
      const text = (yield* runtime.getLastAssistantText())?.trim() ?? "";
      if (text.length === 0) {
        return yield* new PiRpcSessionRuntimeError({ detail: "Pi returned empty output." });
      }
      return text;
    }).pipe(
      Effect.mapError(
        (cause) =>
          new TextGenerationError({
            operation: input.operation,
            detail: piTextGenerationDetail(cause),
            cause,
          }),
      ),
      Effect.ensuring(runtime.stop().pipe(Effect.ignore)),
      Effect.ensuring(Scope.close(scope, Exit.void).pipe(Effect.ignore)),
    );

    const decodeOutput = Schema.decodeEffect(Schema.fromJsonString(input.outputSchemaJson));
    return yield* decodeOutput(extractJsonObject(rawOutput)).pipe(
      Effect.catchTag("SchemaError", (cause) =>
        Effect.fail(
          new TextGenerationError({
            operation: input.operation,
            detail: "Pi returned invalid structured output.",
            cause,
          }),
        ),
      ),
    );
  });

  return {
    generateCommitMessage: Effect.fn("PiAgentTextGeneration.generateCommitMessage")(function* (
      input,
    ) {
      const { prompt, outputSchema } = buildCommitMessagePrompt({
        branch: input.branch,
        stagedSummary: input.stagedSummary,
        stagedPatch: input.stagedPatch,
        includeBranch: input.includeBranch === true,
      });
      const generated = yield* runPiJson({
        operation: "generateCommitMessage",
        cwd: input.cwd,
        prompt,
        outputSchemaJson: outputSchema,
        modelSelection: input.modelSelection,
      });
      return {
        subject: sanitizeCommitSubject(generated.subject),
        body: generated.body.trim(),
        ...("branch" in generated && typeof generated.branch === "string"
          ? { branch: sanitizeFeatureBranchName(generated.branch) }
          : {}),
      };
    }),
    generatePrContent: Effect.fn("PiAgentTextGeneration.generatePrContent")(function* (input) {
      const { prompt, outputSchema } = buildPrContentPrompt({
        baseBranch: input.baseBranch,
        headBranch: input.headBranch,
        commitSummary: input.commitSummary,
        diffSummary: input.diffSummary,
        diffPatch: input.diffPatch,
      });
      const generated = yield* runPiJson({
        operation: "generatePrContent",
        cwd: input.cwd,
        prompt,
        outputSchemaJson: outputSchema,
        modelSelection: input.modelSelection,
      });
      return { title: sanitizePrTitle(generated.title), body: generated.body.trim() };
    }),
    generateBranchName: Effect.fn("PiAgentTextGeneration.generateBranchName")(function* (input) {
      const { prompt, outputSchema } = buildBranchNamePrompt({
        message: input.message,
        attachments: input.attachments,
      });
      const generated = yield* runPiJson({
        operation: "generateBranchName",
        cwd: input.cwd,
        prompt,
        outputSchemaJson: outputSchema,
        modelSelection: input.modelSelection,
        attachments: input.attachments,
      });
      return { branch: sanitizeBranchFragment(generated.branch) };
    }),
    generateThreadTitle: Effect.fn("PiAgentTextGeneration.generateThreadTitle")(function* (input) {
      const { prompt, outputSchema } = buildThreadTitlePrompt({
        message: input.message,
        attachments: input.attachments,
      });
      const generated = yield* runPiJson({
        operation: "generateThreadTitle",
        cwd: input.cwd,
        prompt,
        outputSchemaJson: outputSchema,
        modelSelection: input.modelSelection,
        attachments: input.attachments,
      });
      return { title: sanitizeThreadTitle(generated.title) };
    }),
  } satisfies TextGenerationShape;
});
