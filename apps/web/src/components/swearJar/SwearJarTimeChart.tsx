import { formatCount, formatDayShort } from "@t3tools/shared/usageFormat";
import { useState } from "react";

import { cn } from "../../lib/utils";
import { niceScale } from "../usage/UsageProviderChart";
import type { AnnoyanceDay } from "./swearJarRanking";

const PLOT_HEIGHT = 112;

/** One column per day. Empty days stay empty, so a burst reads as a burst. */
export function SwearJarTimeChart({
  series,
  label,
}: {
  readonly series: readonly AnnoyanceDay[];
  readonly label: string;
}) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const peak = series.reduce((max, day) => Math.max(max, day.cursed + day.frustrated), 0);
  const { max, ticks } = niceScale(peak, 3);
  const hovered = hoverIndex === null ? undefined : series[hoverIndex];
  const tickTop = (tick: number) =>
    max === 0 ? PLOT_HEIGHT : PLOT_HEIGHT - (tick / max) * PLOT_HEIGHT;

  return (
    <div className="flex flex-col gap-1">
      <div className="flex gap-2">
        <div className="relative w-8 shrink-0" style={{ height: PLOT_HEIGHT }}>
          {ticks.map((tick) => (
            <span
              key={tick}
              className="absolute right-0 -translate-y-1/2 text-3xs text-muted-foreground tabular-nums"
              style={{ top: tickTop(tick) }}
            >
              {formatCount(tick)}
            </span>
          ))}
        </div>
        <div
          className="relative min-w-0 flex-1"
          style={{ height: PLOT_HEIGHT }}
          onMouseLeave={() => setHoverIndex(null)}
        >
          {ticks.map((tick) => (
            <div
              key={tick}
              className="pointer-events-none absolute inset-x-0 border-t border-border"
              style={{ top: tickTop(tick) }}
            />
          ))}
          <div className="absolute inset-0 flex items-end gap-0.5" role="img" aria-label={label}>
            {series.map((day, index) => {
              const scale = max === 0 ? 0 : PLOT_HEIGHT / max;
              return (
                <div
                  key={day.day}
                  className={cn(
                    "flex h-full min-w-0 flex-1 flex-col justify-end",
                    hoverIndex === index && "bg-muted/40",
                  )}
                  onMouseEnter={() => setHoverIndex(index)}
                >
                  {day.frustrated > 0 ? (
                    <div
                      className="w-full rounded-t-sm bg-info"
                      style={{ height: day.frustrated * scale }}
                    />
                  ) : null}
                  {day.cursed > 0 ? (
                    <div
                      className={cn(
                        "w-full bg-destructive",
                        day.frustrated === 0 && "rounded-t-sm",
                      )}
                      style={{ height: day.cursed * scale }}
                    />
                  ) : null}
                </div>
              );
            })}
          </div>
          {hovered === undefined ? null : (
            <div className="surface-glass pointer-events-none absolute top-1 right-1 z-10 rounded-xl border border-border/50 px-2.5 py-2 text-xs shadow-lg">
              <div className="mb-1 text-muted-foreground">{formatDayShort(hovered.day)}</div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">Cursed</span>
                <span className="text-foreground tabular-nums">{formatCount(hovered.cursed)}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">Frustrated</span>
                <span className="text-foreground tabular-nums">
                  {formatCount(hovered.frustrated)}
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
      {series.length === 0 ? null : (
        <div className="flex justify-between pl-10 text-3xs text-muted-foreground uppercase">
          <span>{formatDayShort(series[0]?.day ?? "")}</span>
          <span>{formatDayShort(series[series.length - 1]?.day ?? "")}</span>
        </div>
      )}
    </div>
  );
}
