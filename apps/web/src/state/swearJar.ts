/**
 * Swear jar state across every connected environment.
 *
 * @module state/swearJar
 */
import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, SwearJarInput, SwearJarModel } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/unstable/reactivity";
import { useMemo } from "react";

import { environmentPresentations } from "./presentation";
import { serverEnvironment } from "./server";

export interface EnvironmentSwearJar {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly isPending: boolean;
  readonly failed: boolean;
  readonly models: readonly SwearJarModel[] | null;
}

const swearJarByWindowAtom = Atom.family((windowKey: string) =>
  Atom.make((get): readonly EnvironmentSwearJar[] => {
    const input = JSON.parse(windowKey) as SwearJarInput;
    const statuses: EnvironmentSwearJar[] = [];
    for (const [environmentId, presentation] of get(environmentPresentations.presentationsAtom)) {
      const result = get(serverEnvironment.swearJar({ environmentId, input }));
      statuses.push({
        environmentId,
        label: presentation.entry.target.label,
        isPending: result.waiting,
        failed: result._tag === "Failure",
        models: Option.getOrNull(AsyncResult.value(result))?.models ?? null,
      });
    }
    return statuses;
  }).pipe(Atom.withLabel(`web-swear-jar:window:${windowKey}`)),
);

export function useSwearJar(input: SwearJarInput): readonly EnvironmentSwearJar[] {
  const windowKey = useMemo(
    () =>
      JSON.stringify({
        sinceDay: input.sinceDay,
        untilDay: input.untilDay,
        timeZone: input.timeZone,
      }),
    [input.sinceDay, input.untilDay, input.timeZone],
  );
  return useAtomValue(swearJarByWindowAtom(windowKey));
}
