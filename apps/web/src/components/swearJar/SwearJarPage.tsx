import type { SwearJarInput, SwearJarModel } from "@t3tools/contracts";
import {
  formatCount,
  formatDayShort,
  formatPercent,
  formatTokens,
  makeWindow,
} from "@t3tools/shared/usageFormat";
import { Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";

import { isElectron } from "../../env";
import { useEscapeToGoBack } from "../../hooks/useNavigateBack";
import { useSwearJarEnabled } from "../../hooks/useSettings";
import { cn } from "../../lib/utils";
import { useSwearJar } from "../../state/swearJar";
import { ScrollArea } from "../ui/scroll-area";
import { SidebarInset } from "../ui/sidebar";
import { Skeleton } from "../ui/skeleton";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { PROVIDER_PRESENTATION } from "../usage/usageProviders";
import { WorkspaceBreadcrumb, WorkspaceBreadcrumbItem } from "../WorkspaceBreadcrumb";
import { WorkspacePageContainer } from "../WorkspacePageContainer";
import { WorkspacePageHeader } from "../WorkspacePageHeader";
import { SwearJarTimeChart } from "./SwearJarTimeChart";
import {
  MIN_RANKED_MESSAGES,
  annoyanceSeries,
  mergeSwearJars,
  rankSwearJar,
  type SwearJarRow,
} from "./swearJarRanking";

const WINDOW_OPTIONS = [7, 30, 90] as const;
type WindowDays = (typeof WINDOW_OPTIONS)[number];

const CURSED_COLOR = "bg-destructive";
const FRUSTRATED_COLOR = "bg-info";

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
            {enabled ? (
              <>
                <span className="hidden min-w-0 truncate text-xs text-muted-foreground 2xl:block">
                  {formatDayShort(input.sinceDay)} to {formatDayShort(input.untilDay)}
                </span>
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
              </>
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
                  Settings → General → Experimental
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
  const models = useMemo(
    () => mergeSwearJars(environments.map((environment) => environment.models ?? [])),
    [environments],
  );
  const { ranked, unranked } = useMemo(() => rankSwearJar(models), [models]);
  const series = useMemo(
    () => annoyanceSeries(models, input.sinceDay, input.untilDay),
    [input.sinceDay, input.untilDay, models],
  );
  const stillCounting = environments.some(
    (environment) => environment.models === null && !environment.failed,
  );
  const failed = environments.filter((environment) => environment.failed);

  if (stillCounting && models.length === 0) return <SwearJarSkeleton />;

  const totals = models.reduce(
    (sum, model) => ({
      messages: sum.messages + model.messages,
      cursed: sum.cursed + model.cursed,
      frustrated: sum.frustrated + model.frustrated,
    }),
    { messages: 0, cursed: 0, frustrated: 0 },
  );
  const angry = totals.cursed + totals.frustrated;
  const maxRate = ranked[0]?.rate ?? 0;

  return (
    <>
      <section className="grid gap-6 lg:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-5">
          <div className="flex flex-col gap-1">
            <span className="text-4xl font-semibold text-foreground tabular-nums">
              {formatCount(angry)}
            </span>
            <span className="text-xs text-muted-foreground">
              frustrated messages ·{" "}
              {formatPercent(totals.messages === 0 ? 0 : angry / totals.messages)} of{" "}
              {formatCount(totals.messages)}
            </span>
          </div>
          <LegendRow
            color={CURSED_COLOR}
            label="Cursed at or insulted the model"
            count={totals.cursed}
          />
          <LegendRow
            color={FRUSTRATED_COLOR}
            label="Frustrated, no curse"
            count={totals.frustrated}
          />
        </div>

        <div className="flex min-w-0 flex-col gap-3">
          <div className="flex flex-col gap-0.5">
            <h2 className="text-sm font-medium text-foreground">Ranking per output token</h2>
            <p className="text-xs text-muted-foreground">
              Models with {MIN_RANKED_MESSAGES}+ messages. Sorted by frustrated messages per 10M
              output tokens.
            </p>
          </div>
          {ranked.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {unranked.length === 0
                ? "The jar is empty. Either the agents are behaving or you are a saint."
                : `Nothing has ${MIN_RANKED_MESSAGES}+ messages yet. Keep yelling.`}
            </p>
          ) : (
            <ol className="flex flex-col">
              {ranked.map((row, index) => (
                <RankedRow
                  key={`${row.provider ?? ""}:${row.model}`}
                  row={row}
                  rank={index + 1}
                  max={maxRate}
                />
              ))}
            </ol>
          )}
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <div className="flex flex-col gap-0.5">
          <h2 className="text-sm font-medium text-foreground">Annoyance over time</h2>
          <p className="text-xs text-muted-foreground">
            Annoyed messages per day. Red is cursed at or insulted. Blue, stacked above it, is
            frustrated with no curse. The numbers on the left count those messages.
          </p>
        </div>
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-medium text-foreground">All models</h3>
          <SwearJarTimeChart series={series} label="Annoyed messages per day, all models" />
        </div>
        {ranked.length > 0 ? (
          <div className="grid gap-4 sm:grid-cols-2">
            {ranked.map((row) => (
              <div
                key={`${row.provider ?? ""}:${row.model}`}
                className="flex flex-col gap-2 rounded-lg border border-border p-3"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <h3 className="min-w-0 text-sm font-medium text-foreground">
                    <ModelLabel model={row} />
                  </h3>
                  <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                    {formatCount(row.cursed + row.frustrated)} annoyed
                  </span>
                </div>
                <SwearJarTimeChart
                  series={annoyanceSeries([row], input.sinceDay, input.untilDay)}
                  label={`Annoyed messages per day for ${row.model}`}
                />
              </div>
            ))}
          </div>
        ) : null}
      </section>

      {unranked.length > 0 ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-medium text-foreground">Not enough evidence yet</h2>
          <table className="w-full table-fixed text-sm">
            <colgroup>
              <col className="w-2/5" />
              <col className="w-1/5" />
              <col className="w-1/5" />
              <col className="w-1/5" />
            </colgroup>
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th className="py-2 font-normal">Model</th>
                <th className="py-2 text-right font-normal">Cursed</th>
                <th className="py-2 text-right font-normal">Frustrated</th>
                <th className="py-2 text-right font-normal">Messages</th>
              </tr>
            </thead>
            <tbody>
              {unranked.map((model) => (
                <tr
                  key={`${model.provider ?? ""}:${model.model}`}
                  className="border-b border-border/50 transition-colors hover:bg-muted/50"
                >
                  <td className="py-2 text-foreground">
                    <ModelLabel model={model} />
                  </td>
                  <td className="py-2 text-right text-muted-foreground tabular-nums">
                    {formatCount(model.cursed)}
                  </td>
                  <td className="py-2 text-right text-muted-foreground tabular-nums">
                    {formatCount(model.frustrated)}
                  </td>
                  <td className="py-2 text-right text-muted-foreground tabular-nums">
                    {formatCount(model.messages)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}

      {failed.length > 0 ? (
        <p className="text-xs text-muted-foreground">
          {failed.map((environment) => environment.label).join(", ")} could not open the jar. Update
          that server to include it.
        </p>
      ) : null}
    </>
  );
}

function LegendRow({
  color,
  label,
  count,
}: {
  readonly color: string;
  readonly label: string;
  readonly count: number;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className="flex min-w-0 items-center gap-2 text-sm text-foreground">
        <span aria-hidden className={cn("size-2 shrink-0 rounded-full", color)} />
        <span className="truncate">{label}</span>
      </span>
      <span className="shrink-0 text-sm font-medium text-foreground tabular-nums">
        {formatCount(count)}
      </span>
    </div>
  );
}

function ModelLabel({ model }: { readonly model: SwearJarModel }) {
  const Mark = model.provider ? PROVIDER_PRESENTATION[model.provider].mark : null;
  return (
    <span className="flex min-w-0 items-center gap-2">
      {Mark ? <Mark className="size-3.5 shrink-0" aria-hidden /> : null}
      <span className="truncate">{model.model}</span>
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
  const width = max === 0 ? 0 : (row.rate / max) * 100;
  return (
    <li className="grid grid-cols-[1.5rem_minmax(8rem,14rem)_minmax(0,1fr)_3.5rem] items-center gap-x-3 border-b border-border/50 py-2 text-sm">
      <span className="text-right text-xs text-muted-foreground tabular-nums">{rank}</span>
      <ModelLabel model={row} />
      <Tooltip>
        <TooltipTrigger
          render={
            <span
              className="flex h-2.5 gap-0.5"
              style={{ width: `${width}%` }}
              role="img"
              aria-label={`${row.cursed} cursed, ${row.frustrated} frustrated`}
            />
          }
        >
          {row.cursed > 0 ? (
            <span className={cn("rounded-full", CURSED_COLOR)} style={{ flexGrow: row.cursed }} />
          ) : null}
          {row.frustrated > 0 ? (
            <span
              className={cn("rounded-full", FRUSTRATED_COLOR)}
              style={{ flexGrow: row.frustrated }}
            />
          ) : null}
        </TooltipTrigger>
        <TooltipPopup>
          {formatCount(row.cursed)} cursed · {formatCount(row.frustrated)} frustrated ·{" "}
          {formatCount(row.messages)} messages · {formatTokens(row.outputTokens)} output tokens
        </TooltipPopup>
      </Tooltip>
      <span className="text-right font-medium text-foreground tabular-nums">
        {row.rate.toFixed(1)}
      </span>
    </li>
  );
}

function SwearJarSkeleton() {
  return (
    <section className="grid gap-6 lg:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-1">
          <Skeleton className="h-10 w-24" />
          <Skeleton className="h-4 w-40" />
        </div>
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-full" />
      </div>
      <div className="flex flex-col gap-3">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-56" />
      </div>
    </section>
  );
}
