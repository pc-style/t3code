import * as Data from "effect/Data";
import * as Duration from "effect/Duration";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import type { ChildProcessHandle } from "effect/unstable/process/ChildProcessSpawner";

import { parsePiRpcLine, serializePiRpcLine, splitPiRpcBuffer } from "./PiRpcJsonl.ts";

export interface PiRpcSpawnInput {
  readonly command: string;
  readonly args: ReadonlyArray<string>;
  readonly cwd: string;
  readonly env?: NodeJS.ProcessEnv;
}

export interface PiRpcModelInfo {
  readonly provider: string;
  readonly id: string;
  readonly contextWindow?: number;
  readonly reasoning?: boolean;
}

export interface PiRpcImageContent {
  readonly type: "image";
  readonly data: string;
  readonly mimeType: string;
}

export interface PiRpcSessionState {
  readonly model: PiRpcModelInfo | null;
  readonly thinkingLevel: string;
  readonly isStreaming: boolean;
  readonly isCompacting: boolean;
  readonly steeringMode: string;
  readonly followUpMode: string;
  readonly sessionFile?: string;
  readonly sessionId?: string;
  readonly sessionName?: string;
  readonly autoCompactionEnabled: boolean;
  readonly messageCount: number;
  readonly pendingMessageCount: number;
}

export interface PiRpcSessionStats {
  readonly sessionFile?: string;
  readonly sessionId?: string;
  readonly userMessages: number;
  readonly assistantMessages: number;
  readonly toolCalls: number;
  readonly toolResults: number;
  readonly totalMessages: number;
  readonly tokens: {
    readonly input: number;
    readonly output: number;
    readonly cacheRead: number;
    readonly cacheWrite: number;
    readonly total: number;
  };
  readonly cost: number;
  readonly contextUsage?: {
    readonly tokens: number | null;
    readonly contextWindow: number;
    readonly percent: number | null;
  };
}

export interface PiRpcForkMessage {
  readonly entryId: string;
  readonly text: string;
}

export interface PiRpcCommandInfo {
  readonly name: string;
  readonly description?: string;
  readonly source: string;
  readonly location?: string;
  readonly path?: string;
}

export type PiRpcAgentEvent = Record<string, unknown> & { readonly type: string };

export interface PiRpcResponse {
  readonly type: "response";
  readonly id?: string;
  readonly command: string;
  readonly success: boolean;
  readonly data?: unknown;
  readonly error?: string;
}

export interface PiRpcSessionRuntimeShape {
  readonly start: () => Effect.Effect<void, PiRpcSessionRuntimeError, Scope.Scope>;
  readonly stop: () => Effect.Effect<void, PiRpcSessionRuntimeError>;
  readonly getEvents: () => Stream.Stream<PiRpcAgentEvent>;
  readonly getState: () => Effect.Effect<PiRpcSessionState, PiRpcSessionRuntimeError>;
  readonly getAvailableModels: () => Effect.Effect<
    ReadonlyArray<PiRpcModelInfo>,
    PiRpcSessionRuntimeError
  >;
  readonly setModel: (
    provider: string,
    modelId: string,
  ) => Effect.Effect<PiRpcModelInfo, PiRpcSessionRuntimeError>;
  readonly cycleModel: () => Effect.Effect<
    { readonly model: PiRpcModelInfo | null; readonly thinkingLevel: string },
    PiRpcSessionRuntimeError
  >;
  readonly prompt: (input: {
    readonly message: string;
    readonly images?: ReadonlyArray<PiRpcImageContent>;
    readonly streamingBehavior?: "steer" | "followUp";
  }) => Effect.Effect<void, PiRpcSessionRuntimeError>;
  readonly steer: (input: {
    readonly message: string;
    readonly images?: ReadonlyArray<PiRpcImageContent>;
  }) => Effect.Effect<void, PiRpcSessionRuntimeError>;
  readonly followUp: (input: {
    readonly message: string;
    readonly images?: ReadonlyArray<PiRpcImageContent>;
  }) => Effect.Effect<void, PiRpcSessionRuntimeError>;
  readonly abort: () => Effect.Effect<void, PiRpcSessionRuntimeError>;
  readonly newSession: (input?: {
    readonly parentSession?: string;
  }) => Effect.Effect<{ cancelled: boolean }, PiRpcSessionRuntimeError>;
  readonly getMessages: () => Effect.Effect<ReadonlyArray<unknown>, PiRpcSessionRuntimeError>;
  readonly setThinkingLevel: (level: string) => Effect.Effect<void, PiRpcSessionRuntimeError>;
  readonly cycleThinkingLevel: () => Effect.Effect<string | null, PiRpcSessionRuntimeError>;
  readonly setSteeringMode: (mode: string) => Effect.Effect<void, PiRpcSessionRuntimeError>;
  readonly setFollowUpMode: (mode: string) => Effect.Effect<void, PiRpcSessionRuntimeError>;
  readonly compact: (input?: {
    readonly customInstructions?: string;
  }) => Effect.Effect<Record<string, unknown> | null, PiRpcSessionRuntimeError>;
  readonly setAutoCompaction: (enabled: boolean) => Effect.Effect<void, PiRpcSessionRuntimeError>;
  readonly setAutoRetry: (enabled: boolean) => Effect.Effect<void, PiRpcSessionRuntimeError>;
  readonly abortRetry: () => Effect.Effect<void, PiRpcSessionRuntimeError>;
  readonly bash: (
    command: string,
  ) => Effect.Effect<Record<string, unknown>, PiRpcSessionRuntimeError>;
  readonly abortBash: () => Effect.Effect<void, PiRpcSessionRuntimeError>;
  readonly getSessionStats: () => Effect.Effect<PiRpcSessionStats | null, PiRpcSessionRuntimeError>;
  readonly exportHtml: (
    outputPath?: string,
  ) => Effect.Effect<string | null, PiRpcSessionRuntimeError>;
  readonly fork: (
    entryId: string,
  ) => Effect.Effect<
    { readonly text: string; readonly cancelled: boolean },
    PiRpcSessionRuntimeError
  >;
  readonly clone: () => Effect.Effect<{ cancelled: boolean }, PiRpcSessionRuntimeError>;
  readonly getForkMessages: () => Effect.Effect<
    ReadonlyArray<PiRpcForkMessage>,
    PiRpcSessionRuntimeError
  >;
  readonly getLastAssistantText: () => Effect.Effect<string | null, PiRpcSessionRuntimeError>;
  readonly setSessionName: (name: string) => Effect.Effect<void, PiRpcSessionRuntimeError>;
  readonly getCommands: () => Effect.Effect<
    ReadonlyArray<PiRpcCommandInfo>,
    PiRpcSessionRuntimeError
  >;
  readonly switchSession: (
    sessionPath: string,
  ) => Effect.Effect<{ cancelled: boolean }, PiRpcSessionRuntimeError>;
  readonly waitForAgentEnd: (
    timeoutMs?: number,
  ) => Effect.Effect<PiRpcAgentEvent | undefined, PiRpcSessionRuntimeError>;
  readonly sendExtensionUiResponse: (input: {
    readonly id: string;
    readonly value?: string;
    readonly confirmed?: boolean;
    readonly cancelled?: boolean;
  }) => Effect.Effect<void, PiRpcSessionRuntimeError>;
}

export class PiRpcSessionRuntimeError extends Data.TaggedError("PiRpcSessionRuntimeError")<{
  readonly detail: string;
  readonly cause?: unknown;
}> {
  static readonly is = (value: unknown): value is PiRpcSessionRuntimeError =>
    typeof value === "object" &&
    value !== null &&
    "_tag" in value &&
    value._tag === "PiRpcSessionRuntimeError";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPiRpcResponse(value: unknown): value is PiRpcResponse {
  return isRecord(value) && value.type === "response" && typeof value.command === "string";
}

function isPiAgentEvent(value: unknown): value is PiRpcAgentEvent {
  return isRecord(value) && typeof value.type === "string" && value.type !== "response";
}

function parseModelInfo(value: unknown): PiRpcModelInfo | null {
  if (!isRecord(value)) return null;
  if (typeof value.provider !== "string" || typeof value.id !== "string") {
    return null;
  }
  return {
    provider: value.provider,
    id: value.id,
    ...(typeof value.contextWindow === "number" ? { contextWindow: value.contextWindow } : {}),
    ...(typeof value.reasoning === "boolean" ? { reasoning: value.reasoning } : {}),
  };
}

export const makePiRpcSessionRuntime = (input: {
  readonly spawn: PiRpcSpawnInput;
  readonly childProcessSpawner: ChildProcessSpawner.ChildProcessSpawner["Service"];
  readonly extraArgs?: ReadonlyArray<string>;
}): Effect.Effect<PiRpcSessionRuntimeShape, never, Scope.Scope> =>
  Effect.gen(function* () {
    const scope = yield* Scope.Scope;
    const eventQueue = yield* Queue.unbounded<PiRpcAgentEvent>();
    const pendingRequests = yield* Ref.make(
      new Map<string, Deferred.Deferred<PiRpcResponse, PiRpcSessionRuntimeError>>(),
    );
    const requestCounter = yield* Ref.make(0);
    const lineBuffer = yield* Ref.make("");
    const processRef = yield* Ref.make<ChildProcessHandle | null>(null);
    const stdinWriteError = yield* Ref.make<PiRpcSessionRuntimeError | null>(null);
    const stderrRef = yield* Ref.make("");

    const rejectAllPending = (error: PiRpcSessionRuntimeError) =>
      Effect.gen(function* () {
        const pending = yield* Ref.get(pendingRequests);
        for (const deferred of pending.values()) {
          yield* Deferred.fail(deferred, error).pipe(Effect.ignore);
        }
        yield* Ref.set(pendingRequests, new Map());
      });

    const handleLine = (line: string) =>
      Effect.gen(function* () {
        const parsed = yield* Effect.try({
          try: () => parsePiRpcLine(line),
          catch: () => null,
        });
        if (parsed === null) {
          return;
        }

        if (isPiRpcResponse(parsed) && parsed.id) {
          const pending = yield* Ref.get(pendingRequests);
          const deferred = pending.get(parsed.id);
          if (deferred) {
            const next = new Map(pending);
            next.delete(parsed.id);
            yield* Ref.set(pendingRequests, next);
            yield* Deferred.succeed(deferred, parsed);
          }
          return;
        }

        if (isPiAgentEvent(parsed)) {
          yield* Queue.offer(eventQueue, parsed);
        }
      });

    const pumpStdout = (child: ChildProcessHandle) =>
      child.stdout.pipe(
        Stream.decodeText(),
        Stream.runForEach((chunk) =>
          Effect.gen(function* () {
            const combined = `${yield* Ref.get(lineBuffer)}${chunk}`;
            const split = splitPiRpcBuffer(combined);
            yield* Ref.set(lineBuffer, split.rest);
            for (const line of split.lines) {
              yield* handleLine(line);
            }
          }),
        ),
        Effect.mapError(
          (cause) => new PiRpcSessionRuntimeError({ detail: "Pi RPC stdout stream failed", cause }),
        ),
        Effect.catchCause((cause) =>
          Effect.gen(function* () {
            const error = PiRpcSessionRuntimeError.is(cause)
              ? cause
              : new PiRpcSessionRuntimeError({ detail: "Pi RPC stdout stream failed", cause });
            yield* rejectAllPending(error);
            yield* Queue.shutdown(eventQueue);
          }),
        ),
        Effect.forkIn(scope),
      );

    const pumpStderr = (child: ChildProcessHandle) =>
      child.stderr.pipe(
        Stream.decodeText(),
        Stream.runForEach((chunk) => Ref.update(stderrRef, (current) => current + chunk)),
        Effect.ignore,
        Effect.forkIn(scope),
      );

    const writeStdinLine = (line: string): Effect.Effect<void, PiRpcSessionRuntimeError> =>
      Effect.gen(function* () {
        const writeError = yield* Ref.get(stdinWriteError);
        if (writeError) {
          return yield* writeError;
        }
        const child = yield* Ref.get(processRef);
        if (!child) {
          return yield* new PiRpcSessionRuntimeError({ detail: "Pi RPC process is not running" });
        }
        yield* Stream.run(Stream.encodeText(Stream.make(line)), child.stdin).pipe(
          Effect.mapError(
            (cause) =>
              new PiRpcSessionRuntimeError({ detail: "Failed to write to Pi RPC stdin", cause }),
          ),
        );
      });

    const writeCommand = (
      command: Record<string, unknown>,
    ): Effect.Effect<PiRpcResponse, PiRpcSessionRuntimeError> =>
      Effect.gen(function* () {
        const id = `req_${yield* Ref.getAndUpdate(requestCounter, (value) => value + 1)}`;
        const payload = { ...command, id };
        const responseDeferred = yield* Deferred.make<PiRpcResponse, PiRpcSessionRuntimeError>();
        yield* Ref.update(pendingRequests, (pending) => {
          const next = new Map(pending);
          next.set(id, responseDeferred);
          return next;
        });

        const removePending = Ref.update(pendingRequests, (pending) => {
          const next = new Map(pending);
          next.delete(id);
          return next;
        });

        const response = yield* Effect.gen(function* () {
          yield* writeStdinLine(serializePiRpcLine(payload));
          return yield* Effect.race(
            Deferred.await(responseDeferred),
            Effect.sleep(Duration.seconds(60)).pipe(
              Effect.flatMap(() =>
                Effect.fail(
                  new PiRpcSessionRuntimeError({
                    detail: `Timeout waiting for Pi RPC response to ${String(command.type)}`,
                  }),
                ),
              ),
            ),
          );
        }).pipe(
          Effect.onError(() => removePending),
          Effect.mapError((cause) =>
            PiRpcSessionRuntimeError.is(cause)
              ? cause
              : new PiRpcSessionRuntimeError({
                  detail: `Pi RPC command ${String(command.type)} failed`,
                  cause,
                }),
          ),
        );

        if (!response.success) {
          return yield* new PiRpcSessionRuntimeError({
            detail: response.error ?? `Pi RPC command ${command.type} failed`,
          });
        }
        return response;
      });

    const start: PiRpcSessionRuntimeShape["start"] = () =>
      Effect.gen(function* () {
        const args = ["--mode", "rpc", ...(input.extraArgs ?? [])];
        const command = ChildProcess.make(input.spawn.command, args, {
          cwd: input.spawn.cwd,
          env: input.spawn.env ?? process.env,
          stdin: { stream: "pipe", endOnDone: false },
        });
        const child = yield* input.childProcessSpawner.spawn(command).pipe(
          Effect.provideService(Scope.Scope, scope),
          Effect.mapError(
            (cause) =>
              new PiRpcSessionRuntimeError({
                detail: `Failed to spawn Pi RPC process (${input.spawn.command})`,
                cause,
              }),
          ),
        );
        yield* Ref.set(processRef, child);
        yield* pumpStdout(child).pipe(Effect.catchCause(() => Effect.void));
        yield* pumpStderr(child).pipe(Effect.ignore);

        yield* child.exitCode.pipe(
          Effect.flatMap((code) =>
            Effect.gen(function* () {
              const stderr = yield* Ref.get(stderrRef);
              const error = new PiRpcSessionRuntimeError({
                detail: `Pi RPC process exited (code=${String(code)}). Stderr: ${stderr}`,
              });
              yield* Ref.set(stdinWriteError, error);
              yield* rejectAllPending(error);
              yield* Queue.shutdown(eventQueue);
            }),
          ),
          Effect.forkIn(scope),
        );
      });

    const stop: PiRpcSessionRuntimeShape["stop"] = () =>
      Effect.gen(function* () {
        const child = yield* Ref.get(processRef);
        if (!child) {
          return;
        }
        yield* child
          .kill()
          .pipe(
            Effect.mapError(
              (cause) =>
                new PiRpcSessionRuntimeError({ detail: "Failed to stop Pi RPC process", cause }),
            ),
          );
        yield* Ref.set(processRef, null);
        yield* Queue.shutdown(eventQueue).pipe(Effect.ignore);
      }).pipe(
        Effect.mapError((cause) =>
          PiRpcSessionRuntimeError.is(cause)
            ? cause
            : new PiRpcSessionRuntimeError({ detail: "Failed to stop Pi RPC process", cause }),
        ),
      );

    const getEvents = () => Stream.fromQueue(eventQueue);

    const getState = () =>
      writeCommand({ type: "get_state" }).pipe(
        Effect.flatMap((response) => {
          const data = response.data;
          if (!isRecord(data)) {
            return Effect.fail(
              new PiRpcSessionRuntimeError({ detail: "Pi RPC get_state returned invalid data" }),
            );
          }
          return Effect.succeed({
            model: parseModelInfo(data.model),
            thinkingLevel: typeof data.thinkingLevel === "string" ? data.thinkingLevel : "medium",
            isStreaming: data.isStreaming === true,
            isCompacting: data.isCompacting === true,
            steeringMode: typeof data.steeringMode === "string" ? data.steeringMode : "all",
            followUpMode:
              typeof data.followUpMode === "string" ? data.followUpMode : "one-at-a-time",
            autoCompactionEnabled: data.autoCompactionEnabled !== false,
            messageCount: typeof data.messageCount === "number" ? data.messageCount : 0,
            pendingMessageCount:
              typeof data.pendingMessageCount === "number" ? data.pendingMessageCount : 0,
            ...(typeof data.sessionFile === "string" ? { sessionFile: data.sessionFile } : {}),
            ...(typeof data.sessionId === "string" ? { sessionId: data.sessionId } : {}),
            ...(typeof data.sessionName === "string" ? { sessionName: data.sessionName } : {}),
          } satisfies PiRpcSessionState);
        }),
      );

    const getAvailableModels = () =>
      writeCommand({ type: "get_available_models" }).pipe(
        Effect.flatMap((response) => {
          if (!isRecord(response.data) || !Array.isArray(response.data.models)) {
            return Effect.succeed([] as ReadonlyArray<PiRpcModelInfo>);
          }
          const models = (response.data.models as ReadonlyArray<unknown>)
            .map(parseModelInfo)
            .filter((model): model is PiRpcModelInfo => model !== null);
          return Effect.succeed(models);
        }),
      );

    const setModel = (provider: string, modelId: string) =>
      writeCommand({ type: "set_model", provider, modelId }).pipe(
        Effect.flatMap((response) => {
          const model = parseModelInfo(response.data);
          if (!model) {
            return Effect.fail(
              new PiRpcSessionRuntimeError({
                detail: `Pi RPC set_model returned invalid model for ${provider}/${modelId}`,
              }),
            );
          }
          return Effect.succeed(model);
        }),
      );

    const prompt = (command: {
      readonly message: string;
      readonly images?: ReadonlyArray<PiRpcImageContent>;
      readonly streamingBehavior?: "steer" | "followUp";
    }) =>
      writeCommand({
        type: "prompt",
        message: command.message,
        ...(command.images && command.images.length > 0 ? { images: command.images } : {}),
        ...(command.streamingBehavior ? { streamingBehavior: command.streamingBehavior } : {}),
      }).pipe(Effect.asVoid);

    const steer = (command: {
      readonly message: string;
      readonly images?: ReadonlyArray<PiRpcImageContent>;
    }) =>
      writeCommand({
        type: "steer",
        message: command.message,
        ...(command.images && command.images.length > 0 ? { images: command.images } : {}),
      }).pipe(Effect.asVoid);

    const followUp = (command: {
      readonly message: string;
      readonly images?: ReadonlyArray<PiRpcImageContent>;
    }) =>
      writeCommand({
        type: "follow_up",
        message: command.message,
        ...(command.images && command.images.length > 0 ? { images: command.images } : {}),
      }).pipe(Effect.asVoid);

    const newSession = (command?: { readonly parentSession?: string }) =>
      writeCommand({
        type: "new_session",
        ...(command?.parentSession ? { parentSession: command.parentSession } : {}),
      }).pipe(
        Effect.flatMap((response) => {
          const cancelled = isRecord(response.data) && response.data.cancelled === true;
          return Effect.succeed({ cancelled });
        }),
      );

    const getMessages = () =>
      writeCommand({ type: "get_messages" }).pipe(
        Effect.flatMap((response) => {
          if (!isRecord(response.data) || !Array.isArray(response.data.messages)) {
            return Effect.succeed([] as ReadonlyArray<unknown>);
          }
          return Effect.succeed(response.data.messages as ReadonlyArray<unknown>);
        }),
      );

    const cycleModel = () =>
      writeCommand({ type: "cycle_model" }).pipe(
        Effect.flatMap((response) => {
          const data = isRecord(response.data) ? response.data : undefined;
          return Effect.succeed({
            model: data ? parseModelInfo(data.model) : null,
            thinkingLevel:
              data && typeof data.thinkingLevel === "string" ? data.thinkingLevel : "medium",
          });
        }),
      );

    const setThinkingLevel = (level: string) =>
      writeCommand({ type: "set_thinking_level", level }).pipe(Effect.asVoid);

    const cycleThinkingLevel = () =>
      writeCommand({ type: "cycle_thinking_level" }).pipe(
        Effect.flatMap((response) => {
          const level =
            isRecord(response.data) && typeof response.data.level === "string"
              ? response.data.level
              : null;
          return Effect.succeed(level);
        }),
      );

    const setSteeringMode = (mode: string) =>
      writeCommand({ type: "set_steering_mode", mode }).pipe(Effect.asVoid);

    const setFollowUpMode = (mode: string) =>
      writeCommand({ type: "set_follow_up_mode", mode }).pipe(Effect.asVoid);

    const compact = (command?: { readonly customInstructions?: string }) =>
      writeCommand({
        type: "compact",
        ...(command?.customInstructions ? { customInstructions: command.customInstructions } : {}),
      }).pipe(
        Effect.flatMap((response) =>
          Effect.succeed(isRecord(response.data) ? response.data : null),
        ),
      );

    const setAutoCompaction = (enabled: boolean) =>
      writeCommand({ type: "set_auto_compaction", enabled }).pipe(Effect.asVoid);

    const setAutoRetry = (enabled: boolean) =>
      writeCommand({ type: "set_auto_retry", enabled }).pipe(Effect.asVoid);

    const abortRetry = () => writeCommand({ type: "abort_retry" }).pipe(Effect.asVoid);

    const bash = (command: string) =>
      writeCommand({ type: "bash", command }).pipe(
        Effect.flatMap((response) => {
          if (!isRecord(response.data)) {
            return Effect.fail(
              new PiRpcSessionRuntimeError({ detail: "Pi RPC bash returned invalid data" }),
            );
          }
          return Effect.succeed(response.data);
        }),
      );

    const abortBash = () => writeCommand({ type: "abort_bash" }).pipe(Effect.asVoid);

    const parseSessionStats = (data: unknown): PiRpcSessionStats | null => {
      if (!isRecord(data)) return null;
      const tokensRaw = isRecord(data.tokens) ? data.tokens : {};
      return {
        ...(typeof data.sessionFile === "string" ? { sessionFile: data.sessionFile } : {}),
        ...(typeof data.sessionId === "string" ? { sessionId: data.sessionId } : {}),
        userMessages: typeof data.userMessages === "number" ? data.userMessages : 0,
        assistantMessages: typeof data.assistantMessages === "number" ? data.assistantMessages : 0,
        toolCalls: typeof data.toolCalls === "number" ? data.toolCalls : 0,
        toolResults: typeof data.toolResults === "number" ? data.toolResults : 0,
        totalMessages: typeof data.totalMessages === "number" ? data.totalMessages : 0,
        tokens: {
          input: typeof tokensRaw.input === "number" ? tokensRaw.input : 0,
          output: typeof tokensRaw.output === "number" ? tokensRaw.output : 0,
          cacheRead: typeof tokensRaw.cacheRead === "number" ? tokensRaw.cacheRead : 0,
          cacheWrite: typeof tokensRaw.cacheWrite === "number" ? tokensRaw.cacheWrite : 0,
          total: typeof tokensRaw.total === "number" ? tokensRaw.total : 0,
        },
        cost: typeof data.cost === "number" ? data.cost : 0,
        ...(isRecord(data.contextUsage)
          ? {
              contextUsage: {
                tokens:
                  typeof data.contextUsage.tokens === "number" ? data.contextUsage.tokens : null,
                contextWindow:
                  typeof data.contextUsage.contextWindow === "number"
                    ? data.contextUsage.contextWindow
                    : 0,
                percent:
                  typeof data.contextUsage.percent === "number" ? data.contextUsage.percent : null,
              },
            }
          : {}),
      };
    };

    const getSessionStats = () =>
      writeCommand({ type: "get_session_stats" }).pipe(
        Effect.flatMap((response) => Effect.succeed(parseSessionStats(response.data))),
      );

    const exportHtml = (outputPath?: string) =>
      writeCommand({
        type: "export_html",
        ...(outputPath ? { outputPath } : {}),
      }).pipe(
        Effect.flatMap((response) => {
          if (!isRecord(response.data) || typeof response.data.path !== "string") {
            return Effect.succeed(null);
          }
          return Effect.succeed(response.data.path);
        }),
      );

    const fork = (entryId: string) =>
      writeCommand({ type: "fork", entryId }).pipe(
        Effect.flatMap((response) => {
          const data = isRecord(response.data) ? response.data : {};
          return Effect.succeed({
            text: typeof data.text === "string" ? data.text : "",
            cancelled: data.cancelled === true,
          });
        }),
      );

    const clone = () =>
      writeCommand({ type: "clone" }).pipe(
        Effect.flatMap((response) => {
          const cancelled = isRecord(response.data) && response.data.cancelled === true;
          return Effect.succeed({ cancelled });
        }),
      );

    const getForkMessages = () =>
      writeCommand({ type: "get_fork_messages" }).pipe(
        Effect.flatMap((response) => {
          if (!isRecord(response.data) || !Array.isArray(response.data.messages)) {
            return Effect.succeed([] as ReadonlyArray<PiRpcForkMessage>);
          }
          const messages = (response.data.messages as ReadonlyArray<unknown>)
            .map((entry) => {
              if (!isRecord(entry)) return null;
              if (typeof entry.entryId !== "string" || typeof entry.text !== "string") {
                return null;
              }
              return { entryId: entry.entryId, text: entry.text };
            })
            .filter((entry): entry is PiRpcForkMessage => entry !== null);
          return Effect.succeed(messages);
        }),
      );

    const getLastAssistantText = () =>
      writeCommand({ type: "get_last_assistant_text" }).pipe(
        Effect.flatMap((response) => {
          if (!isRecord(response.data)) {
            return Effect.succeed(null);
          }
          return Effect.succeed(typeof response.data.text === "string" ? response.data.text : null);
        }),
      );

    const setSessionName = (name: string) =>
      writeCommand({ type: "set_session_name", name }).pipe(Effect.asVoid);

    const getCommands = () =>
      writeCommand({ type: "get_commands" }).pipe(
        Effect.flatMap((response) => {
          if (!isRecord(response.data) || !Array.isArray(response.data.commands)) {
            return Effect.succeed([] as ReadonlyArray<PiRpcCommandInfo>);
          }
          const commands = (response.data.commands as ReadonlyArray<unknown>)
            .map((entry) => {
              if (!isRecord(entry) || typeof entry.name !== "string") return null;
              return {
                name: entry.name,
                ...(typeof entry.description === "string"
                  ? { description: entry.description }
                  : {}),
                source: typeof entry.source === "string" ? entry.source : "unknown",
                ...(typeof entry.location === "string" ? { location: entry.location } : {}),
                ...(typeof entry.path === "string" ? { path: entry.path } : {}),
              } satisfies PiRpcCommandInfo;
            })
            .filter((entry): entry is PiRpcCommandInfo => entry !== null);
          return Effect.succeed(commands);
        }),
      );

    const abort = () => writeCommand({ type: "abort" }).pipe(Effect.asVoid);

    const switchSession = (sessionPath: string) =>
      writeCommand({ type: "switch_session", sessionPath }).pipe(
        Effect.flatMap((response) => {
          const cancelled = isRecord(response.data) && response.data.cancelled === true;
          return Effect.succeed({ cancelled });
        }),
      );

    const waitForAgentEnd = (
      timeoutMs = 3_600_000,
    ): Effect.Effect<PiRpcAgentEvent | undefined, PiRpcSessionRuntimeError> =>
      getEvents().pipe(
        Stream.filter((event) => event.type === "agent_end"),
        Stream.runHead,
        Effect.map(Option.getOrUndefined),
        Effect.timeoutOption(timeoutMs),
        Effect.map((timedOut) => (Option.isSome(timedOut) ? timedOut.value : undefined)),
      );

    const sendExtensionUiResponse = (response: {
      readonly id: string;
      readonly value?: string;
      readonly confirmed?: boolean;
      readonly cancelled?: boolean;
    }): Effect.Effect<void, PiRpcSessionRuntimeError> =>
      writeStdinLine(serializePiRpcLine({ type: "extension_ui_response", ...response }));

    return {
      start,
      stop,
      getEvents,
      getState,
      getAvailableModels,
      setModel,
      cycleModel,
      prompt,
      steer,
      followUp,
      abort,
      newSession,
      getMessages,
      setThinkingLevel,
      cycleThinkingLevel,
      setSteeringMode,
      setFollowUpMode,
      compact,
      setAutoCompaction,
      setAutoRetry,
      abortRetry,
      bash,
      abortBash,
      getSessionStats,
      exportHtml,
      fork,
      clone,
      getForkMessages,
      getLastAssistantText,
      setSessionName,
      getCommands,
      switchSession,
      waitForAgentEnd,
      sendExtensionUiResponse,
    } satisfies PiRpcSessionRuntimeShape;
  });
