import { describe, expect, it } from "vite-plus/test";

import {
  classifyUserMessage,
  formatFrustrationRate,
  FRUSTRATION_MIN_MESSAGES,
  rankFrustrationPerOutputToken,
  tallyFrustration,
} from "./frustration.ts";

describe("classifyUserMessage", () => {
  it("detects devrage-style swears case-insensitively", () => {
    expect(classifyUserMessage("this is fucking broken")).toBe("curse");
    expect(classifyUserMessage("FUCK")).toBe("curse");
    expect(classifyUserMessage("wtf was that")).toBe("curse");
    expect(classifyUserMessage("this shit is wrong")).toBe("curse");
    expect(classifyUserMessage("dammit")).toBe("curse");
    expect(classifyUserMessage("what the hell")).toBe("curse");
    expect(classifyUserMessage("you dumbass")).toBe("curse");
  });

  it("does not match profanity inside ordinary words", () => {
    expect(classifyUserMessage("assign the class to pass the shell")).toBe("ok");
    expect(classifyUserMessage("hello, please assess the mass")).toBe("ok");
    expect(classifyUserMessage("Scunthorpe is a town")).toBe("ok");
  });

  it("detects frustration without cursing", () => {
    expect(classifyUserMessage("what are you doing?")).toBe("frustrated");
    expect(classifyUserMessage("you didn't fix anything")).toBe("frustrated");
    expect(classifyUserMessage("that's wrong")).toBe("frustrated");
    expect(classifyUserMessage("stop doing that")).toBe("frustrated");
    expect(classifyUserMessage("you are hallucinating APIs")).toBe("frustrated");
    expect(classifyUserMessage("that's not what i asked")).toBe("frustrated");
  });

  it("leaves ordinary instructions alone", () => {
    expect(classifyUserMessage("stop the dev server")).toBe("ok");
    expect(classifyUserMessage("please try again")).toBe("ok");
    expect(classifyUserMessage("you don't need to apologize")).toBe("ok");
    expect(classifyUserMessage("")).toBe("ok");
  });

  it("counts a message with both as a curse exactly once", () => {
    expect(classifyUserMessage("what the fuck are you doing")).toBe("curse");
    expect(tallyFrustration(["what the fuck are you doing", "thanks"])).toEqual({
      cursed: 1,
      frustrated: 0,
    });
  });
});

describe("rankFrustrationPerOutputToken", () => {
  it("sorts by frustrated messages per 10M output tokens", () => {
    const ranked = rankFrustrationPerOutputToken([
      {
        model: "steady",
        messages: 500,
        outputTokens: 10_000_000,
        cursedMessages: 1,
        frustratedMessages: 1,
      },
      {
        model: "rage",
        messages: 500,
        outputTokens: 10_000_000,
        cursedMessages: 10,
        frustratedMessages: 20,
      },
    ]);
    expect(ranked.map((row) => row.model)).toEqual(["rage", "steady"]);
    expect(ranked[0]).toMatchObject({ rank: 1, frustratedRate: 30 });
    expect(ranked[1]).toMatchObject({ rank: 2, frustratedRate: 2 });
  });

  it("splits cursed and frustration-only segments of the same rate", () => {
    const [row] = rankFrustrationPerOutputToken([
      {
        model: "mixed",
        messages: 200,
        outputTokens: 20_000_000,
        cursedMessages: 10,
        frustratedMessages: 10,
      },
    ]);
    expect(row?.frustratedRate).toBe(10);
    expect(row?.cursedRate).toBe(5);
    expect(row?.frustratedOnlyRate).toBe(5);
  });

  it("drops models below the message minimum or without signal", () => {
    const ranked = rankFrustrationPerOutputToken([
      {
        model: "too-few",
        messages: FRUSTRATION_MIN_MESSAGES - 1,
        outputTokens: 10_000_000,
        cursedMessages: 50,
        frustratedMessages: 50,
      },
      {
        model: "no-tokens",
        messages: 500,
        outputTokens: 0,
        cursedMessages: 5,
        frustratedMessages: 0,
      },
      {
        model: "calm",
        messages: 500,
        outputTokens: 10_000_000,
        cursedMessages: 0,
        frustratedMessages: 0,
      },
      {
        model: "kept",
        messages: FRUSTRATION_MIN_MESSAGES,
        outputTokens: 10_000_000,
        cursedMessages: 0,
        frustratedMessages: 1,
      },
    ]);
    expect(ranked.map((row) => row.model)).toEqual(["kept"]);
  });

  it("breaks rate ties deterministically", () => {
    const ranked = rankFrustrationPerOutputToken([
      {
        model: "b-model",
        messages: 100,
        outputTokens: 10_000_000,
        cursedMessages: 2,
        frustratedMessages: 0,
      },
      {
        model: "a-model",
        messages: 100,
        outputTokens: 10_000_000,
        cursedMessages: 2,
        frustratedMessages: 0,
      },
    ]);
    expect(ranked.map((row) => row.model)).toEqual(["a-model", "b-model"]);
    expect(ranked.map((row) => row.rank)).toEqual([1, 2]);
  });
});

describe("formatFrustrationRate", () => {
  it("renders one decimal place like the overlay", () => {
    expect(formatFrustrationRate(29.47)).toBe("29.5");
    expect(formatFrustrationRate(8)).toBe("8.0");
  });
});
