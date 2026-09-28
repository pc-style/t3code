/**
 * Swear jar: per model, how many of the user's messages cursed at it or were
 * fed up with it. A joke statistic built on regexes, not sentiment analysis.
 *
 * Every user message in the window counts toward its model's total, so each
 * one is attributed through its `thread.turn-start-requested` event, read via
 * the per-thread event index. Only messages that pass a `LIKE` prefilter carry
 * their text back for classification.
 *
 * @module swearJar
 */
import {
  ModelSelection,
  type ProviderInstanceConfig,
  type SwearJarInput,
  type SwearJarModel,
  type UsageBucket,
  UsageProviderKind,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { makeDayFormatter } from "./usageAggregation.ts";

const CURSE_PATTERN =
  /\b(?:fuck\w*|\w*shit\w*|wtf|stfu|ffs|damn\w*|goddamn\w*|crap\w*|asshole\w*|dumbass\w*|bitch\w*|bastard\w*|piss\w*|idiot\w*|stupid\w*|moron\w*|useless|incompetent)\b/i;

const FRUSTRATION_PATTERN =
  /\b(?:what (?:are|were) you doing|why (?:did|would|are|do) you|i (?:already )?(?:told|asked) you|i said|that'?s (?:not|wrong)|not what i (?:asked|said|meant|wanted)|you (?:broke|deleted|removed|ignored|forgot)|(?:just )?stop (?:it|that|doing)|seriously|ugh+|come on|are you kidding|no no|nope)\b|again\?|[!?]{3,}/i;

/** Substrings every match of the patterns above contains, for the SQL prefilter. */
const PREFILTER_STEMS = [
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
  "idiot",
  "stupid",
  "moron",
  "useless",
  "incompetent",
  "you doing",
  "why did you",
  "why would you",
  "why are you",
  "why do you",
  "told you",
  "asked you",
  "i said",
  "that's",
  "thats",
  "not what i",
  "you broke",
  "you deleted",
  "you removed",
  "you ignored",
  "you forgot",
  "stop",
  "kidding",
  "seriously",
  "ugh",
  "come on",
  "no no",
  "nope",
  "again?",
  "!!!",
  "???",
  "!?",
  "?!",
] as const;

export type SwearJarMood = "cursed" | "frustrated";

/** Cursing wins over frustration, so each message lands in one bucket. */
export function classifyMessage(text: string): SwearJarMood | null {
  if (CURSE_PATTERN.test(text)) return "cursed";
  if (FRUSTRATION_PATTERN.test(text)) return "frustrated";
  return null;
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

function shiftDay(day: string, days: number): string {
  return DateTime.make(`${day}T00:00:00Z`).pipe(
    Option.map((value) => DateTime.formatIso(DateTime.add(value, { days }))),
    Option.getOrElse(() => `${day}T00:00:00.000Z`),
  );
}

/** SQLite's default variable limit is far above this; it only bounds statement size. */
const THREAD_CHUNK_SIZE = 500;

export type SwearJarCounts = Omit<SwearJarModel, "outputTokens">;

export const readSwearJarCounts = Effect.fn("readSwearJarCounts")(function* (
  input: SwearJarInput,
  providerInstances: Readonly<Record<string, Pick<ProviderInstanceConfig, "driver">>>,
) {
  const sql = yield* SqlClient.SqlClient;
  // A UTC superset of the window, narrowed per message once its local day is known.
  const lower = shiftDay(input.sinceDay, -1);
  const upper = shiftDay(input.untilDay, 2);

  const rows = yield* sql<{
    readonly messageId: string;
    readonly threadId: string;
    readonly createdAt: string;
    readonly text: string | null;
    readonly threadModelSelection: string | null;
  }>`
    SELECT
      m.message_id AS "messageId",
      m.thread_id AS "threadId",
      m.created_at AS "createdAt",
      CASE
        WHEN ${sql.or(PREFILTER_STEMS.map((stem) => sql`m.text LIKE ${`%${stem}%`}`))}
        THEN m.text
      END AS "text",
      t.model_selection_json AS "threadModelSelection"
    FROM projection_thread_messages m
    LEFT JOIN projection_threads t ON t.thread_id = m.thread_id
    WHERE m.role = 'user'
      AND m.created_at >= ${lower}
      AND m.created_at < ${upper}
  `;

  const toDay = makeDayFormatter(input.timeZone);
  const messages = rows.filter((row) => {
    const at = toEpochMillis(row.createdAt);
    if (at === null) return false;
    const day = toDay(at);
    return day >= input.sinceDay && day <= input.untilDay;
  });
  if (messages.length === 0) return [];

  const threadIds = [...new Set(messages.map((message) => message.threadId))];
  const selectionByMessage = new Map<string, string | null>();
  for (let start = 0; start < threadIds.length; start += THREAD_CHUNK_SIZE) {
    const turnStarts = yield* sql<{
      readonly messageId: string | null;
      readonly modelSelection: string | null;
    }>`
      SELECT
        json_extract(payload_json, '$.messageId') AS "messageId",
        json_extract(payload_json, '$.modelSelection') AS "modelSelection"
      FROM orchestration_events
      WHERE aggregate_kind = 'thread'
        AND ${sql.in("stream_id", threadIds.slice(start, start + THREAD_CHUNK_SIZE))}
        AND event_type = 'thread.turn-start-requested'
    `;
    for (const row of turnStarts) {
      if (row.messageId !== null) selectionByMessage.set(row.messageId, row.modelSelection);
    }
  }

  const counts = new Map<
    string,
    {
      provider: UsageProviderKind | undefined;
      model: string;
      messages: number;
      cursed: number;
      frustrated: number;
    }
  >();
  for (const message of messages) {
    // A turn start without a selection ran on the thread's model.
    const selection = Option.orElse(
      decodeSelection(selectionByMessage.get(message.messageId)),
      () => decodeSelection(message.threadModelSelection),
    );
    if (Option.isNone(selection)) continue;
    const { instanceId, model } = selection.value;
    const provider = usageProviderForDriver(providerInstances[instanceId]?.driver ?? instanceId);
    const key = `${provider ?? ""}\u0000${model}`;
    const entry = counts.get(key) ?? { provider, model, messages: 0, cursed: 0, frustrated: 0 };
    entry.messages += 1;
    const mood = message.text === null ? null : classifyMessage(message.text);
    if (mood !== null) entry[mood] += 1;
    counts.set(key, entry);
  }

  return [...counts.values()].map(({ provider, ...rest }): SwearJarCounts =>
    provider === undefined ? rest : { provider, ...rest },
  );
});

/**
 * Joins output tokens from usage buckets. Transcripts sometimes name a model
 * with a dated suffix (`claude-x-20260101`) where T3 stores the bare slug.
 */
export function attachOutputTokens(
  counts: readonly SwearJarCounts[],
  buckets: readonly UsageBucket[],
): SwearJarModel[] {
  return counts.map((row) => {
    let outputTokens = 0;
    if (row.provider !== undefined) {
      for (const bucket of buckets) {
        if (
          bucket.provider === row.provider &&
          (bucket.model === row.model || bucket.model.startsWith(`${row.model}-`))
        ) {
          outputTokens += bucket.totals.outputTokens;
        }
      }
    }
    return { ...row, outputTokens };
  });
}
