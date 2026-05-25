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

export interface PiRpcSessionState {
  readonly model: PiRpcModelInfo | null;
  readonly thinkingLevel: string;
  readonly isStreaming: boolean;
  readonly sessionFile?: string;
  readonly sessionId?: string;
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
  readonly prompt: (message: string) => Effect.Effect<void, PiRpcSessionRuntimeError>;
  readonly steer: (message: string) => Effect.Effect<void, PiRpcSessionRuntimeError>;
  readonly abort: () => Effect.Effect<void, PiRpcSessionRuntimeError>;
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
        yield* writeStdinLine(serializePiRpcLine(payload));
        const response = yield* Effect.race(
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
        if (!response.success) {
          return yield* Effect.fail(
            new PiRpcSessionRuntimeError({
              detail: response.error ?? `Pi RPC command ${command.type} failed`,
            }),
          );
        }
        return response;
      });

    const start: PiRpcSessionRuntimeShape["start"] = () =>
      Effect.gen(function* () {
        const args = ["--mode", "rpc", ...(input.extraArgs ?? [])];
        const command = ChildProcess.make(input.spawn.command, args, {
          cwd: input.spawn.cwd,
          env: input.spawn.env ?? process.env,
        });
        const child = yield* input.childProcessSpawner.spawn(command).pipe(
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
            ...(typeof data.sessionFile === "string" ? { sessionFile: data.sessionFile } : {}),
            ...(typeof data.sessionId === "string" ? { sessionId: data.sessionId } : {}),
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

    const prompt = (message: string) =>
      writeCommand({ type: "prompt", message }).pipe(Effect.asVoid);

    const steer = (message: string) => writeCommand({ type: "steer", message }).pipe(Effect.asVoid);

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
      prompt,
      steer,
      abort,
      switchSession,
      waitForAgentEnd,
      sendExtensionUiResponse,
    } satisfies PiRpcSessionRuntimeShape;
  });
