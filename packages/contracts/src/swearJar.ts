/**
 * Swear jar contract: how often the user curses at, or is fed up with, each
 * model. A joke statistic, opt-in on the client, never part of usage.
 *
 * Environments return per-model counts. Message text never crosses the wire.
 *
 * @module swearJar
 */
import * as Schema from "effect/Schema";

import { ForwardCompatibleArray, NonNegativeInt, TrimmedNonEmptyString } from "./baseSchemas.ts";
import { UsageDay, UsageProviderKind } from "./usage.ts";

export const SwearJarInput = Schema.Struct({
  /** Inclusive first day of the window, in `timeZone`. */
  sinceDay: UsageDay,
  /** Inclusive last day of the window, in `timeZone`. */
  untilDay: UsageDay,
  timeZone: TrimmedNonEmptyString,
});
export type SwearJarInput = typeof SwearJarInput.Type;

export const SwearJarModel = Schema.Struct({
  /** Absent when the provider instance's driver has no usage presentation. */
  provider: Schema.optionalKey(UsageProviderKind),
  model: TrimmedNonEmptyString,
  /** User messages sent to the model from T3 Code in the window. */
  messages: NonNegativeInt,
  /** Messages that cursed at or insulted the model. */
  cursed: NonNegativeInt,
  /** Messages that were fed up without cursing. Disjoint from `cursed`. */
  frustrated: NonNegativeInt,
  /** Output tokens from this environment's usage transcripts; 0 when unknown. */
  outputTokens: NonNegativeInt,
});
export type SwearJarModel = typeof SwearJarModel.Type;

export const SwearJar = Schema.Struct({
  models: ForwardCompatibleArray(SwearJarModel),
});
export type SwearJar = typeof SwearJar.Type;

export class SwearJarReadError extends Schema.TaggedError<SwearJarReadError>()(
  "SwearJarReadError",
  {
    detail: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return `Swear jar read failed: ${this.detail}`;
  }
}
