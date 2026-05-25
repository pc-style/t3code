import {
  type CanonicalRequestType,
  type ProviderRuntimeEvent,
  type UserInputQuestion,
  ApprovalRequestId,
  RuntimeRequestId,
  type EventId,
  type ProviderDriverKind,
  type ThreadId,
  type TurnId,
} from "@t3tools/contracts";

import { PI_RPC_RAW_SOURCE } from "./PiCoreRuntimeEvents.ts";

export type PiExtensionUiMethod =
  | "select"
  | "confirm"
  | "input"
  | "editor"
  | "notify"
  | "setStatus"
  | "setWidget"
  | "setTitle"
  | "set_editor_text"
  | "unknown";

export interface PiExtensionUiRuntimeEventsInput {
  readonly stamp: { readonly eventId: EventId; readonly createdAt: string };
  readonly provider: ProviderDriverKind;
  readonly threadId: ThreadId;
  readonly turnId: TurnId | undefined;
  readonly event: Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parsePiExtensionUiMethod(event: Record<string, unknown>): PiExtensionUiMethod {
  const method = typeof event.method === "string" ? event.method : "unknown";
  switch (method) {
    case "select":
    case "confirm":
    case "input":
    case "editor":
    case "notify":
    case "setStatus":
    case "setWidget":
    case "setTitle":
    case "set_editor_text":
      return method;
    default:
      return "unknown";
  }
}

export function isPiExtensionUiDialogMethod(method: PiExtensionUiMethod): boolean {
  return method === "select" || method === "confirm" || method === "input" || method === "editor";
}

export function isPiExtensionUiFireAndForgetMethod(method: PiExtensionUiMethod): boolean {
  return (
    method === "notify" ||
    method === "setStatus" ||
    method === "setWidget" ||
    method === "setTitle" ||
    method === "set_editor_text"
  );
}

function inferConfirmRequestType(title: string, message: string | undefined): CanonicalRequestType {
  const combined = `${title} ${message ?? ""}`.toLowerCase();
  if (
    combined.includes("bash") ||
    combined.includes("command") ||
    combined.includes("shell") ||
    combined.includes("exec")
  ) {
    return "command_execution_approval";
  }
  if (combined.includes("edit") || combined.includes("write") || combined.includes("patch")) {
    return "file_change_approval";
  }
  if (combined.includes("read") || combined.includes("file")) {
    return "file_read_approval";
  }
  return "dynamic_tool_call";
}

function buildSelectQuestions(
  requestId: string,
  event: Record<string, unknown>,
): ReadonlyArray<UserInputQuestion> {
  const title = typeof event.title === "string" ? event.title : "Pi extension request";
  const optionsRaw = Array.isArray(event.options) ? event.options : [];
  const options = optionsRaw
    .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    .map((label) => ({ label, description: label }));

  return [
    {
      id: requestId,
      header: title,
      question: title,
      options: options.length > 0 ? options : [{ label: "OK", description: "Continue" }],
    },
  ];
}

function buildTextQuestions(
  requestId: string,
  event: Record<string, unknown>,
): ReadonlyArray<UserInputQuestion> {
  const title = typeof event.title === "string" ? event.title : "Pi extension request";
  const placeholder =
    typeof event.placeholder === "string"
      ? event.placeholder
      : typeof event.prefill === "string"
        ? event.prefill
        : undefined;
  const question = placeholder ?? title;

  return [
    {
      id: requestId,
      header: title,
      question,
      options: [],
    },
  ];
}

export function mapPiExtensionUiRequestToRuntimeEvents(
  input: PiExtensionUiRuntimeEventsInput,
): ReadonlyArray<ProviderRuntimeEvent> {
  if (typeof input.event.id !== "string") {
    return [];
  }

  const method = parsePiExtensionUiMethod(input.event);
  const requestId = ApprovalRequestId.make(input.event.id);
  const runtimeRequestId = RuntimeRequestId.make(requestId);
  const title = typeof input.event.title === "string" ? input.event.title : "Pi extension request";
  const message = typeof input.event.message === "string" ? input.event.message : undefined;

  if (method === "notify") {
    const notifyType = typeof input.event.notifyType === "string" ? input.event.notifyType : "info";
    return [
      {
        type: "runtime.warning",
        ...input.stamp,
        provider: input.provider,
        threadId: input.threadId,
        turnId: input.turnId,
        payload: {
          message: typeof input.event.message === "string" ? input.event.message : title,
          detail: { notifyType, source: "pi.extension_ui.notify" },
        },
        raw: { source: PI_RPC_RAW_SOURCE, payload: input.event },
      },
    ];
  }

  if (isPiExtensionUiFireAndForgetMethod(method)) {
    return [
      {
        type: "thread.metadata.updated",
        ...input.stamp,
        provider: input.provider,
        threadId: input.threadId,
        turnId: input.turnId,
        payload: {
          metadata: {
            piExtensionUi: {
              method,
              ...(typeof input.event.statusText === "string"
                ? { statusText: input.event.statusText }
                : {}),
              ...(typeof input.event.widgetLines !== "undefined"
                ? { widgetLines: input.event.widgetLines }
                : {}),
            },
          },
        },
        raw: { source: PI_RPC_RAW_SOURCE, payload: input.event },
      },
    ];
  }

  if (method === "confirm") {
    return [
      {
        type: "request.opened",
        ...input.stamp,
        provider: input.provider,
        threadId: input.threadId,
        turnId: input.turnId,
        requestId: runtimeRequestId,
        payload: {
          requestType: inferConfirmRequestType(title, message),
          detail: message ?? title,
          args: input.event,
        },
        raw: { source: PI_RPC_RAW_SOURCE, payload: input.event },
      },
    ];
  }

  if (method === "select") {
    return [
      {
        type: "user-input.requested",
        ...input.stamp,
        provider: input.provider,
        threadId: input.threadId,
        turnId: input.turnId,
        requestId: runtimeRequestId,
        payload: {
          questions: buildSelectQuestions(requestId, input.event),
        },
        raw: { source: PI_RPC_RAW_SOURCE, payload: input.event },
      },
    ];
  }

  if (method === "input" || method === "editor") {
    return [
      {
        type: "user-input.requested",
        ...input.stamp,
        provider: input.provider,
        threadId: input.threadId,
        turnId: input.turnId,
        requestId: runtimeRequestId,
        payload: {
          questions: buildTextQuestions(requestId, input.event),
        },
        raw: { source: PI_RPC_RAW_SOURCE, payload: input.event },
      },
    ];
  }

  return [];
}

export function resolvePiExtensionUiResponse(input: {
  readonly pendingKind: "confirm" | "select" | "input" | "editor";
  readonly decision?: "accept" | "acceptForSession" | "decline" | "cancel";
  readonly answers?: Record<string, unknown>;
  readonly prefill?: string;
}): {
  readonly confirmed?: boolean;
  readonly value?: string;
  readonly cancelled?: boolean;
} {
  const accepted = input.decision === "accept" || input.decision === "acceptForSession";

  if (input.pendingKind === "confirm") {
    if (input.decision === "cancel") {
      return { cancelled: true };
    }
    return { confirmed: accepted };
  }

  if (input.decision === "cancel" || input.decision === "decline") {
    return { cancelled: true };
  }

  const firstAnswer = input.answers ? Object.values(input.answers)[0] : undefined;
  if (typeof firstAnswer === "string" && firstAnswer.trim().length > 0) {
    return { value: firstAnswer.trim() };
  }

  if (input.pendingKind === "editor" && input.prefill && !firstAnswer) {
    return { value: input.prefill };
  }

  if (accepted) {
    return { cancelled: true };
  }

  return { cancelled: true };
}

export function extractPiToolProgressSummary(event: Record<string, unknown>): string | undefined {
  const partialResult = isRecord(event.partialResult) ? event.partialResult : undefined;
  if (!partialResult) {
    return undefined;
  }
  const content = Array.isArray(partialResult.content) ? partialResult.content : [];
  const chunks = content
    .map((entry) => (isRecord(entry) && typeof entry.text === "string" ? entry.text : ""))
    .filter((text) => text.length > 0);
  return chunks.length > 0 ? chunks.join("") : undefined;
}
