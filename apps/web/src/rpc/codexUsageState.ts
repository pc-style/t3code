import { useAtomValue } from "@effect/atom-react";
import type { CodexUsageSnapshot } from "@t3tools/contracts";
import { Atom } from "effect/unstable/reactivity";

import type { WsRpcClient } from "./wsRpcClient";
import { appAtomRegistry, resetAppAtomRegistryForTests } from "./atomRegistry";

type CodexUsageClient = Pick<WsRpcClient["server"], "getCodexUsage" | "subscribeCodexUsage">;

function makeStateAtom<A>(label: string, initialValue: A) {
  return Atom.make(initialValue).pipe(Atom.keepAlive, Atom.withLabel(label));
}

export const codexUsageAtom = makeStateAtom<CodexUsageSnapshot | null>("codex-usage", null);

export function getCodexUsageSnapshot(): CodexUsageSnapshot | null {
  return appAtomRegistry.get(codexUsageAtom);
}

export function setCodexUsageSnapshot(snapshot: CodexUsageSnapshot): void {
  appAtomRegistry.set(codexUsageAtom, snapshot);
}

export function startCodexUsageSync(client: CodexUsageClient): () => void {
  let disposed = false;
  const cleanup = client.subscribeCodexUsage((snapshot) => {
    setCodexUsageSnapshot(snapshot);
  });

  if (getCodexUsageSnapshot() === null) {
    void client
      .getCodexUsage({})
      .then((snapshot) => {
        if (disposed || getCodexUsageSnapshot() !== null) {
          return;
        }
        setCodexUsageSnapshot(snapshot);
      })
      .catch(() => undefined);
  }

  return () => {
    disposed = true;
    cleanup();
  };
}

export function resetCodexUsageStateForTests(): void {
  resetAppAtomRegistryForTests();
}

export function useCodexUsageSnapshot(): CodexUsageSnapshot | null {
  return useAtomValue(codexUsageAtom);
}
