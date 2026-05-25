/**
 * PiAgentAdapter — Pi coding agent via `pi --mode rpc` JSONL protocol.
 *
 * @see https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/rpc.md
 */
import {
  EventId,
  ProviderDriverKind,
  type PiAgentSettings,
  type ProviderApprovalDecision,
  type ProviderRuntimeEvent,
  type ProviderSession,
  type ProviderUserInputAnswers,
  ApprovalRequestId,
  RuntimeRequestId,
  type ThreadId,
  TurnId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Random from "effect/Random";
import * as Ref from "effect/Ref";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import { ChildProcessSpawner } from "effect/unstable/process";

import {
  ProviderAdapterProcessError,
  ProviderAdapterRequestError,
  ProviderAdapterSessionNotFoundError,
  ProviderAdapterValidationError,
} from "../Errors.ts";
import {
  makePiAssistantItemEvent,
  makePiContentDeltaEvent,
  makePiExtensionUiRequestEvent,
  makePiToolCallEvent,
} from "../pi/PiCoreRuntimeEvents.ts";
import {
  makePiRpcSessionRuntime,
  PiRpcSessionRuntimeError,
  type PiRpcAgentEvent,
  type PiRpcSessionRuntimeShape,
} from "../pi/PiRpcSessionRuntime.ts";
import { parsePiModelSlug } from "./PiAgentProvider.ts";
import { type PiAgentAdapterShape } from "../Services/PiAgentAdapter.ts";
import type { EventNdjsonLogger } from "./EventNdjsonLogger.ts";

const PROVIDER = ProviderDriverKind.make("piAgent");
const PI_RESUME_VERSION = 1 as const;

export interface PiAgentAdapterLiveOptions {
  readonly environment?: NodeJS.ProcessEnv;
  readonly nativeEventLogPath?: string;
  readonly nativeEventLogger?: EventNdjsonLogger;
}

interface PendingExtensionUi {
  readonly decision: Deferred.Deferred<ProviderApprovalDecision | ProviderUserInputAnswers>;
  readonly kind: "confirm" | "select" | "input" | "editor";
}

interface PiSessionContext {
  readonly threadId: ThreadId;
  session: ProviderSession;
  readonly scope: Scope.Closeable;
  readonly runtime: PiRpcSessionRuntimeShape;
  eventFiber?: Fiber.Fiber<void, never>;
  readonly pendingExtensionUi: Map<ApprovalRequestId, PendingExtensionUi>;
  readonly assistantItemIdByMessageKey: Map<string, string>;
  activeTurnId?: TurnId;
  agentEndSignal?: Deferred.Deferred<void, never>;
  stopped: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parsePiResume(raw: unknown): { readonly sessionFile: string } | undefined {
  if (!isRecord(raw)) return undefined;
  if (raw.schemaVersion !== PI_RESUME_VERSION) return undefined;
  if (typeof raw.sessionFile !== "string" || !raw.sessionFile.trim()) return undefined;
  return { sessionFile: raw.sessionFile.trim() };
}

function mapPiError(
  threadId: ThreadId,
  method: string,
  cause: unknown,
): ProviderAdapterRequestError {
  const detail = PiRpcSessionRuntimeError.is(cause)
    ? cause.detail
    : cause instanceof Error
      ? cause.message
      : String(cause);
  return new ProviderAdapterRequestError({
    provider: PROVIDER,
    method,
    detail,
    cause,
  });
}

function withPiOpenCodeAuthEnv(baseEnv: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const apiKey = baseEnv.OPENCODE_API_KEY?.trim() || baseEnv.OPENCODE_GO_API_KEY?.trim();
  return apiKey ? { ...baseEnv, OPENCODE_API_KEY: apiKey } : baseEnv;
}

export const makePiAgentAdapter = (
  piAgentSettings: PiAgentSettings,
  options: PiAgentAdapterLiveOptions = {},
): Effect.Effect<PiAgentAdapterShape, never, ChildProcessSpawner.ChildProcessSpawner> =>
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const binaryPath = piAgentSettings.binaryPath?.trim() || "pi";
    const processEnv = withPiOpenCodeAuthEnv(options.environment ?? process.env);
    const runtimeEvents = yield* PubSub.unbounded<ProviderRuntimeEvent>();
    const sessions = yield* Ref.make(new Map<ThreadId, PiSessionContext>());

    const nowIso = Effect.map(DateTime.now, DateTime.formatIso);
    const makeEventStamp = () =>
      Effect.gen(function* () {
        const uuid = yield* Random.nextUUIDv4;
        const createdAt = yield* nowIso;
        return { eventId: EventId.make(uuid), createdAt };
      });

    const offerRuntimeEvent = (event: ProviderRuntimeEvent) => PubSub.publish(runtimeEvents, event);

    const requireSession = (threadId: ThreadId) =>
      Effect.gen(function* () {
        const ctx = (yield* Ref.get(sessions)).get(threadId);
        if (!ctx || ctx.stopped) {
          return yield* new ProviderAdapterSessionNotFoundError({
            provider: PROVIDER,
            threadId,
          });
        }
        return ctx;
      });

    const handlePiEvent = (ctx: PiSessionContext, event: PiRpcAgentEvent) =>
      Effect.gen(function* () {
        switch (event.type) {
          case "extension_ui_request": {
            if (typeof event.id !== "string") return;
            const method = typeof event.method === "string" ? event.method : "unknown";
            if (method === "notify" || method === "setStatus" || method === "setWidget") {
              return;
            }
            const requestId = ApprovalRequestId.make(event.id);
            const title = typeof event.title === "string" ? event.title : "Pi extension request";
            const detail =
              typeof event.message === "string"
                ? event.message
                : typeof event.placeholder === "string"
                  ? event.placeholder
                  : undefined;
            const decision = yield* Deferred.make<
              ProviderApprovalDecision | ProviderUserInputAnswers
            >();
            ctx.pendingExtensionUi.set(requestId, {
              decision,
              kind:
                method === "confirm"
                  ? "confirm"
                  : method === "select"
                    ? "select"
                    : method === "input" || method === "editor"
                      ? "input"
                      : "select",
            });
            yield* offerRuntimeEvent(
              makePiExtensionUiRequestEvent({
                stamp: yield* makeEventStamp(),
                provider: PROVIDER,
                threadId: ctx.threadId,
                turnId: ctx.activeTurnId,
                requestId: RuntimeRequestId.make(requestId),
                title,
                ...(detail ? { detail } : {}),
                rawPayload: event,
              }),
            );
            return;
          }
          case "message_start": {
            const message = isRecord(event.message) ? event.message : undefined;
            const role = message && typeof message.role === "string" ? message.role : undefined;
            if (role !== "assistant") return;
            const messageKey =
              message && typeof message.id === "string"
                ? message.id
                : `${ctx.threadId}:${String(event.type)}:${ctx.activeTurnId ?? "none"}`;
            const itemId = crypto.randomUUID();
            ctx.assistantItemIdByMessageKey.set(messageKey, itemId);
            yield* offerRuntimeEvent(
              makePiAssistantItemEvent({
                stamp: yield* makeEventStamp(),
                provider: PROVIDER,
                threadId: ctx.threadId,
                turnId: ctx.activeTurnId,
                itemId,
                lifecycle: "item.started",
              }),
            );
            return;
          }
          case "message_update": {
            const assistantEvent = isRecord(event.assistantMessageEvent)
              ? event.assistantMessageEvent
              : undefined;
            if (!assistantEvent) return;
            const delta = typeof assistantEvent.delta === "string" ? assistantEvent.delta : "";
            if (!delta) return;
            const streamKind =
              assistantEvent.type === "thinking_delta" ? "reasoning_text" : "assistant_text";
            const message = isRecord(event.message) ? event.message : undefined;
            const messageKey =
              message && typeof message.id === "string"
                ? message.id
                : message
                  ? `${ctx.threadId}:message_update:${ctx.activeTurnId ?? "none"}`
                  : undefined;
            const itemId = messageKey ? ctx.assistantItemIdByMessageKey.get(messageKey) : undefined;
            yield* offerRuntimeEvent(
              makePiContentDeltaEvent({
                stamp: yield* makeEventStamp(),
                provider: PROVIDER,
                threadId: ctx.threadId,
                turnId: ctx.activeTurnId,
                ...(itemId ? { itemId } : {}),
                delta,
                streamKind,
                rawPayload: event,
              }),
            );
            return;
          }
          case "message_end": {
            const message = isRecord(event.message) ? event.message : undefined;
            const role = message && typeof message.role === "string" ? message.role : undefined;
            if (role !== "assistant") return;
            const messageKey = message && typeof message.id === "string" ? message.id : undefined;
            const itemId = messageKey ? ctx.assistantItemIdByMessageKey.get(messageKey) : undefined;
            if (!itemId) return;
            yield* offerRuntimeEvent(
              makePiAssistantItemEvent({
                stamp: yield* makeEventStamp(),
                provider: PROVIDER,
                threadId: ctx.threadId,
                turnId: ctx.activeTurnId,
                itemId,
                lifecycle: "item.completed",
              }),
            );
            return;
          }
          case "tool_execution_start": {
            const toolCallId =
              typeof event.toolCallId === "string" ? event.toolCallId : crypto.randomUUID();
            const toolName = typeof event.toolName === "string" ? event.toolName : "tool";
            yield* offerRuntimeEvent(
              makePiToolCallEvent({
                stamp: yield* makeEventStamp(),
                provider: PROVIDER,
                threadId: ctx.threadId,
                turnId: ctx.activeTurnId,
                toolCallId,
                toolName,
                lifecycle: "item.updated",
                rawPayload: event,
              }),
            );
            return;
          }
          case "tool_execution_end": {
            const toolCallId =
              typeof event.toolCallId === "string" ? event.toolCallId : crypto.randomUUID();
            const toolName = typeof event.toolName === "string" ? event.toolName : "tool";
            yield* offerRuntimeEvent(
              makePiToolCallEvent({
                stamp: yield* makeEventStamp(),
                provider: PROVIDER,
                threadId: ctx.threadId,
                turnId: ctx.activeTurnId,
                toolCallId,
                toolName,
                lifecycle: "item.completed",
                isError: event.isError === true,
                rawPayload: event,
              }),
            );
            return;
          }
          case "agent_end": {
            const signal = ctx.agentEndSignal;
            if (signal) {
              delete ctx.agentEndSignal;
              yield* Deferred.succeed(signal, undefined);
            }
            return;
          }
          default:
            return;
        }
      });

    const startSession: PiAgentAdapterShape["startSession"] = (input) =>
      Effect.scoped(
        Effect.gen(function* () {
          const sessionScope = yield* Scope.make("sequential");
          let sessionScopeTransferred = false;
          yield* Effect.addFinalizer(() =>
            sessionScopeTransferred ? Effect.void : Scope.close(sessionScope, Exit.void),
          );

          const initialModel = input.modelSelection?.model
            ? parsePiModelSlug(input.modelSelection.model)
            : undefined;
          const runtime = yield* makePiRpcSessionRuntime({
            spawn: {
              command: binaryPath,
              args: [],
              cwd: input.cwd?.trim() || process.cwd(),
              env: processEnv,
            },
            childProcessSpawner: spawner,
            extraArgs: [
              "--no-session",
              "--no-tools",
              ...(initialModel
                ? ["--provider", initialModel.provider, "--model", initialModel.modelId]
                : []),
            ],
          }).pipe(Effect.provideService(Scope.Scope, sessionScope));
          yield* runtime.start().pipe(
            Effect.mapError(
              (cause) =>
                new ProviderAdapterProcessError({
                  provider: PROVIDER,
                  threadId: input.threadId,
                  detail: PiRpcSessionRuntimeError.is(cause) ? cause.detail : String(cause),
                  cause,
                }),
            ),
            Effect.onError(() =>
              runtime
                .stop()
                .pipe(
                  Effect.andThen(Effect.ignore(Scope.close(sessionScope, Exit.void))),
                  Effect.ignore,
                ),
            ),
          );

          const resume = parsePiResume(input.resumeCursor);
          if (resume) {
            yield* runtime
              .switchSession(resume.sessionFile)
              .pipe(
                Effect.mapError((cause) => mapPiError(input.threadId, "switch_session", cause)),
              );
          }

          const state = yield* runtime
            .getState()
            .pipe(Effect.mapError((cause) => mapPiError(input.threadId, "get_state", cause)));

          const session: ProviderSession = {
            threadId: input.threadId,
            provider: PROVIDER,
            providerInstanceId: input.providerInstanceId,
            status: "ready",
            ...(input.cwd ? { cwd: input.cwd } : {}),
            model:
              input.modelSelection?.model ??
              `${state.model?.provider ?? "anthropic"}/${state.model?.id ?? "claude-sonnet-4-6"}`,
            runtimeMode: input.runtimeMode,
            createdAt: yield* nowIso,
            updatedAt: yield* nowIso,
            resumeCursor: resume
              ? {
                  schemaVersion: PI_RESUME_VERSION,
                  sessionFile: resume.sessionFile,
                  ...(state.sessionId ? { sessionId: state.sessionId } : {}),
                }
              : state.sessionFile
                ? {
                    schemaVersion: PI_RESUME_VERSION,
                    sessionFile: state.sessionFile,
                    ...(state.sessionId ? { sessionId: state.sessionId } : {}),
                  }
                : undefined,
          };

          const ctx: PiSessionContext = {
            threadId: input.threadId,
            session,
            scope: sessionScope,
            runtime,
            pendingExtensionUi: new Map(),
            assistantItemIdByMessageKey: new Map(),
            stopped: false,
          };

          ctx.eventFiber = yield* runtime.getEvents().pipe(
            Stream.runForEach((event) => handlePiEvent(ctx, event)),
            Effect.catchCause(() => Effect.void),
            Effect.forkIn(sessionScope),
          );
          yield* Ref.update(sessions, (map) => {
            const next = new Map(map);
            next.set(input.threadId, ctx);
            return next;
          });

          sessionScopeTransferred = true;

          yield* offerRuntimeEvent({
            type: "session.started",
            ...(yield* makeEventStamp()),
            provider: PROVIDER,
            threadId: input.threadId,
            payload: {
              resume: {
                sessionId: state.sessionId ?? null,
                sessionFile: state.sessionFile ?? null,
              },
            },
          });
          yield* offerRuntimeEvent({
            type: "session.state.changed",
            ...(yield* makeEventStamp()),
            provider: PROVIDER,
            threadId: input.threadId,
            payload: { state: "ready", reason: "Pi RPC session ready" },
          });
          yield* offerRuntimeEvent({
            type: "thread.started",
            ...(yield* makeEventStamp()),
            provider: PROVIDER,
            threadId: input.threadId,
            payload: { providerThreadId: state.sessionId ?? state.sessionFile ?? input.threadId },
          });

          return session;
        }).pipe(Effect.mapError((cause) => mapPiError(input.threadId, "startSession", cause))),
      );

    const sendTurn: PiAgentAdapterShape["sendTurn"] = (input) =>
      Effect.gen(function* () {
        const ctx = yield* requireSession(input.threadId);
        const turnId = TurnId.make(crypto.randomUUID());
        const modelSlug = input.modelSelection?.model ?? ctx.session.model;
        const parsedModel = modelSlug ? parsePiModelSlug(modelSlug) : undefined;
        const activeModel = ctx.session.model ? parsePiModelSlug(ctx.session.model) : undefined;
        if (
          parsedModel &&
          (activeModel?.provider !== parsedModel.provider ||
            activeModel.modelId !== parsedModel.modelId)
        ) {
          yield* ctx.runtime
            .setModel(parsedModel.provider, parsedModel.modelId)
            .pipe(Effect.mapError((cause) => mapPiError(input.threadId, "set_model", cause)));
        }

        const promptText = input.input?.trim() ?? "";
        if (!promptText) {
          return yield* new ProviderAdapterValidationError({
            provider: PROVIDER,
            operation: "sendTurn",
            issue: "Turn requires non-empty text.",
          });
        }

        ctx.activeTurnId = turnId;
        ctx.session = {
          ...ctx.session,
          activeTurnId: turnId,
          updatedAt: yield* nowIso,
          model: modelSlug,
        };

        yield* offerRuntimeEvent({
          type: "turn.started",
          ...(yield* makeEventStamp()),
          provider: PROVIDER,
          threadId: input.threadId,
          turnId,
          payload: { model: modelSlug },
        });

        const agentEndSignal = yield* Deferred.make<void, never>();
        ctx.agentEndSignal = agentEndSignal;

        yield* ctx.runtime
          .prompt(promptText)
          .pipe(Effect.mapError((cause) => mapPiError(input.threadId, "prompt", cause)));
        yield* Deferred.await(agentEndSignal).pipe(
          Effect.timeoutOption("5 minutes"),
          Effect.flatMap(
            Option.match({
              onNone: () =>
                Effect.fail(
                  mapPiError(
                    input.threadId,
                    "agent_end",
                    new Error("Timed out waiting for Pi agent_end"),
                  ),
                ),
              onSome: () => Effect.void,
            }),
          ),
        );

        const state = yield* ctx.runtime
          .getState()
          .pipe(Effect.mapError((cause) => mapPiError(input.threadId, "get_state", cause)));
        const resumeCursor = state.sessionFile
          ? {
              schemaVersion: PI_RESUME_VERSION,
              sessionFile: state.sessionFile,
              ...(state.sessionId ? { sessionId: state.sessionId } : {}),
            }
          : ctx.session.resumeCursor;

        ctx.session = {
          ...ctx.session,
          updatedAt: yield* nowIso,
          resumeCursor,
        };

        yield* offerRuntimeEvent({
          type: "turn.completed",
          ...(yield* makeEventStamp()),
          provider: PROVIDER,
          threadId: input.threadId,
          turnId,
          payload: { state: "completed", stopReason: null },
        });

        return {
          threadId: input.threadId,
          turnId,
          resumeCursor,
        };
      });

    const interruptTurn: PiAgentAdapterShape["interruptTurn"] = (threadId) =>
      Effect.gen(function* () {
        const ctx = yield* requireSession(threadId);
        yield* ctx.runtime
          .abort()
          .pipe(Effect.mapError((cause) => mapPiError(threadId, "abort", cause)));
      });

    const respondToRequest: PiAgentAdapterShape["respondToRequest"] = (
      threadId,
      requestId,
      decision,
    ) =>
      Effect.gen(function* () {
        const ctx = yield* requireSession(threadId);
        const pending = ctx.pendingExtensionUi.get(requestId);
        if (!pending) {
          return yield* new ProviderAdapterRequestError({
            provider: PROVIDER,
            method: "extension_ui_response",
            detail: `Unknown pending Pi extension request: ${requestId}`,
          });
        }
        const accepted = decision === "accept" || decision === "acceptForSession";
        if (pending.kind === "confirm") {
          yield* ctx.runtime
            .sendExtensionUiResponse({
              id: requestId,
              confirmed: accepted,
            })
            .pipe(Effect.mapError((cause) => mapPiError(threadId, "extension_ui_response", cause)));
          yield* Deferred.succeed(pending.decision, decision);
          ctx.pendingExtensionUi.delete(requestId);
          return;
        }
        yield* Deferred.succeed(pending.decision, accepted ? { selected: "Allow" } : {});
        yield* ctx.runtime
          .sendExtensionUiResponse({
            id: requestId,
            value: accepted ? "Allow" : "Block",
          })
          .pipe(Effect.mapError((cause) => mapPiError(threadId, "extension_ui_response", cause)));
        ctx.pendingExtensionUi.delete(requestId);
      });

    const respondToUserInput: PiAgentAdapterShape["respondToUserInput"] = (
      threadId,
      requestId,
      answers,
    ) =>
      Effect.gen(function* () {
        const ctx = yield* requireSession(threadId);
        const pending = ctx.pendingExtensionUi.get(requestId);
        if (!pending) {
          return yield* new ProviderAdapterRequestError({
            provider: PROVIDER,
            method: "extension_ui_response",
            detail: `Unknown pending Pi extension request: ${requestId}`,
          });
        }
        const firstAnswer = Object.values(answers)[0];
        yield* ctx.runtime
          .sendExtensionUiResponse({
            id: requestId,
            ...(typeof firstAnswer === "string" ? { value: firstAnswer } : { cancelled: true }),
          })
          .pipe(Effect.mapError((cause) => mapPiError(threadId, "extension_ui_response", cause)));
        yield* Deferred.succeed(pending.decision, answers);
        ctx.pendingExtensionUi.delete(requestId);
      });

    const stopSession: PiAgentAdapterShape["stopSession"] = (threadId) =>
      Effect.gen(function* () {
        const ctx = yield* requireSession(threadId);
        if (ctx.stopped) {
          return;
        }
        ctx.stopped = true;
        if (ctx.eventFiber) {
          yield* Fiber.interrupt(ctx.eventFiber).pipe(Effect.ignore);
        }
        yield* ctx.runtime.stop().pipe(Effect.ignore);
        yield* Ref.update(sessions, (map) => {
          const next = new Map(map);
          next.delete(threadId);
          return next;
        });
        yield* Scope.close(ctx.scope, Exit.void).pipe(Effect.orDie);
      });

    const listSessions: PiAgentAdapterShape["listSessions"] = () =>
      Ref.get(sessions).pipe(
        Effect.map((map) => Array.from(map.values()).map((ctx) => ctx.session)),
      );

    const hasSession: PiAgentAdapterShape["hasSession"] = (threadId) =>
      Ref.get(sessions).pipe(Effect.map((map) => map.has(threadId) && !map.get(threadId)?.stopped));

    const readThread: PiAgentAdapterShape["readThread"] = (threadId) =>
      Effect.gen(function* () {
        yield* requireSession(threadId);
        return {
          threadId,
          turns: [],
        };
      });

    const rollbackThread: PiAgentAdapterShape["rollbackThread"] = (threadId) =>
      Effect.gen(function* () {
        yield* requireSession(threadId);
        return {
          threadId,
          turns: [],
        };
      });

    const stopAll: PiAgentAdapterShape["stopAll"] = () =>
      Effect.gen(function* () {
        const active = Array.from((yield* Ref.get(sessions)).values());
        yield* Effect.forEach(active, (ctx) => stopSession(ctx.threadId), { discard: true });
      });

    const streamEvents: PiAgentAdapterShape["streamEvents"] = Stream.fromPubSub(runtimeEvents);

    return {
      provider: PROVIDER,
      capabilities: { sessionModelSwitch: "in-session" },
      startSession,
      sendTurn,
      interruptTurn,
      respondToRequest,
      respondToUserInput,
      stopSession,
      listSessions,
      hasSession,
      readThread,
      rollbackThread,
      stopAll,
      streamEvents,
    } satisfies PiAgentAdapterShape;
  });
