// @vitest-environment jsdom
import type { FrustratedModelRank } from "@t3tools/shared/frustration";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { FrustrationRanking } from "./FrustrationRanking";

const rows: readonly FrustratedModelRank[] = [
  {
    rank: 1,
    model: "GPT-5.5",
    messages: 500,
    outputTokens: 10_000_000,
    cursedMessages: 12,
    frustratedMessages: 17,
    frustratedRate: 29,
    cursedRate: 12,
    frustratedOnlyRate: 17,
  },
  {
    rank: 2,
    model: "GPT-6 Astra",
    messages: 400,
    outputTokens: 10_000_000,
    cursedMessages: 4,
    frustratedMessages: 16,
    frustratedRate: 20,
    cursedRate: 4,
    frustratedOnlyRate: 16,
  },
];

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function renderRows(next: readonly FrustratedModelRank[]) {
  act(() => {
    root.render(<FrustrationRanking rows={next} />);
  });
}

describe("FrustrationRanking", () => {
  it("lists models in rank order with their rates", () => {
    renderRows(rows);

    const items = [...container.querySelectorAll("li")];
    expect(items.map((item) => item.textContent)).toEqual([
      expect.stringContaining("GPT-5.5"),
      expect.stringContaining("GPT-6 Astra"),
    ]);
    expect(container.textContent).toContain("29.0");
    expect(container.textContent).toContain("20.0");
    expect(container.textContent).toContain("Ranking per output token");
  });

  it("scales bars against the top rate so the leader fills the track", () => {
    renderRows(rows);

    const bars = [...container.querySelectorAll("li > span[aria-hidden]")];
    const widths = bars.map((bar) =>
      [...bar.querySelectorAll(":scope > span")].map((segment) =>
        segment instanceof HTMLElement ? Number.parseFloat(segment.style.width) : Number.NaN,
      ),
    );
    // Leader segments sum to the full track; the runner-up is narrower.
    expect(widths[0]?.reduce((a, b) => a + b, 0)).toBeCloseTo(100, 5);
    const [leader = 0, runnerUp = 0] = widths.map((segments) =>
      segments.reduce((a, b) => a + b, 0),
    );
    expect(runnerUp).toBeLessThan(leader);
    expect(runnerUp).toBeCloseTo((20 / 29) * 100, 5);
  });

  it("renders nothing without ranked rows", () => {
    renderRows([]);
    expect(container.innerHTML).toBe("");
  });
});
