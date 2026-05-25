import {
  type EventId,
  type ProviderDriverKind,
  type ProviderRuntimeEvent,
  RuntimeItemId,
  type RuntimeRequestId,
  type ThreadId,
  type ToolLifecycleItemType,
  type TurnId,
} from "@t3tools/contracts";

export const PI_RPC_RAW_SOURCE = "pi.rpc.event" as const;

interface PiEventStamp {
  readonly eventId: EventId;
  readonly createdAt: string;
}

function canonicalToolItemType(toolName: string): ToolLifecycleItemType {
  const normalized = toolName.toLowerCase();
  if (normalized.includes("bash") || normalized === "shell") {
    return "command_execution";
  }
  if (normalized.includes("edit") || normalized.includes("write")) {
    return "file_change";
  }
  if (normalized.includes("grep") || normalized.includes("find") || normalized.includes("ls")) {
    return "dynamic_tool_call";
  }
  return "dynamic_tool_call";
}

export function makePiAssistantItemEvent(input: {
  readonly stamp: PiEventStamp;
  readonly provider: ProviderDriverKind;
  readonly threadId: ThreadId;
  readonly turnId: TurnId | undefined;
  readonly itemId: string;
  readonly lifecycle: "item.started" | "item.completed";
}): ProviderRuntimeEvent {
  return {
    type: input.lifecycle,
    ...input.stamp,
    provider: input.provider,
    threadId: input.threadId,
    turnId: input.turnId,
    itemId: RuntimeItemId.make(input.itemId),
    payload: {
      itemType: "assistant_message",
      status: input.lifecycle === "item.completed" ? "completed" : "inProgress",
    },
    raw: {
      source: PI_RPC_RAW_SOURCE,
      payload: { kind: "assistant_item", itemId: input.itemId },
    },
  };
}

export function makePiContentDeltaEvent(input: {
  readonly stamp: PiEventStamp;
  readonly provider: ProviderDriverKind;
  readonly threadId: ThreadId;
  readonly turnId: TurnId | undefined;
  readonly itemId?: string;
  readonly delta: string;
  readonly streamKind?: "assistant_text" | "reasoning_text";
  readonly rawPayload: unknown;
}): ProviderRuntimeEvent {
  return {
    type: "content.delta",
    ...input.stamp,
    provider: input.provider,
    threadId: input.threadId,
    turnId: input.turnId,
    ...(input.itemId ? { itemId: RuntimeItemId.make(input.itemId) } : {}),
    payload: {
      streamKind: input.streamKind ?? "assistant_text",
      delta: input.delta,
    },
    raw: {
      source: PI_RPC_RAW_SOURCE,
      payload: input.rawPayload,
    },
  };
}

export function makePiToolCallEvent(input: {
  readonly stamp: PiEventStamp;
  readonly provider: ProviderDriverKind;
  readonly threadId: ThreadId;
  readonly turnId: TurnId | undefined;
  readonly toolCallId: string;
  readonly toolName: string;
  readonly lifecycle: "item.updated" | "item.completed";
  readonly title?: string;
  readonly detail?: string;
  readonly isError?: boolean;
  readonly rawPayload: unknown;
}): ProviderRuntimeEvent {
  return {
    type: input.lifecycle,
    ...input.stamp,
    provider: input.provider,
    threadId: input.threadId,
    turnId: input.turnId,
    itemId: RuntimeItemId.make(input.toolCallId),
    payload: {
      itemType: canonicalToolItemType(input.toolName),
      status:
        input.lifecycle === "item.completed"
          ? input.isError
            ? "failed"
            : "completed"
          : "inProgress",
      ...(input.title ? { title: input.title } : {}),
      ...(input.detail ? { detail: input.detail } : {}),
    },
    raw: {
      source: PI_RPC_RAW_SOURCE,
      payload: input.rawPayload,
    },
  };
}

export function makePiExtensionUiRequestEvent(input: {
  readonly stamp: PiEventStamp;
  readonly provider: ProviderDriverKind;
  readonly threadId: ThreadId;
  readonly turnId: TurnId | undefined;
  readonly requestId: RuntimeRequestId;
  readonly title: string;
  readonly detail?: string;
  readonly rawPayload: unknown;
}): ProviderRuntimeEvent {
  return {
    type: "request.opened",
    ...input.stamp,
    provider: input.provider,
    threadId: input.threadId,
    turnId: input.turnId,
    requestId: input.requestId,
    payload: {
      requestType: "unknown",
      detail: input.detail ?? input.title,
      args: input.rawPayload,
    },
    raw: {
      source: PI_RPC_RAW_SOURCE,
      payload: input.rawPayload,
    },
  };
}
