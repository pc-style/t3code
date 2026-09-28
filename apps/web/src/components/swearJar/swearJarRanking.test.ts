import type { SwearJarDay } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  MIN_RANKED_MESSAGES,
  annoyanceSeries,
  mergeSwearJars,
  rankSwearJar,
} from "./swearJarRanking";

const day = (day: string, cursed: number, frustrated: number): SwearJarDay =>
  ({ day, cursed, frustrated }) as SwearJarDay;

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
            days: [day("2026-09-01", 1, 0)],
          },
          {
            provider: "claude",
            model: "opus",
            messages: 140,
            cursed: 2,
            frustrated: 3,
            outputTokens: 1_000_000,
            days: [],
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
            days: [day("2026-09-01", 2, 1)],
          },
        ],
      ]),
    );

    expect(ranked.map((row) => [row.model, row.rate])).toEqual([
      ["opus", 50],
      ["gpt", 10],
    ]);
    expect(ranked.find((row) => row.model === "gpt")?.days).toEqual([
      { day: "2026-09-01", cursed: 3, frustrated: 1 },
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
        days: [],
      },
      { model: "untokened", messages: 200, cursed: 9, frustrated: 1, outputTokens: 0, days: [] },
    ]);

    expect(ranked).toEqual([]);
    expect(unranked.map((model) => model.model)).toEqual(["untokened", "tiny"]);
  });
});

describe("annoyanceSeries", () => {
  it("fills quiet days so the chart keeps the whole window", () => {
    expect(
      annoyanceSeries(
        [{ days: [day("2026-09-02", 1, 0)] }, { days: [day("2026-09-02", 0, 2)] }],
        "2026-09-01",
        "2026-09-03",
      ),
    ).toEqual([
      { day: "2026-09-01", cursed: 0, frustrated: 0 },
      { day: "2026-09-02", cursed: 1, frustrated: 2 },
      { day: "2026-09-03", cursed: 0, frustrated: 0 },
    ]);
  });
});
