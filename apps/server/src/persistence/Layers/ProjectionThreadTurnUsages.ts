import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";
import { Effect, Layer } from "effect";

import { toPersistenceSqlError } from "../Errors.ts";
import {
  DeleteProjectionThreadTurnUsagesInput,
  ListProjectionThreadTurnUsagesInput,
  ProjectionThreadTurnUsage,
  ProjectionThreadTurnUsageRepository,
  type ProjectionThreadTurnUsageRepositoryShape,
} from "../Services/ProjectionThreadTurnUsages.ts";

const makeProjectionThreadTurnUsageRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const upsertProjectionThreadTurnUsageRow = SqlSchema.void({
    Request: ProjectionThreadTurnUsage,
    execute: (row) =>
      sql`
        INSERT INTO projection_thread_turn_usages (
          thread_id,
          turn_id,
          model,
          pricing_mode,
          input_tokens,
          cached_input_tokens,
          output_tokens,
          reasoning_output_tokens,
          credits_used,
          usd_cost,
          completed_at
        )
        VALUES (
          ${row.threadId},
          ${row.turnId},
          ${row.model},
          ${row.pricingMode},
          ${row.inputTokens},
          ${row.cachedInputTokens},
          ${row.outputTokens},
          ${row.reasoningOutputTokens},
          ${row.creditsUsed},
          ${row.usdCost},
          ${row.completedAt}
        )
        ON CONFLICT (thread_id, turn_id)
        DO UPDATE SET
          model = excluded.model,
          pricing_mode = excluded.pricing_mode,
          input_tokens = excluded.input_tokens,
          cached_input_tokens = excluded.cached_input_tokens,
          output_tokens = excluded.output_tokens,
          reasoning_output_tokens = excluded.reasoning_output_tokens,
          credits_used = excluded.credits_used,
          usd_cost = excluded.usd_cost,
          completed_at = excluded.completed_at
      `,
  });

  const listProjectionThreadTurnUsageRows = SqlSchema.findAll({
    Request: ListProjectionThreadTurnUsagesInput,
    Result: ProjectionThreadTurnUsage,
    execute: ({ threadId }) =>
      sql`
        SELECT
          thread_id AS "threadId",
          turn_id AS "turnId",
          model,
          pricing_mode AS "pricingMode",
          input_tokens AS "inputTokens",
          cached_input_tokens AS "cachedInputTokens",
          output_tokens AS "outputTokens",
          reasoning_output_tokens AS "reasoningOutputTokens",
          credits_used AS "creditsUsed",
          usd_cost AS "usdCost",
          completed_at AS "completedAt"
        FROM projection_thread_turn_usages
        WHERE thread_id = ${threadId}
        ORDER BY completed_at ASC, turn_id ASC
      `,
  });

  const deleteProjectionThreadTurnUsageRows = SqlSchema.void({
    Request: DeleteProjectionThreadTurnUsagesInput,
    execute: ({ threadId }) =>
      sql`
        DELETE FROM projection_thread_turn_usages
        WHERE thread_id = ${threadId}
      `,
  });

  const upsert: ProjectionThreadTurnUsageRepositoryShape["upsert"] = (row) =>
    upsertProjectionThreadTurnUsageRow(row).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionThreadTurnUsageRepository.upsert:query")),
    );

  const listByThreadId: ProjectionThreadTurnUsageRepositoryShape["listByThreadId"] = (input) =>
    listProjectionThreadTurnUsageRows(input).pipe(
      Effect.mapError(
        toPersistenceSqlError("ProjectionThreadTurnUsageRepository.listByThreadId:query"),
      ),
    );

  const deleteByThreadId: ProjectionThreadTurnUsageRepositoryShape["deleteByThreadId"] = (input) =>
    deleteProjectionThreadTurnUsageRows(input).pipe(
      Effect.mapError(
        toPersistenceSqlError("ProjectionThreadTurnUsageRepository.deleteByThreadId:query"),
      ),
    );

  return {
    upsert,
    listByThreadId,
    deleteByThreadId,
  } satisfies ProjectionThreadTurnUsageRepositoryShape;
});

export const ProjectionThreadTurnUsageRepositoryLive = Layer.effect(
  ProjectionThreadTurnUsageRepository,
  makeProjectionThreadTurnUsageRepository,
);
