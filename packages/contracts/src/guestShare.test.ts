import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import { GuestMessageAttribution } from "./composerContext.ts";
import { GuestRedeemRequest, GuestSubmitRequest } from "./guestShare.ts";

const isRedeem = Schema.is(GuestRedeemRequest);
const isSubmit = Schema.is(GuestSubmitRequest);
const isAttribution = Schema.is(GuestMessageAttribution);

describe("GuestRedeemRequest", () => {
  it("accepts a one-line name and rejects names that break the attribution line", () => {
    expect(isRedeem({ credential: "invite", name: "Maya Chen" })).toBe(true);
    for (const name of [
      "Maya\nowner",
      "Maya owner",
      "Maya owner",
      "Maya\u0007",
      "Theo\u202E (owner)",
      "Theo\u2066x",
    ]) {
      expect(isRedeem({ credential: "invite", name })).toBe(false);
    }
  });
});

describe("GuestSubmitRequest and GuestMessageAttribution", () => {
  it("accepts prompts longer than 4,000 characters", () => {
    const longPrompt = "a".repeat(20_000);
    expect(isSubmit({ shareId: "share-1", text: longPrompt })).toBe(true);
    expect(isAttribution({ guestMessageId: "guest-1", name: "Maya Chen", text: longPrompt })).toBe(
      true,
    );
  });
});
