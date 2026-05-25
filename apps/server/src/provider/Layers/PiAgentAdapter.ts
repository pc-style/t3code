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
  type ProviderSendTurnInput,
  type ProviderSession,
  type ProviderUserInputAnswers,
  ApprovalRequestId,
  type ThreadId,
  TurnId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Random from "effect/Random";
import * as Ref from "effect/Ref";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import { ChildProcessSpawner } from "effect/unstable/process";

import { resolveAttachmentPath } from "../../attachmentStore.ts";

import {
  ProviderAdapterProcessError,
  ProviderAdapterRequestError,
  ProviderAdapterSessionNotFoundError,
  ProviderAdapterValidationError,
} from "../Errors.ts";
import {
  makePiAssistantItemEvent,
  makePiContentDeltaEvent,
  makePiRuntimeErrorEvent,
  makePiRuntimeWarningEvent,
  makePiTaskProgressEvent,
  makePiTokenUsageEvent,
  makePiToolCallEvent,
  makePiToolProgressEvent,
} from "../pi/PiCoreRuntimeEvents.ts";
import {
  extractPiToolProgressSummary,
  isPiExtensionUiDialogMethod,
  mapPiExtensionUiRequestToRuntimeEvents,
  parsePiExtensionUiMethod,
  resolvePiExtensionUiResponse,
} from "../pi/PiExtensionUi.ts";
import {
  makePiRpcSessionRuntime,
  PiRpcSessionRuntimeError,
  type PiRpcAgentEvent,
  type PiRpcImageContent,
  type PiRpcSessionRuntimeShape,
} from "../pi/PiRpcSessionRuntime.ts";
import { parsePiModelSlug } from "./PiAgentProvider.ts";
import { type PiAgentAdapterShape } from "../Services/PiAgentAdapter.ts";
import type { EventNdjsonLogger } from "./EventNdjsonLogger.ts";

const PROVIDER = ProviderDriverKind.make("piAgent");
const PI_RESUME_VERSION = 1 as const;

export interface PiAgentAdapterLiveOptions {
  readonly environment?: NodeJS.ProcessEnv;
  readonly attachmentsDir?: string;
  readonly nativeEventLogPath?: string;
  readonly nativeEventLogger?: EventNdjsonLogger;
}

interface PendingExtensionUi {
  readonly decision: Deferred.Deferred<ProviderApprovalDecision | ProviderUserInputAnswers>;
  readonly kind: "confirm" | "select" | "input" | "editor";
  readonly prefill?: string;
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
): Effect.Effect<
  PiAgentAdapterShape,
  never,
  ChildProcessSpawner.ChildProcessSpawner | FileSystem.FileSystem
> =>
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const fileSystem = yield* FileSystem.FileSystem;
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

    const buildPromptImages = (input: {
      readonly threadId: ThreadId;
      readonly attachments: ProviderSendTurnInput["attachments"];
    }) =>
      Effect.gen(function* () {
        const attachmentsDir = options.attachmentsDir;
        if (!attachmentsDir || !input.attachments || input.attachments.length === 0) {
          return [] as ReadonlyArray<PiRpcImageContent>;
        }
        const images: Array<PiRpcImageContent> = [];
        for (const attachment of input.attachments) {
          const attachmentPath = resolveAttachmentPath({ attachmentsDir, attachment });
          if (!attachmentPath) {
            return yield* new ProviderAdapterValidationError({
              provider: PROVIDER,
              operation: "sendTurn",
              issue: `Invalid attachment id '${attachment.id}'.`,
            });
          }
          const bytes = yield* fileSystem.readFile(attachmentPath).pipe(
            Effect.mapError(
              (cause) =>
                new ProviderAdapterRequestError({
                  provider: PROVIDER,
                  method: "prompt",
                  detail: cause.message,
                  cause,
                }),
            ),
          );
          images.push({
            type: "image",
            data: Buffer.from(bytes).toString("base64"),
            mimeType: attachment.mimeType,
          });
        }
        return images;
      });

    const emitSessionStats = (ctx: PiSessionContext) =>
      Effect.gen(function* () {
        const stats = yield* ctx.runtime
          .getSessionStats()
          .pipe(Effect.mapError((cause) => mapPiError(ctx.threadId, "get_session_stats", cause)));
        if (!stats) {
          return;
        }
        yield* offerRuntimeEvent(
          makePiTokenUsageEvent({
            stamp: yield* makeEventStamp(),
            provider: PROVIDER,
            threadId: ctx.threadId,
            turnId: ctx.activeTurnId,
            stats: {
              input: stats.tokens.input,
              output: stats.tokens.output,
              cacheRead: stats.tokens.cacheRead,
              total: stats.tokens.total,
              contextTokens: stats.contextUsage?.tokens ?? null,
              contextWindow: stats.contextUsage?.contextWindow ?? null,
              toolCalls: stats.toolCalls,
            },
          }),
        );
      }).pipe(Effect.catchCause(() => Effect.void));

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
            const method = parsePiExtensionUiMethod(event);
            if (!isPiExtensionUiDialogMethod(method)) {
              const mapped = mapPiExtensionUiRequestToRuntimeEvents({
                stamp: yield* makeEventStamp(),
                provider: PROVIDER,
                threadId: ctx.threadId,
                turnId: ctx.activeTurnId,
                event,
              });
              for (const runtimeEvent of mapped) {
                yield* offerRuntimeEvent(runtimeEvent);
              }
              return;
            }
            if (typeof event.id !== "string") return;
            const requestId = ApprovalRequestId.make(event.id);
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
                    : method === "editor"
                      ? "editor"
                      : "input",
              ...(typeof event.prefill === "string" ? { prefill: event.prefill } : {}),
            });
            const mapped = mapPiExtensionUiRequestToRuntimeEvents({
              stamp: yield* makeEventStamp(),
              provider: PROVIDER,
              threadId: ctx.threadId,
              turnId: ctx.activeTurnId,
              event,
            });
            for (const runtimeEvent of mapped) {
              yield* offerRuntimeEvent(runtimeEvent);
            }
            return;
          }
          case "extension_error": {
            yield* offerRuntimeEvent(
              makePiRuntimeErrorEvent({
                stamp: yield* makeEventStamp(),
                provider: PROVIDER,
                threadId: ctx.threadId,
                turnId: ctx.activeTurnId,
                message: typeof event.error === "string" ? event.error : "Pi extension error",
                detail: event,
                rawPayload: event,
              }),
            );
            return;
          }
          case "queue_update": {
            const steering = Array.isArray(event.steering) ? event.steering : [];
            const followUp = Array.isArray(event.followUp) ? event.followUp : [];
            if (steering.length === 0 && followUp.length === 0) {
              return;
            }
            yield* offerRuntimeEvent(
              makePiRuntimeWarningEvent({
                stamp: yield* makeEventStamp(),
                provider: PROVIDER,
                threadId: ctx.threadId,
                turnId: ctx.activeTurnId,
                message: "Pi message queue updated",
                detail: { steering, followUp },
                rawPayload: event,
              }),
            );
            return;
          }
          case "auto_retry_start":
          case "auto_retry_end": {
            yield* offerRuntimeEvent(
              makePiRuntimeWarningEvent({
                stamp: yield* makeEventStamp(),
                provider: PROVIDER,
                threadId: ctx.threadId,
                turnId: ctx.activeTurnId,
                message:
                  event.type === "auto_retry_start"
                    ? "Pi auto-retry started"
                    : event.success === true
                      ? "Pi auto-retry succeeded"
                      : "Pi auto-retry failed",
                detail: event,
                rawPayload: event,
              }),
            );
            return;
          }
          case "compaction_start":
          case "compaction_end": {
            if (
              event.type === "compaction_end" &&
              event.aborted !== true &&
              isRecord(event.result)
            ) {
              yield* offerRuntimeEvent({
                type: "thread.state.changed",
                ...(yield* makeEventStamp()),
                provider: PROVIDER,
                threadId: ctx.threadId,
                turnId: ctx.activeTurnId,
                payload: {
                  state: "compacted",
                  detail: {
                    reason: typeof event.reason === "string" ? event.reason : "compaction",
                    result: event.result,
                  },
                },
              });
              return;
            }
            yield* offerRuntimeEvent(
              makePiRuntimeWarningEvent({
                stamp: yield* makeEventStamp(),
                provider: PROVIDER,
                threadId: ctx.threadId,
                turnId: ctx.activeTurnId,
                message:
                  event.type === "compaction_start"
                    ? "Pi compaction started"
                    : "Pi compaction ended",
                detail: event,
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
            if (assistantEvent.type === "thinking_delta") {
              yield* offerRuntimeEvent(
                makePiTaskProgressEvent({
                  stamp: yield* makeEventStamp(),
                  provider: PROVIDER,
                  threadId: ctx.threadId,
                  turnId: ctx.activeTurnId,
                  taskId: ctx.activeTurnId ?? ctx.threadId,
                  summary: delta,
                  rawPayload: event,
                }),
              );
              return;
            }
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
                streamKind: "assistant_text",
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
            if (messageKey) {
              ctx.assistantItemIdByMessageKey.delete(messageKey);
            }
            return;
          }
          case "tool_execution_update": {
            const toolCallId =
              typeof event.toolCallId === "string" ? event.toolCallId : crypto.randomUUID();
            const summary = extractPiToolProgressSummary(event);
            if (!summary) {
              return;
            }
            yield* offerRuntimeEvent(
              makePiToolProgressEvent({
                stamp: yield* makeEventStamp(),
                provider: PROVIDER,
                threadId: ctx.threadId,
                turnId: ctx.activeTurnId,
                toolCallId,
                summary,
                rawPayload: event,
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
          const spawnExtraArgs = [
            "--no-session",
            ...(input.runtimeMode === "full-access" ? [] : ["--no-tools"]),
            ...(initialModel
              ? ["--provider", initialModel.provider, "--model", initialModel.modelId]
              : []),
          ];
          const runtime = yield* makePiRpcSessionRuntime({
            spawn: {
              command: binaryPath,
              args: [],
              cwd: input.cwd?.trim() || process.cwd(),
              env: processEnv,
            },
            childProcessSpawner: spawner,
            extraArgs: spawnExtraArgs,
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
        const images = yield* buildPromptImages({
          threadId: input.threadId,
          attachments: input.attachments,
        });
        if (!promptText && images.length === 0) {
          return yield* new ProviderAdapterValidationError({
            provider: PROVIDER,
            operation: "sendTurn",
            issue: "Turn requires non-empty text or attachments.",
          });
        }

        const streamingState = yield* ctx.runtime
          .getState()
          .pipe(Effect.mapError((cause) => mapPiError(input.threadId, "get_state", cause)));

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
          .prompt({
            message: promptText || "See attached image(s).",
            ...(images.length > 0 ? { images } : {}),
            ...(streamingState.isStreaming ? { streamingBehavior: "steer" as const } : {}),
          })
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

        yield* emitSessionStats(ctx);

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
      }).pipe(Effect.mapError((cause) => mapPiError(input.threadId, "sendTurn", cause)));

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
        const responseBody = resolvePiExtensionUiResponse({
          pendingKind: pending.kind,
          decision,
          ...(pending.prefill !== undefined ? { prefill: pending.prefill } : {}),
        });
        if ("cancelled" in responseBody && responseBody.cancelled) {
          yield* ctx.runtime
            .sendExtensionUiResponse({ id: requestId, cancelled: true })
            .pipe(Effect.mapError((cause) => mapPiError(threadId, "extension_ui_response", cause)));
        } else {
          yield* ctx.runtime
            .sendExtensionUiResponse({
              id: requestId,
              ...(responseBody.confirmed !== undefined
                ? { confirmed: responseBody.confirmed }
                : {}),
              ...(responseBody.value !== undefined ? { value: responseBody.value } : {}),
            })
            .pipe(Effect.mapError((cause) => mapPiError(threadId, "extension_ui_response", cause)));
        }
        yield* Deferred.succeed(pending.decision, decision);
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
        const responseBody = resolvePiExtensionUiResponse({
          pendingKind: pending.kind,
          answers,
          ...(pending.prefill !== undefined ? { prefill: pending.prefill } : {}),
        });
        if ("cancelled" in responseBody && responseBody.cancelled) {
          yield* ctx.runtime
            .sendExtensionUiResponse({ id: requestId, cancelled: true })
            .pipe(Effect.mapError((cause) => mapPiError(threadId, "extension_ui_response", cause)));
        } else {
          yield* ctx.runtime
            .sendExtensionUiResponse({
              id: requestId,
              ...(responseBody.value !== undefined ? { value: responseBody.value } : {}),
            })
            .pipe(Effect.mapError((cause) => mapPiError(threadId, "extension_ui_response", cause)));
        }
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
        const ctx = yield* requireSession(threadId);
        const messages = yield* ctx.runtime
          .getMessages()
          .pipe(Effect.mapError((cause) => mapPiError(threadId, "get_messages", cause)));

        const turns: Array<{ id: TurnId; items: ReadonlyArray<unknown> }> = [];
        let currentTurn: { id: TurnId; items: Array<unknown> } | null = null;

        for (const message of messages) {
          if (!isRecord(message)) continue;
          const role = typeof message.role === "string" ? message.role : undefined;
          const messageId = typeof message.id === "string" ? message.id : crypto.randomUUID();
          if (role === "user") {
            if (currentTurn) {
              turns.push(currentTurn);
            }
            currentTurn = { id: TurnId.make(messageId), items: [message] };
            continue;
          }
          if (currentTurn) {
            currentTurn.items.push(message);
          }
        }
        if (currentTurn) {
          turns.push(currentTurn);
        }

        return { threadId, turns };
      });

    const rollbackThread: PiAgentAdapterShape["rollbackThread"] = (threadId, numTurns) =>
      Effect.gen(function* () {
        const ctx = yield* requireSession(threadId);
        const forkMessages = yield* ctx.runtime
          .getForkMessages()
          .pipe(Effect.mapError((cause) => mapPiError(threadId, "get_fork_messages", cause)));
        const targetIndex = forkMessages.length - numTurns - 1;
        const target = targetIndex >= 0 ? forkMessages[targetIndex] : undefined;
        if (target) {
          yield* ctx.runtime
            .fork(target.entryId)
            .pipe(Effect.mapError((cause) => mapPiError(threadId, "fork", cause)));
        }
        return yield* readThread(threadId);
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
