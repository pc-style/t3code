import { describe, expect, it } from "vite-plus/test";

import { MIN_RANKED_MESSAGES, mergeSwearJars, rankSwearJar } from "./swearJarRanking";

describe("rankSwearJar", () => {
  it("ranks by frustrated messages per 10M output tokens, not raw counts", () => {
    const { ranked, unranked } = rankSwearJar(
      mergeSwearJars([
        [
          {
            provider: "codex",
            model: "gpt",
            messages: 100,
            cursed: 10,
            frustrated: 10,
            outputTokens: 10_000_000,
          },
          {
            provider: "claude",
            model: "opus",
            messages: 140,
            cursed: 2,
            frustrated: 3,
            outputTokens: 1_000_000,
          },
        ],
        [
          {
            provider: "codex",
            model: "gpt",
            messages: 20,
            cursed: 0,
            frustrated: 0,
            outputTokens: 10_000_000,
          },
        ],
      ]),
    );

    expect(ranked.map((row) => [row.model, row.rate])).toEqual([
      ["opus", 50],
      ["gpt", 10],
    ]);
    expect(unranked).toEqual([]);
  });

  it("keeps thin evidence out of the ranking", () => {
    const { ranked, unranked } = rankSwearJar([
      {
        model: "tiny",
        messages: MIN_RANKED_MESSAGES - 1,
        cursed: 5,
        frustrated: 5,
        outputTokens: 1_000,
      },
      { model: "untokened", messages: 200, cursed: 9, frustrated: 1, outputTokens: 0 },
    ]);

    expect(ranked).toEqual([]);
    expect(unranked.map((model) => model.model)).toEqual(["untokened", "tiny"]);
  });
});
