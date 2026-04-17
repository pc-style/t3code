import { Effect, Schema } from "effect";

import { IsoDateTime, NonNegativeInt, TurnId, TrimmedNonEmptyString } from "./baseSchemas.ts";

export const CodexUsageWindowName = Schema.Literals(["primary", "weekly"]);
export type CodexUsageWindowName = typeof CodexUsageWindowName.Type;

export const CodexUsageWindow = Schema.Struct({
  name: CodexUsageWindowName,
  label: TrimmedNonEmptyString,
  usedPercent: Schema.NullOr(Schema.Number),
  remainingPercent: Schema.NullOr(Schema.Number),
  resetAt: Schema.NullOr(IsoDateTime),
  windowSeconds: Schema.NullOr(NonNegativeInt),
});
export type CodexUsageWindow = typeof CodexUsageWindow.Type;

export const CodexCreditsSnapshot = Schema.Struct({
  available: Schema.Boolean,
  unlimited: Schema.Boolean,
  balance: Schema.NullOr(Schema.Number),
  currencyOrUnit: Schema.Literal("credits"),
});
export type CodexCreditsSnapshot = typeof CodexCreditsSnapshot.Type;

export const CodexUsagePricingMode = Schema.Literals(["token-based", "legacy", "unknown"]);
export type CodexUsagePricingMode = typeof CodexUsagePricingMode.Type;

export const CodexPlanType = Schema.Literals([
  "free",
  "go",
  "plus",
  "pro",
  "team",
  "business",
  "enterprise",
  "edu",
  "unknown",
]);
export type CodexPlanType = typeof CodexPlanType.Type;

export const CodexUsageEntitlement = Schema.Struct({
  showRateLimits: Schema.Boolean,
  showCreditsBalance: Schema.Boolean,
  showCreditCosts: Schema.Boolean,
  isBusinessUsageBased: Schema.Boolean,
  reason: Schema.NullOr(TrimmedNonEmptyString),
});
export type CodexUsageEntitlement = typeof CodexUsageEntitlement.Type;

export const CodexUsageSnapshot = Schema.Struct({
  provider: Schema.Literal("codex"),
  fetchedAt: IsoDateTime,
  source: Schema.Literals(["oauth-usage-api", "runtime-events", "unavailable"]),
  accountType: Schema.Literals(["chatgpt", "apiKey", "unknown"]),
  planType: Schema.NullOr(CodexPlanType),
  planSubtype: Schema.NullOr(TrimmedNonEmptyString),
  pricingMode: CodexUsagePricingMode,
  primaryWindow: Schema.NullOr(CodexUsageWindow),
  weeklyWindow: Schema.NullOr(CodexUsageWindow),
  credits: Schema.NullOr(CodexCreditsSnapshot),
  entitlement: CodexUsageEntitlement,
  message: Schema.NullOr(TrimmedNonEmptyString),
});
export type CodexUsageSnapshot = typeof CodexUsageSnapshot.Type;

export const CodexTurnUsageSummary = Schema.Struct({
  turnId: TurnId,
  model: TrimmedNonEmptyString,
  pricingMode: CodexUsagePricingMode,
  inputTokens: NonNegativeInt,
  cachedInputTokens: NonNegativeInt,
  outputTokens: NonNegativeInt,
  reasoningOutputTokens: NonNegativeInt,
  creditsUsed: Schema.Number,
  usdCost: Schema.NullOr(Schema.Number).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  completedAt: IsoDateTime,
});
export type CodexTurnUsageSummary = typeof CodexTurnUsageSummary.Type;
