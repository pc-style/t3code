import { formatCount, formatDayShort } from "@t3tools/shared/usageFormat";
import { useCallback, useLayoutEffect, useMemo, useRef, useState, type MouseEvent } from "react";

import { niceScale } from "../usage/UsageProviderChart";
import type { AnnoyanceDay } from "./swearJarRanking";

const VIEW_WIDTH = 960;
const VIEW_HEIGHT = 160;
const PLOT_TOP = 4;

const CURSED = "var(--destructive)";
const FRUSTRATED = "var(--info)";

export function SwearJarTimeChart({
  series,
  scalePeak,
  compact = false,
  label,
}: {
  readonly series: readonly AnnoyanceDay[];
  /** Shared ceiling, so a row of charts can be compared. Defaults to this series. */
  readonly scalePeak?: number;
  readonly compact?: boolean;
  readonly label: string;
}) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const plotRef = useRef<HTMLDivElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const hoverPositionRef = useRef<{ x: number; y: number } | null>(null);

  const { max, ticks, slot } = useMemo(() => {
    const ownPeak = series.reduce((peak, day) => Math.max(peak, day.cursed + day.frustrated), 0);
    const scaled = niceScale(scalePeak ?? ownPeak, compact ? 2 : 3);
    return {
      max: scaled.max,
      ticks: scaled.ticks,
      slot: series.length === 0 ? 0 : VIEW_WIDTH / series.length,
    };
  }, [compact, scalePeak, series]);

  const toY = (value: number) =>
    max === 0 ? VIEW_HEIGHT : VIEW_HEIGHT - (value / max) * (VIEW_HEIGHT - PLOT_TOP);

  const positionTooltip = useCallback(() => {
    const plot = plotRef.current;
    const tooltip = tooltipRef.current;
    const hoverPosition = hoverPositionRef.current;
    if (plot === null || tooltip === null || hoverPosition === null) return;
    const gap = 8;
    const width = tooltip.offsetWidth;
    const height = tooltip.offsetHeight;
    const left = Math.min(
      Math.max(
        0,
        hoverPosition.x + gap + width <= plot.clientWidth
          ? hoverPosition.x + gap
          : hoverPosition.x - gap - width,
      ),
      Math.max(0, plot.clientWidth - width),
    );
    const top = Math.min(
      Math.max(0, hoverPosition.y - height - gap),
      Math.max(0, plot.clientHeight - height),
    );
    plot.style.setProperty("--swear-tooltip-left", `${left}px`);
    plot.style.setProperty("--swear-tooltip-top", `${top}px`);
  }, []);

  useLayoutEffect(() => {
    if (hoverIndex === null) return;
    positionTooltip();
  }, [hoverIndex, positionTooltip]);

  const handleMove = (event: MouseEvent<HTMLDivElement>) => {
    const plot = plotRef.current;
    if (plot === null || series.length === 0) return;
    const bounds = plot.getBoundingClientRect();
    if (bounds.width === 0) return;
    const localX = Math.min(bounds.width, Math.max(0, event.clientX - bounds.left));
    const localY = Math.min(bounds.height, Math.max(0, event.clientY - bounds.top));
    hoverPositionRef.current = { x: localX, y: localY };
    setHoverIndex(
      Math.min(series.length - 1, Math.max(0, Math.floor((localX / bounds.width) * series.length))),
    );
    positionTooltip();
  };

  const hovered = hoverIndex === null ? undefined : series[hoverIndex];
  const barWidth = slot * 0.62;

  return (
    <div className="flex flex-col gap-1">
      <div className="flex gap-2">
        {compact ? null : (
          <div className="relative h-40 w-8 shrink-0">
            {ticks.map((tick) => (
              <span
                key={tick}
                className="absolute right-0 -translate-y-1/2 text-3xs text-muted-foreground tabular-nums"
                style={{ top: `${(toY(tick) / VIEW_HEIGHT) * 100}%` }}
              >
                {formatCount(tick)}
              </span>
            ))}
          </div>
        )}
        <div
          ref={plotRef}
          className={compact ? "relative h-16 flex-1" : "relative h-40 flex-1"}
          onMouseMove={handleMove}
          onMouseLeave={() => {
            hoverPositionRef.current = null;
            setHoverIndex(null);
          }}
        >
          <svg
            className="h-full w-full"
            viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
            preserveAspectRatio="none"
            role="img"
            aria-label={label}
          >
            {compact
              ? null
              : ticks.map((tick) => (
                  <line
                    key={tick}
                    x1={0}
                    x2={VIEW_WIDTH}
                    y1={toY(tick)}
                    y2={toY(tick)}
                    stroke="currentColor"
                    strokeWidth={1}
                    className="text-border"
                    vectorEffect="non-scaling-stroke"
                  />
                ))}
            {series.map((day, index) => {
              const cursedHeight = VIEW_HEIGHT - toY(day.cursed);
              const totalHeight = VIEW_HEIGHT - toY(day.cursed + day.frustrated);
              const x = index * slot + (slot - barWidth) / 2;
              return (
                <g key={day.day}>
                  {day.frustrated > 0 ? (
                    <rect
                      x={x}
                      y={VIEW_HEIGHT - totalHeight}
                      width={barWidth}
                      height={Math.max(0, totalHeight - cursedHeight)}
                      fill={FRUSTRATED}
                    />
                  ) : null}
                  {day.cursed > 0 ? (
                    <rect
                      x={x}
                      y={VIEW_HEIGHT - cursedHeight}
                      width={barWidth}
                      height={cursedHeight}
                      fill={CURSED}
                    />
                  ) : null}
                </g>
              );
            })}
          </svg>
          {hovered === undefined ? null : (
            <div
              ref={tooltipRef}
              className="surface-glass pointer-events-none absolute z-10 rounded-xl border border-border/50 px-2.5 py-2 text-xs shadow-lg"
              style={{
                left: "var(--swear-tooltip-left, 0px)",
                top: "var(--swear-tooltip-top, 0px)",
              }}
            >
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
      {compact || series.length === 0 ? null : (
        <div className="flex justify-between pl-10 text-3xs text-muted-foreground uppercase">
          <span>{formatDayShort(series[0]?.day ?? "")}</span>
          <span>{formatDayShort(series[Math.floor(series.length / 2)]?.day ?? "")}</span>
          <span>{formatDayShort(series[series.length - 1]?.day ?? "")}</span>
        </div>
      )}
    </div>
  );
}
