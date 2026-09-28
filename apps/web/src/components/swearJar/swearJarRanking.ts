import type { SwearJarModel } from "@t3tools/contracts";

/** Fewer messages than this and one bad afternoon decides the ranking. */
export const MIN_RANKED_MESSAGES = 25;

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
            },
      );
    }
  }
  return [...merged.values()];
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
