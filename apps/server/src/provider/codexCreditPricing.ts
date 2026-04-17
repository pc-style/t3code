import type { CodexTurnUsageSummary, CodexUsagePricingMode } from "@t3tools/contracts";

interface CodexCreditRateCardEntry {
  readonly inputCreditsPerMillion: number;
  readonly cachedInputCreditsPerMillion: number;
  readonly outputCreditsPerMillion: number;
}

interface TokenUsageCounts {
  readonly inputTokens: number;
  readonly cachedInputTokens: number;
  readonly outputTokens: number;
  readonly reasoningOutputTokens: number;
}

interface CalculateCodexCreditsInput extends TokenUsageCounts {
  readonly model: string;
  readonly pricingMode: CodexUsagePricingMode;
  readonly fastMode: boolean;
}

export const CODEX_TOKEN_RATE_CARD_EFFECTIVE_DATE = "2026-04-02";

const CODEX_TOKEN_RATE_CARD: Record<string, CodexCreditRateCardEntry> = {
  "gpt-5.4": {
    inputCreditsPerMillion: 62.5,
    cachedInputCreditsPerMillion: 6.25,
    outputCreditsPerMillion: 375,
  },
  "gpt-5.4-mini": {
    inputCreditsPerMillion: 18.75,
    cachedInputCreditsPerMillion: 1.875,
    outputCreditsPerMillion: 113,
  },
  "gpt-5.3-codex": {
    inputCreditsPerMillion: 43.75,
    cachedInputCreditsPerMillion: 4.375,
    outputCreditsPerMillion: 350,
  },
  "gpt-5.2": {
    inputCreditsPerMillion: 43.75,
    cachedInputCreditsPerMillion: 4.375,
    outputCreditsPerMillion: 350,
  },
  "gpt-5.2-codex": {
    inputCreditsPerMillion: 43.75,
    cachedInputCreditsPerMillion: 4.375,
    outputCreditsPerMillion: 350,
  },
} as const;

function normalizeModel(model: string): string | null {
  const normalized = model.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

function creditsForTokens(tokens: number, ratePerMillion: number): number {
  return (tokens / 1_000_000) * ratePerMillion;
}

export function calculateCodexCredits(input: CalculateCodexCreditsInput): number | null {
  if (input.pricingMode !== "token-based") {
    return null;
  }

  const model = normalizeModel(input.model);
  if (!model) {
    return null;
  }

  const rateCard = CODEX_TOKEN_RATE_CARD[model];
  if (!rateCard) {
    return null;
  }

  const baseCredits =
    creditsForTokens(input.inputTokens, rateCard.inputCreditsPerMillion) +
    creditsForTokens(input.cachedInputTokens, rateCard.cachedInputCreditsPerMillion) +
    creditsForTokens(
      input.outputTokens + input.reasoningOutputTokens,
      rateCard.outputCreditsPerMillion,
    );

  return input.fastMode ? baseCredits * 2 : baseCredits;
}

export function sumCodexTurnUsageCredits(
  summaries: ReadonlyArray<Pick<CodexTurnUsageSummary, "creditsUsed">>,
): number {
  return summaries.reduce((total, summary) => total + summary.creditsUsed, 0);
}
