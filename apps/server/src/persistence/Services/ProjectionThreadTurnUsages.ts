import {
  CodexTurnUsageSummary,
  IsoDateTime,
  NonNegativeInt,
  ThreadId,
  TurnId,
  type CodexUsagePricingMode,
} from "@t3tools/contracts";
import { Context, Schema } from "effect";
import type { Effect } from "effect";

import type { ProjectionRepositoryError } from "../Errors.ts";

export const ProjectionThreadTurnUsage = Schema.Struct({
  threadId: ThreadId,
  turnId: TurnId,
  model: Schema.String,
  pricingMode: Schema.Literals([
    "token-based" as CodexUsagePricingMode,
    "legacy" as CodexUsagePricingMode,
    "unknown" as CodexUsagePricingMode,
  ]),
  inputTokens: NonNegativeInt,
  cachedInputTokens: NonNegativeInt,
  outputTokens: NonNegativeInt,
  reasoningOutputTokens: NonNegativeInt,
  creditsUsed: Schema.Number,
  usdCost: Schema.NullOr(Schema.Number),
  completedAt: IsoDateTime,
});
export type ProjectionThreadTurnUsage = typeof ProjectionThreadTurnUsage.Type;

export const ListProjectionThreadTurnUsagesInput = Schema.Struct({
  threadId: ThreadId,
});
export type ListProjectionThreadTurnUsagesInput = typeof ListProjectionThreadTurnUsagesInput.Type;

export const DeleteProjectionThreadTurnUsagesInput = Schema.Struct({
  threadId: ThreadId,
});
export type DeleteProjectionThreadTurnUsagesInput =
  typeof DeleteProjectionThreadTurnUsagesInput.Type;

export interface ProjectionThreadTurnUsageRepositoryShape {
  readonly upsert: (
    row: ProjectionThreadTurnUsage,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly listByThreadId: (
    input: ListProjectionThreadTurnUsagesInput,
  ) => Effect.Effect<ReadonlyArray<ProjectionThreadTurnUsage>, ProjectionRepositoryError>;
  readonly deleteByThreadId: (
    input: DeleteProjectionThreadTurnUsagesInput,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
}

export class ProjectionThreadTurnUsageRepository extends Context.Service<
  ProjectionThreadTurnUsageRepository,
  ProjectionThreadTurnUsageRepositoryShape
>()("t3/persistence/Services/ProjectionThreadTurnUsages/ProjectionThreadTurnUsageRepository") {}
