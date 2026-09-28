import { formatFrustrationRate, type FrustratedModelRank } from "@t3tools/shared/frustration";

/** Segment colors encode meaning (cursed vs frustrated-only), like provider colors do. */
const CURSED_SEGMENT_COLOR = "#e5484d";
const FRUSTRATED_SEGMENT_COLOR = "#3e8ef7";

/**
 * The frustration leaderboard overlay: models sorted by frustrated messages
 * per 10M output tokens, with cursed and frustration-only segments stacked.
 * Dumb by design — ranking happens in `@t3tools/shared/frustration`, so every
 * client renders the same order from the same rows.
 */
export function FrustrationRanking({ rows }: { readonly rows: readonly FrustratedModelRank[] }) {
  if (rows.length === 0) return null;
  const peak = rows.reduce((max, row) => Math.max(max, row.frustratedRate), 0);
  if (peak <= 0) return null;

  return (
    <section aria-label="Frustration ranking per output token" className="flex flex-col gap-2">
      <h2 className="text-sm font-medium text-foreground">Ranking per output token</h2>
      <p className="text-xs text-muted-foreground">
        Models with 100+ messages. Sorted by frustrated messages per 10M output tokens.
      </p>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span
            aria-hidden
            className="size-2 rounded-xs"
            style={{ backgroundColor: CURSED_SEGMENT_COLOR }}
          />
          Cursed at or insulted the model
        </span>
        <span className="flex items-center gap-1.5">
          <span
            aria-hidden
            className="size-2 rounded-xs"
            style={{ backgroundColor: FRUSTRATED_SEGMENT_COLOR }}
          />
          Frustrated, no curse
        </span>
      </div>
      <ul className="flex flex-col gap-1.5">
        {rows.map((row) => (
          <li
            key={row.model}
            className="grid grid-cols-[1.5rem_minmax(0,11rem)_minmax(0,1fr)_3rem] items-center gap-3"
          >
            <span className="text-sm text-muted-foreground tabular-nums">{row.rank}</span>
            <span className="truncate text-sm text-foreground">{row.model}</span>
            <span aria-hidden className="flex h-3 min-w-0 overflow-hidden rounded-full">
              <span
                className="h-full shrink-0"
                style={{
                  width: `${(row.cursedRate / peak) * 100}%`,
                  backgroundColor: CURSED_SEGMENT_COLOR,
                }}
              />
              <span
                className="h-full shrink-0"
                style={{
                  width: `${(row.frustratedOnlyRate / peak) * 100}%`,
                  backgroundColor: FRUSTRATED_SEGMENT_COLOR,
                }}
              />
            </span>
            <span className="text-right text-sm text-foreground tabular-nums">
              {formatFrustrationRate(row.frustratedRate)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
