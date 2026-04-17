import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS projection_thread_turn_usages (
      thread_id TEXT NOT NULL,
      turn_id TEXT NOT NULL,
      model TEXT NOT NULL,
      pricing_mode TEXT NOT NULL,
      input_tokens INTEGER NOT NULL,
      cached_input_tokens INTEGER NOT NULL,
      output_tokens INTEGER NOT NULL,
      reasoning_output_tokens INTEGER NOT NULL,
      credits_used REAL NOT NULL,
      usd_cost REAL,
      completed_at TEXT NOT NULL,
      PRIMARY KEY (thread_id, turn_id)
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_thread_turn_usages_thread_completed
    ON projection_thread_turn_usages(thread_id, completed_at)
  `;
});
