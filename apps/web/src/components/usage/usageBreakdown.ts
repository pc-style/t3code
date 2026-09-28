import {
  rankFrustrationPerOutputToken,
  type FrustratedModelRank,
} from "@t3tools/shared/frustration";
import type { ModelTotals } from "@t3tools/shared/usageMerge";

export function sortModelsByTokens(models: readonly ModelTotals[]) {
  return models.toSorted(
    (left, right) => right.totalTokens - left.totalTokens || right.costUsd - left.costUsd,
  );
}

export interface FrustrationCounts {
  readonly cursedMessages: number;
  readonly frustratedMessages: number;
}

/**
 * Builds overlay rows from merged usage models.
 *
 * Records stand in for message counts and total tokens for output tokens until
 * the merge carries per-model output tokens; frustration counts arrive with
 * the server transcript scan. With no counts every model filters out and the
 * section stays hidden.
 */
export function selectFrustrationRanking(
  models: readonly ModelTotals[],
  countsByModel: ReadonlyMap<string, FrustrationCounts> = new Map(),
): readonly FrustratedModelRank[] {
  return rankFrustrationPerOutputToken(
    models.map((model) => {
      const counts = countsByModel.get(model.model);
      return {
        model: model.model,
        messages: model.records,
        outputTokens: model.totalTokens,
        cursedMessages: counts?.cursedMessages ?? 0,
        frustratedMessages: counts?.frustratedMessages ?? 0,
      };
    }),
  );
}
