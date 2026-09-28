import type { ModelTotals } from "@t3tools/shared/usageMerge";
import { describe, expect, it } from "vite-plus/test";

import { selectFrustrationRanking, sortModelsByTokens } from "./usageBreakdown";

const model = (name: string, totalTokens: number, costUsd: number): ModelTotals => ({
  model: name,
  provider: "codex",
  costUsd,
  totalTokens,
  records: 1,
  unpricedRecords: 0,
  costShare: 0,
});

describe("sortModelsByTokens", () => {
  it("sorts by tokens, breaks ties by cost, and leaves the input alone", () => {
    const models = [
      model("lower-cost", 100, 1),
      model("more-tokens", 200, 2),
      model("higher-cost", 100, 3),
    ];

    expect(sortModelsByTokens(models).map((item) => item.model)).toEqual([
      "more-tokens",
      "higher-cost",
      "lower-cost",
    ]);
    expect(models.map((item) => item.model)).toEqual(["lower-cost", "more-tokens", "higher-cost"]);
  });
});

describe("selectFrustrationRanking", () => {
  const ranked_model = (name: string): ModelTotals => ({
    model: name,
    provider: "codex",
    costUsd: 1,
    totalTokens: 10_000_000,
    records: 500,
    unpricedRecords: 0,
    costShare: 0,
  });

  it("joins frustration counts onto usage models and ranks the result", () => {
    const ranked = selectFrustrationRanking(
      [ranked_model("steady"), ranked_model("rage")],
      new Map([
        ["steady", { cursedMessages: 0, frustratedMessages: 1 }],
        ["rage", { cursedMessages: 10, frustratedMessages: 10 }],
      ]),
    );

    expect(ranked.map((row) => row.model)).toEqual(["rage", "steady"]);
    expect(ranked[0]).toMatchObject({ rank: 1, frustratedRate: 20 });
  });

  it("stays hidden while no environment reports frustration counts", () => {
    expect(selectFrustrationRanking([ranked_model("steady")])).toEqual([]);
  });
});
