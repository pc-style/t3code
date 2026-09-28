/**
 * Local-only frustration signal behind the "ranking per output token" overlay.
 *
 * This module is pure and runs on-device: it classifies a user's own messages
 * as cursing, frustrated without cursing, or neither, and ranks models by
 * frustrated messages per 10M output tokens. Counts produced here must stay
 * on the device; they are prompt content and must never enter telemetry or
 * analytics payloads.
 *
 * The classifier is intentionally narrow (precision over recall). It mirrors
 * the `devrage` word lists rather than trying to read tone.
 *
 * @module frustration
 */

export const FRUSTRATION_MIN_MESSAGES = 100;

const FRUSTRATION_TOKENS_BASIS = 10_000_000;

export type FrustrationClass = "curse" | "frustrated" | "ok";

const CURSE_SOURCES = [
  String.raw`\bfuck\w*\b`,
  String.raw`\bshit\w*\b`,
  String.raw`\bdamn\w*\b|\bdammit\b`,
  String.raw`\bhell\b`,
  String.raw`\bass(?:es)?\b|\bdumbass\b|\bjackass\b`,
  String.raw`\bbitch\w*\b`,
  String.raw`\bbastard\w*\b`,
  String.raw`\bcrap\w*\b`,
  String.raw`\bwtf\b`,
];

const FRUSTRATION_SOURCES = [
  String.raw`what are you doing`,
  String.raw`what is this`,
  String.raw`what was that`,
  String.raw`you didn'?t\b`,
  String.raw`you did not\b`,
  String.raw`you never\b`,
  String.raw`you keep\b`,
  String.raw`you always\b`,
  String.raw`you'?re wrong\b`,
  String.raw`\bwrong\b`,
  String.raw`\bincorrect\b`,
  String.raw`\bbroken\b`,
  String.raw`\buseless\b`,
  String.raw`\bstupid\b`,
  String.raw`\bidiot\w*\b`,
  String.raw`\bdumb\b`,
  String.raw`hallucinat\w*`,
  String.raw`made (that|this|it) up`,
  String.raw`not what i (asked|wanted|meant|said)`,
  String.raw`i never asked`,
  String.raw`stop (doing|that|it|breaking)`,
  String.raw`why did you\b`,
];

const cursePattern = new RegExp(`(?:${CURSE_SOURCES.join("|")})`, "i");
const frustrationPattern = new RegExp(`(?:${FRUSTRATION_SOURCES.join("|")})`, "i");

/**
 * Classifies one user message. A message containing both profanity and a
 * frustration phrase counts once, as a curse, so the two overlay segments
 * always sum to the message's total frustration.
 */
export function classifyUserMessage(text: string): FrustrationClass {
  if (cursePattern.test(text)) return "curse";
  if (frustrationPattern.test(text)) return "frustrated";
  return "ok";
}

export interface FrustrationTally {
  readonly cursed: number;
  readonly frustrated: number;
}

/** Tallies one classification per message; each message contributes at most one count. */
export function tallyFrustration(messages: readonly string[]): FrustrationTally {
  let cursed = 0;
  let frustrated = 0;
  for (const message of messages) {
    const classification = classifyUserMessage(message);
    if (classification === "curse") cursed += 1;
    else if (classification === "frustrated") frustrated += 1;
  }
  return { cursed, frustrated };
}

export interface FrustrationModelInput {
  readonly model: string;
  readonly messages: number;
  readonly outputTokens: number;
  readonly cursedMessages: number;
  /** Frustrated messages without cursing; disjoint from `cursedMessages`. */
  readonly frustratedMessages: number;
}

export interface FrustratedModelRank {
  readonly rank: number;
  readonly model: string;
  readonly messages: number;
  readonly outputTokens: number;
  readonly cursedMessages: number;
  readonly frustratedMessages: number;
  /** Cursed plus frustrated-only messages per 10M output tokens. */
  readonly frustratedRate: number;
  readonly cursedRate: number;
  readonly frustratedOnlyRate: number;
}

/**
 * Ranks models the way the overlay does: models with fewer than 100 messages,
 * no output tokens, or no frustrated messages are dropped, and the rest are
 * sorted by frustrated messages per 10M output tokens, descending.
 */
export function rankFrustrationPerOutputToken(
  rows: readonly FrustrationModelInput[],
): readonly FrustratedModelRank[] {
  const ranked = rows.flatMap((row) => {
    const total = row.cursedMessages + row.frustratedMessages;
    if (row.messages < FRUSTRATION_MIN_MESSAGES || row.outputTokens <= 0 || total <= 0) return [];
    const scale = FRUSTRATION_TOKENS_BASIS / row.outputTokens;
    return [
      {
        model: row.model,
        messages: row.messages,
        outputTokens: row.outputTokens,
        cursedMessages: row.cursedMessages,
        frustratedMessages: row.frustratedMessages,
        frustratedRate: total * scale,
        cursedRate: row.cursedMessages * scale,
        frustratedOnlyRate: row.frustratedMessages * scale,
      },
    ];
  });
  ranked.sort(
    (left, right) =>
      right.frustratedRate - left.frustratedRate ||
      right.cursedMessages - left.cursedMessages ||
      left.model.localeCompare(right.model),
  );
  return ranked.map((row, index) => ({ ...row, rank: index + 1 }));
}

/** One decimal place, matching the overlay (`29.5`). */
export function formatFrustrationRate(rate: number): string {
  return rate.toFixed(1);
}
