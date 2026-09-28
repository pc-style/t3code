/**
 * Counts user messages that swear at the agent, grouped by the model the turn
 * was sent to.
 *
 * Profanity is rare, so a `LIKE` prefilter keeps the message scan cheap and
 * only the matches pay for the model lookup, which goes through the per-thread
 * event index rather than scanning the event log.
 *
 * @module swearTally
 */
import {
  ModelSelection,
  type ProviderInstanceConfig,
  type UsageSummaryInput,
  type UsageSwearTally,
  UsageProviderKind,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { makeDayFormatter } from "./usageAggregation.ts";

/** Substrings every match of {@link SWEAR_PATTERN} contains, for the SQL prefilter. */
const SWEAR_STEMS = [
  "fuck",
  "shit",
  "wtf",
  "stfu",
  "ffs",
  "damn",
  "crap",
  "asshole",
  "dumbass",
  "bitch",
  "bastard",
  "piss",
] as const;

const SWEAR_PATTERN =
  /\b(?:fuck\w*|\w*shit\w*|wtf|stfu|ffs|damn\w*|goddamn\w*|crap\w*|asshole\w*|dumbass\w*|bitch\w*|bastard\w*|piss\w*)\b/i;

export function containsSwearing(text: string): boolean {
  return SWEAR_PATTERN.test(text);
}

const isUsageProviderKind = Schema.is(UsageProviderKind);

function usageProviderForDriver(driver: string): UsageProviderKind | undefined {
  const provider = driver === "claudeAgent" ? "claude" : driver;
  return isUsageProviderKind(provider) ? provider : undefined;
}

const decodeSelection = Schema.decodeUnknownOption(Schema.fromJsonString(ModelSelection));

function toEpochMillis(iso: string): number | null {
  const parsed = DateTime.make(iso);
  return Option.isSome(parsed) ? DateTime.toEpochMillis(parsed.value) : null;
}

/** A superset of the window in UTC, narrowed per message once its local day is known. */
function coarseBounds(input: UsageSummaryInput): {
  readonly lower: string;
  readonly upper: string;
} {
  if (input.resolution === "hour" && input.sinceTime && input.untilTime) {
    return { lower: input.sinceTime, upper: input.untilTime };
  }
  const shift = (day: string, days: number) =>
    DateTime.make(`${day}T00:00:00Z`).pipe(
      Option.map((value) => DateTime.formatIso(DateTime.add(value, { days }))),
      Option.getOrElse(() => `${day}T00:00:00.000Z`),
    );
  return { lower: shift(input.sinceDay, -1), upper: shift(input.untilDay, 2) };
}

export const readSwearTally = Effect.fn("readSwearTally")(function* (
  input: UsageSummaryInput,
  providerInstances: Readonly<Record<string, Pick<ProviderInstanceConfig, "driver">>>,
) {
  const sql = yield* SqlClient.SqlClient;
  const { lower, upper } = coarseBounds(input);

  const candidates = yield* sql<{
    readonly messageId: string;
    readonly threadId: string;
    readonly text: string;
    readonly createdAt: string;
    readonly threadModelSelection: string | null;
  }>`
    SELECT
      m.message_id AS "messageId",
      m.thread_id AS "threadId",
      m.text AS "text",
      m.created_at AS "createdAt",
      t.model_selection_json AS "threadModelSelection"
    FROM projection_thread_messages m
    LEFT JOIN projection_threads t ON t.thread_id = m.thread_id
    WHERE m.role = 'user'
      AND m.created_at >= ${lower}
      AND m.created_at < ${upper}
      AND ${sql.or(SWEAR_STEMS.map((stem) => sql`m.text LIKE ${`%${stem}%`}`))}
  `;

  const hourly =
    input.resolution === "hour" && input.sinceTime && input.untilTime
      ? { since: toEpochMillis(input.sinceTime), until: toEpochMillis(input.untilTime) }
      : null;
  const toDay = makeDayFormatter(input.timeZone);
  const swearing = candidates.filter((message) => {
    const at = toEpochMillis(message.createdAt);
    if (at === null || !containsSwearing(message.text)) return false;
    if (hourly !== null) {
      return (
        hourly.since !== null && hourly.until !== null && at >= hourly.since && at < hourly.until
      );
    }
    const day = toDay(at);
    return day >= input.sinceDay && day <= input.untilDay;
  });
  if (swearing.length === 0) return [];

  const turnStarts = yield* sql<{
    readonly messageId: string | null;
    readonly modelSelection: string | null;
  }>`
    SELECT
      json_extract(payload_json, '$.messageId') AS "messageId",
      json_extract(payload_json, '$.modelSelection') AS "modelSelection"
    FROM orchestration_events
    WHERE aggregate_kind = 'thread'
      AND ${sql.in("stream_id", [...new Set(swearing.map((message) => message.threadId))])}
      AND event_type = 'thread.turn-start-requested'
  `;
  const selectionByMessage = new Map<string, string | null>();
  for (const row of turnStarts) {
    if (row.messageId !== null) selectionByMessage.set(row.messageId, row.modelSelection);
  }

  const counts = new Map<
    string,
    { provider: UsageProviderKind | undefined; model: string; messages: number }
  >();
  for (const message of swearing) {
    // A turn start without a selection ran on the thread's model.
    const selection = Option.orElse(
      decodeSelection(selectionByMessage.get(message.messageId)),
      () => decodeSelection(message.threadModelSelection),
    );
    if (Option.isNone(selection)) continue;
    const { instanceId, model } = selection.value;
    const provider = usageProviderForDriver(providerInstances[instanceId]?.driver ?? instanceId);
    const key = `${provider ?? ""}\u0000${model}`;
    const entry = counts.get(key) ?? { provider, model, messages: 0 };
    entry.messages += 1;
    counts.set(key, entry);
  }

  return [...counts.values()]
    .map(({ provider, model, messages }): UsageSwearTally =>
      provider === undefined ? { model, messages } : { provider, model, messages },
    )
    .toSorted((a, b) => b.messages - a.messages);
});
