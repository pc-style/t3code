import {
  type EventId,
  type ProviderDriverKind,
  type ProviderRuntimeEvent,
  RuntimeItemId,
  type RuntimeRequestId,
  RuntimeTaskId,
  type ThreadId,
  type ToolLifecycleItemType,
  type TurnId,
  type CanonicalRequestType,
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
  readonly requestType: CanonicalRequestType;
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
      requestType: input.requestType,
      detail: input.detail ?? input.title,
      args: input.rawPayload,
    },
    raw: {
      source: PI_RPC_RAW_SOURCE,
      payload: input.rawPayload,
    },
  };
}

export function makePiToolProgressEvent(input: {
  readonly stamp: PiEventStamp;
  readonly provider: ProviderDriverKind;
  readonly threadId: ThreadId;
  readonly turnId: TurnId | undefined;
  readonly toolCallId: string;
  readonly summary: string;
  readonly rawPayload: unknown;
}): ProviderRuntimeEvent {
  return {
    type: "tool.progress",
    ...input.stamp,
    provider: input.provider,
    threadId: input.threadId,
    turnId: input.turnId,
    itemId: RuntimeItemId.make(input.toolCallId),
    payload: {
      summary: input.summary,
    },
    raw: {
      source: PI_RPC_RAW_SOURCE,
      payload: input.rawPayload,
    },
  };
}

export function makePiTaskProgressEvent(input: {
  readonly stamp: PiEventStamp;
  readonly provider: ProviderDriverKind;
  readonly threadId: ThreadId;
  readonly turnId: TurnId | undefined;
  readonly taskId: string;
  readonly summary: string;
  readonly rawPayload: unknown;
}): ProviderRuntimeEvent {
  return {
    type: "task.progress",
    ...input.stamp,
    provider: input.provider,
    threadId: input.threadId,
    turnId: input.turnId,
    payload: {
      taskId: RuntimeTaskId.make(input.taskId),
      description: input.summary,
      summary: input.summary,
    },
    raw: {
      source: PI_RPC_RAW_SOURCE,
      payload: input.rawPayload,
    },
  };
}

export function makePiRuntimeWarningEvent(input: {
  readonly stamp: PiEventStamp;
  readonly provider: ProviderDriverKind;
  readonly threadId: ThreadId;
  readonly turnId: TurnId | undefined;
  readonly message: string;
  readonly detail?: unknown;
  readonly rawPayload?: unknown;
}): ProviderRuntimeEvent {
  return {
    type: "runtime.warning",
    ...input.stamp,
    provider: input.provider,
    threadId: input.threadId,
    turnId: input.turnId,
    payload: {
      message: input.message,
      ...(input.detail !== undefined ? { detail: input.detail } : {}),
    },
    ...(input.rawPayload !== undefined
      ? { raw: { source: PI_RPC_RAW_SOURCE, payload: input.rawPayload } }
      : {}),
  };
}

export function makePiRuntimeErrorEvent(input: {
  readonly stamp: PiEventStamp;
  readonly provider: ProviderDriverKind;
  readonly threadId: ThreadId;
  readonly turnId: TurnId | undefined;
  readonly message: string;
  readonly detail?: unknown;
  readonly rawPayload?: unknown;
}): ProviderRuntimeEvent {
  return {
    type: "runtime.error",
    ...input.stamp,
    provider: input.provider,
    threadId: input.threadId,
    turnId: input.turnId,
    payload: {
      message: input.message,
      ...(input.detail !== undefined ? { detail: input.detail } : {}),
    },
    ...(input.rawPayload !== undefined
      ? { raw: { source: PI_RPC_RAW_SOURCE, payload: input.rawPayload } }
      : {}),
  };
}

export function makePiTokenUsageEvent(input: {
  readonly stamp: PiEventStamp;
  readonly provider: ProviderDriverKind;
  readonly threadId: ThreadId;
  readonly turnId: TurnId | undefined;
  readonly stats: {
    readonly input: number;
    readonly output: number;
    readonly cacheRead: number;
    readonly total: number;
    readonly contextTokens: number | null;
    readonly contextWindow: number | null;
    readonly toolCalls: number;
  };
}): ProviderRuntimeEvent {
  return {
    type: "thread.token-usage.updated",
    ...input.stamp,
    provider: input.provider,
    threadId: input.threadId,
    turnId: input.turnId,
    payload: {
      usage: {
        usedTokens: input.stats.contextTokens ?? input.stats.total,
        totalProcessedTokens: input.stats.total,
        ...(input.stats.contextWindow && input.stats.contextWindow > 0
          ? { maxTokens: input.stats.contextWindow }
          : {}),
        inputTokens: input.stats.input,
        cachedInputTokens: input.stats.cacheRead,
        outputTokens: input.stats.output,
        toolUses: input.stats.toolCalls,
        compactsAutomatically: true,
      },
    },
  };
}
