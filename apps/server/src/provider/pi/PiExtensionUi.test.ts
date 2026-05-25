import { ProviderDriverKind, EventId } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import {
  mapPiExtensionUiRequestToRuntimeEvents,
  parsePiExtensionUiMethod,
  resolvePiExtensionUiResponse,
} from "./PiExtensionUi.ts";

const stamp = {
  eventId: EventId.make("event-1"),
  createdAt: "2026-05-25T00:00:00.000Z",
};

describe("PiExtensionUi", () => {
  it("maps file-change confirms before generic file read approval", () => {
    const events = mapPiExtensionUiRequestToRuntimeEvents({
      stamp,
      provider: ProviderDriverKind.make("piAgent"),
      threadId: "thread-1" as never,
      turnId: undefined,
      event: {
        type: "extension_ui_request",
        id: "req-file-change",
        method: "confirm",
        title: "Allow file edit?",
        message: "Patch src/index.ts",
      },
    });

    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe("request.opened");
    if (events[0]?.type === "request.opened") {
      expect(events[0].payload.requestType).toBe("file_change_approval");
    }
  });

  it("maps confirm dialogs to approval requests", () => {
    const events = mapPiExtensionUiRequestToRuntimeEvents({
      stamp,
      provider: ProviderDriverKind.make("piAgent"),
      threadId: "thread-1" as never,
      turnId: undefined,
      event: {
        type: "extension_ui_request",
        id: "req-1",
        method: "confirm",
        title: "Allow bash command?",
        message: "ls -la",
      },
    });

    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe("request.opened");
    if (events[0]?.type === "request.opened") {
      expect(events[0].payload.requestType).toBe("command_execution_approval");
      expect(events[0].payload.detail).toBe("ls -la");
    }
  });

  it("maps select dialogs to user-input requests", () => {
    const events = mapPiExtensionUiRequestToRuntimeEvents({
      stamp,
      provider: ProviderDriverKind.make("piAgent"),
      threadId: "thread-1" as never,
      turnId: undefined,
      event: {
        type: "extension_ui_request",
        id: "req-2",
        method: "select",
        title: "Choose provider",
        options: ["Anthropic", "OpenAI"],
      },
    });

    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe("user-input.requested");
    if (events[0]?.type === "user-input.requested") {
      expect(events[0].payload.questions[0]?.options).toHaveLength(2);
    }
  });

  it("resolves confirm decisions", () => {
    expect(
      resolvePiExtensionUiResponse({
        pendingKind: "confirm",
        decision: "accept",
      }),
    ).toEqual({ confirmed: true });
    expect(
      resolvePiExtensionUiResponse({
        pendingKind: "confirm",
        decision: "cancel",
      }),
    ).toEqual({ cancelled: true });
  });

  it("parses extension UI methods", () => {
    expect(parsePiExtensionUiMethod({ method: "notify" })).toBe("notify");
    expect(parsePiExtensionUiMethod({ method: "unknown-method" })).toBe("unknown");
  });
});
