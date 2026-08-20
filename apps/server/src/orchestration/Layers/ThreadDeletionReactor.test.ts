import { ProjectId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import { describe, expect, it } from "vite-plus/test";

import type { ProjectionThread } from "../../persistence/Services/ProjectionThreads.ts";
import {
  logCleanupCauseUnlessInterrupted,
  shouldSkipThreadDeletionCleanup,
} from "./ThreadDeletionReactor.ts";

describe("logCleanupCauseUnlessInterrupted", () => {
  const threadId = ThreadId.make("thread-deletion-reactor-test");

  it("swallows ordinary cleanup failures", async () => {
    const exit = await Effect.runPromiseExit(
      logCleanupCauseUnlessInterrupted({
        effect: Effect.fail("cleanup failed"),
        message: "thread deletion cleanup skipped provider session stop",
        threadId,
      }),
    );

    expect(Exit.isSuccess(exit)).toBe(true);
  });

  it("preserves interrupt causes", async () => {
    const exit = await Effect.runPromiseExit(
      logCleanupCauseUnlessInterrupted({
        effect: Effect.interrupt,
        message: "thread deletion cleanup skipped provider session stop",
        threadId,
      }),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(Cause.hasInterruptsOnly(exit.cause)).toBe(true);
    }
  });
});

describe("shouldSkipThreadDeletionCleanup", () => {
  const now = "2026-01-01T00:00:00.000Z";
  const row: ProjectionThread = {
    threadId: ThreadId.make("thread-deletion-reactor-test"),
    projectId: ProjectId.make("project-deletion-reactor-test"),
    title: "Thread",
    modelSelection: {
      instanceId: ProviderInstanceId.make("codex"),
      model: "gpt-5-codex",
    },
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    latestTurnId: null,
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    snoozedUntil: null,
    snoozedAt: null,
    pinnedAt: null,
    latestUserMessageAt: null,
    pendingApprovalCount: 0,
    pendingUserInputCount: 0,
    hasActionableProposedPlan: 0,
    deletedAt: null,
  };

  it("skips cleanup when the thread id was re-created and is live again", () => {
    expect(shouldSkipThreadDeletionCleanup(Option.some(row))).toBe(true);
  });

  it("cleans up when the thread row is still soft-deleted", () => {
    expect(shouldSkipThreadDeletionCleanup(Option.some({ ...row, deletedAt: now }))).toBe(false);
  });

  it("cleans up when the thread row is gone", () => {
    expect(shouldSkipThreadDeletionCleanup(Option.none())).toBe(false);
  });
});
