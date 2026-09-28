import { ProviderDriverKind, type UsageBucket, type UsageDay } from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import { attachOutputTokens, classifyMessage, readSwearJarCounts } from "./swearJar.ts";

const layer = it.layer(SqlitePersistenceMemory);
const encodePayload = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

const insertUserMessage = (message: {
  readonly id: string;
  readonly threadId: string;
  readonly text: string;
  readonly createdAt: string;
  readonly modelSelection?: { readonly instanceId: string; readonly model: string };
}) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`
      INSERT INTO projection_thread_messages (
        message_id, thread_id, turn_id, role, text, is_streaming, created_at, updated_at
      ) VALUES (
        ${message.id}, ${message.threadId}, NULL, 'user', ${message.text}, 0,
        ${message.createdAt}, ${message.createdAt}
      )
    `;
    const payload = encodePayload({
      threadId: message.threadId,
      messageId: message.id,
      ...(message.modelSelection ? { modelSelection: message.modelSelection } : {}),
      createdAt: message.createdAt,
    });
    yield* sql`
      INSERT INTO orchestration_events (
        event_id, aggregate_kind, stream_id, stream_version, event_type, occurred_at,
        actor_kind, payload_json, metadata_json
      ) VALUES (
        ${`event-${message.id}`}, 'thread', ${message.threadId},
        (SELECT COUNT(*) FROM orchestration_events WHERE stream_id = ${message.threadId}),
        'thread.turn-start-requested', ${message.createdAt}, 'client', ${payload}, '{}'
      )
    `;
  });

it("sorts messages into cursed, frustrated, or neither", () => {
  assert.strictEqual(classifyMessage("what the FUCK are you doing"), "cursed");
  assert.strictEqual(classifyMessage("this is bullshit"), "cursed");
  assert.strictEqual(classifyMessage("are you stupid?"), "cursed");
  assert.strictEqual(classifyMessage("why did you delete the tests"), "frustrated");
  assert.strictEqual(classifyMessage("that's not what I asked for"), "frustrated");
  assert.strictEqual(classifyMessage("again???"), "frustrated");
  assert.isNull(classifyMessage("scrap the draft and fix the offset assertion"));
  assert.isNull(classifyMessage("can you stop the dev server when you're done?"));
});

layer("readSwearJarCounts", (it) => {
  it.effect("attributes every message in the window to the model its turn was sent to", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`
        INSERT INTO projection_threads (
          thread_id, project_id, title, model_selection_json, created_at, updated_at
        ) VALUES (
          'thread-a', 'project-1', 'A', '{"instanceId":"claudeAgent","model":"claude-opus-5"}',
          '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z'
        )
      `;
      const codex = { instanceId: "work-codex", model: "gpt-5.6" };
      yield* insertUserMessage({
        id: "m1",
        threadId: "thread-a",
        text: "what the fuck are you doing",
        createdAt: "2026-09-10T12:00:00.000Z",
        modelSelection: codex,
      });
      yield* insertUserMessage({
        id: "m2",
        threadId: "thread-a",
        text: "why did you revert that",
        createdAt: "2026-09-11T12:00:00.000Z",
        modelSelection: codex,
      });
      yield* insertUserMessage({
        id: "m3",
        threadId: "thread-a",
        text: "add a test please",
        createdAt: "2026-09-11T13:00:00.000Z",
        modelSelection: codex,
      });
      // Sent without a selection, so it ran on the thread's model.
      yield* insertUserMessage({
        id: "m4",
        threadId: "thread-a",
        text: "damn it, again?",
        createdAt: "2026-09-12T12:00:00.000Z",
      });
      yield* insertUserMessage({
        id: "m5",
        threadId: "thread-a",
        text: "shit, outside the window",
        createdAt: "2026-08-01T12:00:00.000Z",
        modelSelection: codex,
      });

      const counts = yield* readSwearJarCounts(
        {
          sinceDay: "2026-09-01" as UsageDay,
          untilDay: "2026-09-30" as UsageDay,
          timeZone: "UTC",
        },
        { "work-codex": { driver: ProviderDriverKind.make("codex") } },
      );

      assert.deepStrictEqual(
        counts.toSorted((a, b) => a.model.localeCompare(b.model)),
        [
          {
            provider: "claude",
            model: "claude-opus-5",
            messages: 1,
            cursed: 1,
            frustrated: 0,
            days: [{ day: "2026-09-12" as UsageDay, cursed: 1, frustrated: 0 }],
          },
          {
            provider: "codex",
            model: "gpt-5.6",
            messages: 3,
            cursed: 1,
            frustrated: 1,
            days: [
              { day: "2026-09-10" as UsageDay, cursed: 1, frustrated: 0 },
              { day: "2026-09-11" as UsageDay, cursed: 0, frustrated: 1 },
            ],
          },
        ],
      );
    }),
  );
});

it("joins output tokens by provider, tolerating dated transcript model names", () => {
  const bucket = (provider: UsageBucket["provider"], model: string, outputTokens: number) =>
    ({
      day: "2026-09-10",
      provider,
      model,
      totals: {
        uncachedInputTokens: 0,
        cachedInputTokens: 0,
        cacheCreationTokens: 0,
        outputTokens,
        reasoningTokens: 0,
      },
      costUsd: 0,
      cacheSavingsUsd: 0,
      costSource: "unpriced",
      records: 1,
      unpricedRecords: 1,
      sessions: 1,
    }) as UsageBucket;

  const [row] = attachOutputTokens(
    [
      {
        provider: "claude",
        model: "claude-opus-5",
        messages: 4,
        cursed: 1,
        frustrated: 1,
        days: [],
      },
    ],
    [
      bucket("claude", "claude-opus-5", 100),
      bucket("claude", "claude-opus-5-20260901", 50),
      bucket("claude", "claude-opus-5.5", 999),
      bucket("codex", "claude-opus-5", 999),
    ],
  );
  assert.strictEqual(row?.outputTokens, 150);
});
