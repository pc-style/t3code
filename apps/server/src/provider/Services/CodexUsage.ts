import type { CodexUsageSnapshot, ProviderRuntimeEvent } from "@t3tools/contracts";
import { Context } from "effect";
import type { Effect, Stream } from "effect";

export interface CodexUsageShape {
  readonly getSnapshot: (options?: {
    readonly forceRefresh?: boolean;
  }) => Effect.Effect<CodexUsageSnapshot>;
  readonly refresh: () => Effect.Effect<CodexUsageSnapshot>;
  readonly ingestRuntimeEvent: (event: ProviderRuntimeEvent) => Effect.Effect<void>;
  readonly streamChanges: Stream.Stream<CodexUsageSnapshot>;
}

export class CodexUsage extends Context.Service<CodexUsage, CodexUsageShape>()(
  "t3/provider/Services/CodexUsage",
) {}
