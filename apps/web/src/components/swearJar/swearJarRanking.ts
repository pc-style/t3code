import type { SwearJarDay, SwearJarModel } from "@t3tools/contracts";
import { enumerateDays } from "@t3tools/shared/usageFormat";

/** Fewer messages than this and one bad afternoon decides the ranking. */
export const MIN_RANKED_MESSAGES = 100;

const TOKENS_PER_RATE = 10_000_000;

export interface SwearJarRow extends SwearJarModel {
  /** Cursed plus frustrated messages per 10M output tokens. */
  readonly rate: number;
}

export interface SwearJarRanking {
  readonly ranked: readonly SwearJarRow[];
  /** Too few messages, or no output tokens to divide by. */
  readonly unranked: readonly SwearJarModel[];
}

function mergeDays(left: readonly SwearJarDay[], right: readonly SwearJarDay[]): SwearJarDay[] {
  const byDay = new Map<string, SwearJarDay>();
  for (const day of [...left, ...right]) {
    const previous = byDay.get(day.day);
    byDay.set(
      day.day,
      previous === undefined
        ? day
        : {
            day: day.day,
            cursed: previous.cursed + day.cursed,
            frustrated: previous.frustrated + day.frustrated,
          },
    );
  }
  return [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day));
}

/** Environments read disjoint thread histories, so their counts simply add up. */
export function mergeSwearJars(jars: readonly (readonly SwearJarModel[])[]): SwearJarModel[] {
  const merged = new Map<string, SwearJarModel>();
  for (const models of jars) {
    for (const model of models) {
      const key = `${model.provider ?? ""} ${model.model}`;
      const previous = merged.get(key);
      merged.set(
        key,
        previous === undefined
          ? model
          : {
              ...previous,
              messages: previous.messages + model.messages,
              cursed: previous.cursed + model.cursed,
              frustrated: previous.frustrated + model.frustrated,
              outputTokens: previous.outputTokens + model.outputTokens,
              days: mergeDays(previous.days, model.days),
            },
      );
    }
  }
  return [...merged.values()];
}

export interface AnnoyanceDay {
  readonly day: string;
  readonly cursed: number;
  readonly frustrated: number;
}

/** Every day of the window, quiet days included, so a chart does not skip them. */
export function annoyanceSeries(
  models: readonly Pick<SwearJarModel, "days">[],
  sinceDay: string,
  untilDay: string,
): AnnoyanceDay[] {
  const totals = new Map<string, { cursed: number; frustrated: number }>();
  for (const model of models) {
    for (const day of model.days) {
      const previous = totals.get(day.day) ?? { cursed: 0, frustrated: 0 };
      totals.set(day.day, {
        cursed: previous.cursed + day.cursed,
        frustrated: previous.frustrated + day.frustrated,
      });
    }
  }
  return enumerateDays(sinceDay, untilDay).map((day) => {
    const counts = totals.get(day);
    return { day, cursed: counts?.cursed ?? 0, frustrated: counts?.frustrated ?? 0 };
  });
}

export function rankSwearJar(models: readonly SwearJarModel[]): SwearJarRanking {
  const ranked: SwearJarRow[] = [];
  const unranked: SwearJarModel[] = [];
  for (const model of models) {
    if (model.messages < MIN_RANKED_MESSAGES || model.outputTokens === 0) {
      unranked.push(model);
      continue;
    }
    ranked.push({
      ...model,
      rate: ((model.cursed + model.frustrated) * TOKENS_PER_RATE) / model.outputTokens,
    });
  }
  return {
    ranked: ranked.sort((a, b) => b.rate - a.rate),
    unranked: unranked.sort(
      (a, b) => b.cursed + b.frustrated - (a.cursed + a.frustrated) || b.messages - a.messages,
    ),
  };
}
