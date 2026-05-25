/**
 * PiAgentDriver — `ProviderDriver` for Pi (`pi --mode rpc`).
 *
 * @see https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/rpc.md
 */
import { PiAgentSettings, ProviderDriverKind, type ServerProvider } from "@t3tools/contracts";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { ChildProcessSpawner } from "effect/unstable/process";

import { ServerConfig } from "../../config.ts";
import {
  makePiAgentEnvironment,
  makePiAgentTextGeneration,
} from "../../textGeneration/PiAgentTextGeneration.ts";
import { ProviderDriverError } from "../Errors.ts";
import { makePiAgentAdapter } from "../Layers/PiAgentAdapter.ts";
import {
  checkPiAgentProviderStatus,
  makePendingPiAgentProvider,
} from "../Layers/PiAgentProvider.ts";
import { ProviderEventLoggers } from "../Layers/ProviderEventLoggers.ts";
import { makeManagedServerProvider } from "../makeManagedServerProvider.ts";
import { type ProviderDriver, type ProviderInstance } from "../ProviderDriver.ts";
import type { ServerProviderDraft } from "../providerSnapshot.ts";
import { mergeProviderInstanceEnvironment } from "../ProviderInstanceEnvironment.ts";
import {
  makePackageManagedProviderMaintenanceResolver,
  resolveProviderMaintenanceCapabilitiesEffect,
} from "../providerMaintenance.ts";

const decodePiAgentSettings = Schema.decodeSync(PiAgentSettings);

const DRIVER_KIND = ProviderDriverKind.make("piAgent");
const SNAPSHOT_REFRESH_INTERVAL = Duration.minutes(5);

const UPDATE = makePackageManagedProviderMaintenanceResolver({
  provider: DRIVER_KIND,
  npmPackageName: "@earendil-works/pi-coding-agent",
  homebrewFormula: null,
  nativeUpdate: null,
});

export function buildPiContinuationGroupKey(input: {
  readonly instanceId: ProviderInstance["instanceId"];
  readonly configDir: string;
  readonly sessionDir: string;
}): string {
  const identityStateParts = [
    input.configDir.trim() ? `config:${input.configDir.trim()}` : null,
    input.sessionDir.trim() ? `session:${input.sessionDir.trim()}` : null,
  ].filter((part): part is string => part !== null);
  const identitySuffix =
    identityStateParts.length > 0 ? encodeURIComponent(identityStateParts.join("|")) : undefined;
  return `piAgent:instance:${input.instanceId}${identitySuffix ? `:state:${identitySuffix}` : ""}`;
}

export type PiAgentDriverEnv =
  | ChildProcessSpawner.ChildProcessSpawner
  | FileSystem.FileSystem
  | Path.Path
  | ProviderEventLoggers
  | ServerConfig;

const withInstanceIdentity =
  (input: {
    readonly instanceId: ProviderInstance["instanceId"];
    readonly displayName: string | undefined;
    readonly accentColor: string | undefined;
    readonly continuationGroupKey: string;
  }) =>
  (snapshot: ServerProviderDraft): ServerProvider => ({
    ...snapshot,
    instanceId: input.instanceId,
    driver: DRIVER_KIND,
    ...(input.displayName ? { displayName: input.displayName } : {}),
    ...(input.accentColor ? { accentColor: input.accentColor } : {}),
    continuation: { groupKey: input.continuationGroupKey },
  });

export const PiAgentDriver: ProviderDriver<PiAgentSettings, PiAgentDriverEnv> = {
  driverKind: DRIVER_KIND,
  metadata: {
    displayName: "Pi",
    supportsMultipleInstances: true,
  },
  configSchema: PiAgentSettings,
  defaultConfig: (): PiAgentSettings => decodePiAgentSettings({}),
  create: ({ instanceId, displayName, accentColor, environment, enabled, config }) =>
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const eventLoggers = yield* ProviderEventLoggers;
      const serverConfig = yield* ServerConfig;
      const effectiveConfig = { ...config, enabled } satisfies PiAgentSettings;
      const processEnv = makePiAgentEnvironment(
        effectiveConfig,
        mergeProviderInstanceEnvironment(environment),
      );
      const continuationIdentity = {
        driverKind: DRIVER_KIND,
        continuationKey: buildPiContinuationGroupKey({
          instanceId,
          configDir: effectiveConfig.configDir,
          sessionDir: effectiveConfig.sessionDir,
        }),
      };
      const stampIdentity = withInstanceIdentity({
        instanceId,
        displayName,
        accentColor,
        continuationGroupKey: continuationIdentity.continuationKey,
      });
      const maintenanceCapabilities = yield* resolveProviderMaintenanceCapabilitiesEffect(UPDATE, {
        binaryPath: effectiveConfig.binaryPath,
        env: processEnv,
      }).pipe(Effect.provideService(FileSystem.FileSystem, fileSystem));

      const adapter = yield* makePiAgentAdapter(effectiveConfig, {
        environment: processEnv,
        attachmentsDir: serverConfig.attachmentsDir,
        ...(eventLoggers.native ? { nativeEventLogger: eventLoggers.native } : {}),
      }).pipe(
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
        Effect.provideService(FileSystem.FileSystem, fileSystem),
        Effect.provideService(Path.Path, path),
      );

      const checkProvider = checkPiAgentProviderStatus(effectiveConfig, processEnv).pipe(
        Effect.map(stampIdentity),
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
        Effect.provideService(FileSystem.FileSystem, fileSystem),
        Effect.provideService(Path.Path, path),
      );

      const snapshot = yield* makeManagedServerProvider<PiAgentSettings>({
        maintenanceCapabilities,
        getSettings: Effect.succeed(effectiveConfig),
        streamSettings: Stream.never,
        haveSettingsChanged: () => false,
        initialSnapshot: (settings) =>
          makePendingPiAgentProvider(settings).pipe(Effect.map(stampIdentity)),
        checkProvider,
        refreshInterval: SNAPSHOT_REFRESH_INTERVAL,
      }).pipe(
        Effect.mapError(
          (cause) =>
            new ProviderDriverError({
              driver: DRIVER_KIND,
              instanceId,
              detail: `Failed to build Pi Agent snapshot: ${cause.message ?? String(cause)}`,
              cause,
            }),
        ),
      );

      return {
        instanceId,
        driverKind: DRIVER_KIND,
        continuationIdentity,
        displayName,
        accentColor,
        enabled,
        snapshot,
        adapter,
        textGeneration: yield* makePiAgentTextGeneration(effectiveConfig, processEnv).pipe(
          Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
          Effect.provideService(FileSystem.FileSystem, fileSystem),
        ),
      } satisfies ProviderInstance;
    }),
};
