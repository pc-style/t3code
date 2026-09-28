import { ProviderDriverKind, type UsageDay } from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import { containsSwearing, readSwearTally } from "./swearTally.ts";

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

it("recognises swearing without flagging innocent words", () => {
  assert.isTrue(containsSwearing("what the FUCK are you doing"));
  assert.isTrue(containsSwearing("this is bullshit"));
  assert.isTrue(containsSwearing("wtf, revert that"));
  assert.isFalse(containsSwearing("scrap the draft and pass the assertion"));
  assert.isFalse(containsSwearing("offset the classes"));
});

layer("readSwearTally", (it) => {
  it.effect("attributes swearing to the model each turn was sent to, within the window", () =>
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
      yield* insertUserMessage({
        id: "m1",
        threadId: "thread-a",
        text: "what the fuck are you doing",
        createdAt: "2026-09-10T12:00:00.000Z",
        modelSelection: { instanceId: "work-codex", model: "gpt-5.6" },
      });
      yield* insertUserMessage({
        id: "m2",
        threadId: "thread-a",
        text: "wtf",
        createdAt: "2026-09-11T12:00:00.000Z",
        modelSelection: { instanceId: "work-codex", model: "gpt-5.6" },
      });
      // Sent without a selection, so it ran on the thread's model.
      yield* insertUserMessage({
        id: "m3",
        threadId: "thread-a",
        text: "damn it, again?",
        createdAt: "2026-09-12T12:00:00.000Z",
      });
      yield* insertUserMessage({
        id: "m4",
        threadId: "thread-a",
        text: "scrap that approach, please",
        createdAt: "2026-09-12T13:00:00.000Z",
        modelSelection: { instanceId: "work-codex", model: "gpt-5.6" },
      });
      yield* insertUserMessage({
        id: "m5",
        threadId: "thread-a",
        text: "shit, outside the window",
        createdAt: "2026-08-01T12:00:00.000Z",
        modelSelection: { instanceId: "work-codex", model: "gpt-5.6" },
      });

      const tally = yield* readSwearTally(
        {
          sinceDay: "2026-09-01" as UsageDay,
          untilDay: "2026-09-30" as UsageDay,
          timeZone: "UTC",
        },
        { "work-codex": { driver: ProviderDriverKind.make("codex") } },
      );

      assert.deepStrictEqual(tally, [
        { provider: "codex", model: "gpt-5.6", messages: 2 },
        { provider: "claude", model: "claude-opus-5", messages: 1 },
      ]);
    }),
  );
});
