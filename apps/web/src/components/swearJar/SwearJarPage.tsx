import type { SwearJarInput, SwearJarModel } from "@t3tools/contracts";
import { formatCount, formatDayShort, formatTokens, makeWindow } from "@t3tools/shared/usageFormat";
import { Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";

import { isElectron } from "../../env";
import { useEscapeToGoBack } from "../../hooks/useNavigateBack";
import { useSwearJarEnabled } from "../../hooks/useSettings";
import { useSwearJar } from "../../state/swearJar";
import { Badge } from "../ui/badge";
import { ScrollArea } from "../ui/scroll-area";
import { SidebarInset } from "../ui/sidebar";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { WorkspaceBreadcrumb, WorkspaceBreadcrumbItem } from "../WorkspaceBreadcrumb";
import { WorkspacePageContainer } from "../WorkspacePageContainer";
import { WorkspacePageHeader } from "../WorkspacePageHeader";
import {
  MIN_RANKED_MESSAGES,
  mergeSwearJars,
  rankSwearJar,
  type SwearJarRow,
} from "./swearJarRanking";

const WINDOW_OPTIONS = [7, 30, 90] as const;
type WindowDays = (typeof WINDOW_OPTIONS)[number];

const CURSED_BAR = "bg-[#f4846c]";
const FRUSTRATED_BAR = "bg-[#6ea8fe]";

export function SwearJarPage() {
  useEscapeToGoBack();
  const enabled = useSwearJarEnabled();
  const [windowDays, setWindowDays] = useState<WindowDays>(30);
  const input = useMemo((): SwearJarInput => {
    const { sinceDay, untilDay, timeZone } = makeWindow(windowDays);
    return { sinceDay, untilDay, timeZone };
  }, [windowDays]);

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none isolate">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background text-foreground">
        <WorkspacePageHeader electron={isElectron} className="h-auto">
          <div className="flex w-full min-w-0 items-center gap-3 py-2">
            <WorkspaceBreadcrumb ariaLabel="Swear jar breadcrumb" className="min-w-0">
              <WorkspaceBreadcrumbItem current>
                <h1>Swear Jar</h1>
              </WorkspaceBreadcrumbItem>
            </WorkspaceBreadcrumb>
            <Badge variant="secondary" size="sm">
              Just for fun
            </Badge>
            {enabled ? (
              <ToggleGroup
                aria-label="Swear jar period"
                variant="segmented"
                className="ms-auto"
                value={[String(windowDays)]}
                onValueChange={(next) => {
                  const days = WINDOW_OPTIONS.find((option) => String(option) === next[0]);
                  if (days !== undefined) setWindowDays(days);
                }}
              >
                {WINDOW_OPTIONS.map((days) => (
                  <Toggle key={days} value={String(days)}>
                    {days} days
                  </Toggle>
                ))}
              </ToggleGroup>
            ) : null}
          </div>
        </WorkspacePageHeader>

        <ScrollArea className="min-h-0 flex-1">
          <WorkspacePageContainer width="wide">
            {enabled ? (
              <SwearJarContent input={input} />
            ) : (
              <p className="text-sm text-muted-foreground">
                The swear jar is off. Turn it on in{" "}
                <Link to="/settings/general" className="text-foreground underline">
                  Settings → General → Legacy features
                </Link>
                .
              </p>
            )}
          </WorkspacePageContainer>
        </ScrollArea>
      </div>
    </SidebarInset>
  );
}

function SwearJarContent({ input }: { readonly input: SwearJarInput }) {
  const environments = useSwearJar(input);
  const { ranked, unranked } = useMemo(
    () => rankSwearJar(mergeSwearJars(environments.map((environment) => environment.models ?? []))),
    [environments],
  );
  const stillCounting = environments.some(
    (environment) => environment.models === null && !environment.failed,
  );
  const failed = environments.filter((environment) => environment.failed);
  const maxRate = ranked[0]?.rate ?? 0;

  return (
    <div className="flex flex-col gap-4">
      <p className="max-w-2xl text-sm text-muted-foreground">
        A deeply unscientific ranking of which models make you lose it. T3 Code greps your own
        messages for cursing and grumbling, then divides by each model's output tokens. It is a dumb
        stat. Please do not pick a model with it.
      </p>

      <section className="rounded-xl bg-neutral-950 p-5 font-mono text-sm text-neutral-100 shadow-sm sm:p-6">
        <h2 className="text-base font-semibold">Ranking per output token</h2>
        <p className="mt-1 text-xs text-neutral-400">
          Models with {MIN_RANKED_MESSAGES}+ messages from {formatDayShort(input.sinceDay)} to{" "}
          {formatDayShort(input.untilDay)}. Frustrated messages per 10M output tokens.
        </p>
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-neutral-300">
          <LegendSwatch className={CURSED_BAR} label="cursed at or insulted" />
          <LegendSwatch className={FRUSTRATED_BAR} label="frustrated, no curse" />
        </div>

        <div className="mt-5 grid grid-cols-[2.5ch_minmax(7rem,12rem)_minmax(4rem,1fr)_6ch] items-center gap-x-3 gap-y-1.5 md:grid-cols-[2.5ch_minmax(7rem,12rem)_minmax(4rem,1fr)_6ch_minmax(0,17rem)]">
          {ranked.map((row, index) => (
            <RankedRow
              key={`${row.provider ?? ""}:${row.model}`}
              row={row}
              rank={index + 1}
              max={maxRate}
            />
          ))}
        </div>

        {ranked.length === 0 ? (
          <p className="py-4 text-neutral-400">
            {stillCounting
              ? "Counting swear words…"
              : unranked.length === 0
                ? "The jar is empty. Either the agents are behaving or you are a saint."
                : `Nothing has ${MIN_RANKED_MESSAGES}+ messages and known output tokens yet. Keep yelling.`}
          </p>
        ) : null}

        {unranked.length > 0 ? (
          <div className="mt-6 border-t border-neutral-800 pt-4">
            <h3 className="text-xs text-neutral-400">Not enough evidence yet</h3>
            <ul className="mt-2 flex flex-col gap-1 text-xs text-neutral-400">
              {unranked.map((model) => (
                <li key={`${model.provider ?? ""}:${model.model}`} className="flex gap-3">
                  <span className="min-w-0 truncate text-neutral-200">{model.model}</span>
                  <span className="shrink-0">{describeCounts(model)}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      {failed.length > 0 ? (
        <p className="text-xs text-muted-foreground">
          {failed.map((environment) => environment.label).join(", ")} could not open the jar. Update
          that server to include it.
        </p>
      ) : null}
    </div>
  );
}

function LegendSwatch({
  className,
  label,
}: {
  readonly className: string;
  readonly label: string;
}) {
  return (
    <span className="flex items-center gap-1.5">
      <span aria-hidden className={`size-2.5 ${className}`} />
      {label}
    </span>
  );
}

function RankedRow({
  row,
  rank,
  max,
}: {
  readonly row: SwearJarRow;
  readonly rank: number;
  readonly max: number;
}) {
  const angry = row.cursed + row.frustrated;
  return (
    <>
      <span className="text-right text-neutral-500 tabular-nums">{rank}</span>
      <span className="truncate">{row.model}</span>
      <span
        className="flex h-4"
        role="img"
        aria-label={`${row.cursed} cursed, ${row.frustrated} frustrated`}
      >
        <span
          className="flex h-full"
          style={{ width: `${max === 0 ? 0 : (row.rate / max) * 100}%` }}
        >
          <span className={CURSED_BAR} style={{ flexGrow: row.cursed }} />
          <span className={FRUSTRATED_BAR} style={{ flexGrow: angry === 0 ? 1 : row.frustrated }} />
        </span>
      </span>
      <span className="text-right tabular-nums">{row.rate.toFixed(1)}</span>
      <span className="hidden truncate text-neutral-400 tabular-nums md:block">
        {describeCounts(row)}
      </span>
    </>
  );
}

function describeCounts(model: SwearJarModel): string {
  const tokens = model.outputTokens > 0 ? `, ${formatTokens(model.outputTokens)} tok` : "";
  return `${model.cursed}+${model.frustrated} of ${formatCount(model.messages)} msgs${tokens}`;
}
