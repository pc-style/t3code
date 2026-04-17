import { homedir } from "node:os";
import {
  type CodexUsagePricingMode,
  type CodexUsageSnapshot,
  type CodexUsageWindow,
} from "@t3tools/contracts";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http";
import { Duration, Effect, FileSystem, Layer, Path, PubSub, Ref, Schema, Stream } from "effect";

import { ServerSettingsService } from "../../serverSettings.ts";
import { readCodexAccountSnapshot, type CodexAccountSnapshot } from "../codexAccount.ts";
import { CodexUsage, type CodexUsageShape } from "../Services/CodexUsage.ts";

const CODEX_USAGE_ENDPOINT = "https://chatgpt.com/backend-api/wham/usage";
const SNAPSHOT_TTL_MS = Duration.toMillis(Duration.seconds(30));

interface CodexAuthState {
  readonly authMode: "chatgpt" | "apikey" | "unknown";
  readonly accessToken: string | null;
}

interface RuntimeUsageHints {
  readonly account: CodexAccountSnapshot | null;
  readonly primaryWindow: CodexUsageWindow | null;
  readonly weeklyWindow: CodexUsageWindow | null;
}

interface CachedSnapshot {
  readonly snapshot: CodexUsageSnapshot;
  readonly fetchedAtMs: number;
}

const EMPTY_RUNTIME_HINTS: RuntimeUsageHints = {
  account: null,
  primaryWindow: null,
  weeklyWindow: null,
};

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function asArray(value: unknown): ReadonlyArray<unknown> {
  return Array.isArray(value) ? value : [];
}

function tokenizeValue(value: string): ReadonlyArray<string> {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((part) => part.length > 0);
}

function clampPercent(value: number | null): number | null {
  if (value === null) {
    return null;
  }
  return Math.max(0, Math.min(100, value));
}

function inferWindowName(value: Record<string, unknown>): "primary" | "weekly" | null {
  const name =
    asString(value.name) ??
    asString(value.window) ??
    asString(value.key) ??
    asString(value.type) ??
    asString(value.label);
  if (!name) {
    return null;
  }
  const normalized = name.toLowerCase();
  if (normalized.includes("week") || normalized.includes("7d")) {
    return "weekly";
  }
  if (
    normalized.includes("primary") ||
    normalized.includes("current") ||
    normalized.includes("session") ||
    normalized.includes("5h")
  ) {
    return "primary";
  }
  return null;
}

function readPercent(value: Record<string, unknown>, prefix: "used" | "remaining"): number | null {
  const direct =
    asNumber(value[`${prefix}Percent`]) ??
    asNumber(value[`${prefix}_percent`]) ??
    asNumber(value[`${prefix}Percentage`]) ??
    asNumber(value[`${prefix}_percentage`]);
  if (direct !== null) {
    return clampPercent(direct);
  }

  const amount =
    asNumber(value[prefix]) ??
    asNumber(value[`${prefix}Credits`]) ??
    asNumber(value[`${prefix}_credits`]) ??
    asNumber(value[`${prefix}Tokens`]) ??
    asNumber(value[`${prefix}_tokens`]);
  const limit =
    asNumber(value.limit) ??
    asNumber(value.max) ??
    asNumber(value.total) ??
    asNumber(value.capacity);
  if (amount !== null && limit !== null && limit > 0) {
    return clampPercent((amount / limit) * 100);
  }
  return null;
}

function readWindowSeconds(value: Record<string, unknown>): number | null {
  return (
    asNumber(value.windowSeconds) ??
    asNumber(value.window_seconds) ??
    asNumber(value.windowSecs) ??
    asNumber(value.window_secs) ??
    asNumber(value.durationSeconds) ??
    asNumber(value.duration_seconds)
  );
}

function readResetAt(value: Record<string, unknown>): string | null {
  const direct =
    asString(value.resetAt) ??
    asString(value.reset_at) ??
    asString(value.resetsAt) ??
    asString(value.resets_at);
  if (direct) {
    return direct;
  }

  const resetMs =
    asNumber(value.resetAtMs) ??
    asNumber(value.reset_at_ms) ??
    asNumber(value.resetMs) ??
    asNumber(value.reset_ms);
  if (resetMs !== null) {
    return new Date(resetMs).toISOString();
  }

  const resetSeconds =
    asNumber(value.resetInSeconds) ??
    asNumber(value.reset_in_seconds) ??
    asNumber(value.secondsUntilReset) ??
    asNumber(value.seconds_until_reset);
  if (resetSeconds !== null) {
    return new Date(Date.now() + resetSeconds * 1000).toISOString();
  }

  return null;
}

function normalizeWindow(
  entry: unknown,
  fallbackName?: "primary" | "weekly",
): CodexUsageWindow | null {
  const record = asObject(entry);
  if (!record) {
    return null;
  }

  const name = fallbackName ?? inferWindowName(record);
  if (!name) {
    return null;
  }

  const usedPercent = readPercent(record, "used");
  const remainingPercent = (() => {
    const direct = readPercent(record, "remaining");
    if (direct !== null) {
      return direct;
    }
    return usedPercent !== null ? clampPercent(100 - usedPercent) : null;
  })();
  const windowSeconds = readWindowSeconds(record);

  return {
    name,
    label: asString(record.label) ?? (name === "weekly" ? "Weekly window" : "Current window"),
    usedPercent,
    remainingPercent,
    resetAt: readResetAt(record),
    windowSeconds,
  };
}

function findWindows(value: unknown): {
  primaryWindow: CodexUsageWindow | null;
  weeklyWindow: CodexUsageWindow | null;
} {
  const root = asObject(value);
  const candidates = [
    value,
    root?.windows,
    root?.limits,
    root?.rateLimits,
    root?.rate_limits,
    root?.rate_limit,
    root?.additional_rate_limits,
    root?.usage,
    root?.data,
  ];

  let primaryWindow: CodexUsageWindow | null = null;
  let weeklyWindow: CodexUsageWindow | null = null;

  for (const candidate of candidates) {
    const candidateRecord = asObject(candidate);
    if (candidateRecord) {
      primaryWindow ??=
        normalizeWindow(candidateRecord.rate_limit, "primary") ??
        normalizeWindow(candidateRecord.primary, "primary") ??
        normalizeWindow(candidateRecord.current, "primary");
      weeklyWindow ??=
        normalizeWindow(candidateRecord.additional_rate_limits, "weekly") ??
        normalizeWindow(candidateRecord.weekly, "weekly") ??
        normalizeWindow(candidateRecord.secondary, "weekly");
    }

    for (const entry of asArray(candidate)) {
      const window = normalizeWindow(entry);
      if (!window) {
        continue;
      }
      if (window.name === "primary") {
        primaryWindow ??= window;
      } else {
        weeklyWindow ??= window;
      }
    }
  }

  return { primaryWindow, weeklyWindow };
}

function normalizeCredits(value: unknown): CodexUsageSnapshot["credits"] {
  const root = asObject(value);
  const candidates = [
    root?.credits,
    root?.workspaceCredits,
    root?.workspace_credits,
    root?.balance,
    root?.creditBalance,
    root?.credit_balance,
  ];

  for (const candidate of candidates) {
    const record = asObject(candidate);
    if (!record) {
      continue;
    }

    const balance =
      asNumber(record.balance) ??
      asNumber(record.remaining) ??
      asNumber(record.available) ??
      asNumber(record.credits);
    const unlimited =
      asBoolean(record.unlimited) ??
      (asString(record.balance) === "unlimited" ? true : null) ??
      false;
    const available =
      asBoolean(record.available) ??
      asBoolean(record.has_credits) ??
      asBoolean(record.hasCredits) ??
      (unlimited || balance !== null);

    return {
      available,
      unlimited,
      balance: unlimited ? null : balance,
      currencyOrUnit: "credits",
    };
  }

  return null;
}

function readPricingMode(value: unknown): CodexUsagePricingMode {
  const root = asObject(value);
  const raw =
    asString(root?.pricingMode) ??
    asString(root?.pricing_mode) ??
    asString(asObject(root?.plan)?.pricingMode) ??
    asString(asObject(root?.workspace)?.pricingMode);
  switch (raw) {
    case "token-based":
    case "token_based":
      return "token-based";
    case "legacy":
      return "legacy";
    default:
      return "unknown";
  }
}

function readPlanType(value: unknown): CodexAccountSnapshot["planType"] {
  const root = asObject(value);
  const raw =
    asString(root?.planType) ??
    asString(root?.plan_type) ??
    asString(asObject(root?.account)?.planType) ??
    asString(asObject(root?.workspace)?.planType);
  switch (raw?.toLowerCase()) {
    case "free":
    case "go":
    case "plus":
    case "pro":
    case "team":
    case "business":
    case "enterprise":
    case "edu":
    case "unknown":
      return raw.toLowerCase() as CodexAccountSnapshot["planType"];
    default:
      break;
  }

  if (!raw) {
    return null;
  }

  const tokens = tokenizeValue(raw);
  if (tokens.includes("business")) {
    return "business";
  }
  if (tokens.includes("enterprise")) {
    return "enterprise";
  }
  if (tokens.includes("edu") || tokens.includes("education")) {
    return "edu";
  }
  if (tokens.includes("team")) {
    return "team";
  }
  if (tokens.includes("plus")) {
    return "plus";
  }
  if (tokens.includes("pro")) {
    return "pro";
  }
  if (tokens.includes("go")) {
    return "go";
  }
  if (tokens.includes("free")) {
    return "free";
  }

  return null;
}

function readPlanSubtype(value: unknown): string | null {
  const root = asObject(value);
  const direct =
    asString(root?.planSubtype) ??
    asString(root?.plan_subtype) ??
    asString(asObject(root?.account)?.planSubtype) ??
    asString(asObject(root?.workspace)?.planSubtype);
  if (direct) {
    return direct;
  }

  const rawPlanType =
    asString(root?.planType) ??
    asString(root?.plan_type) ??
    asString(asObject(root?.account)?.planType) ??
    asString(asObject(root?.workspace)?.planType);

  if (!rawPlanType) {
    return null;
  }

  return readPlanType(value) === rawPlanType.toLowerCase() ? null : rawPlanType;
}

function containsUsageBasedHint(value: string | null | undefined): boolean {
  return typeof value === "string" && value.toLowerCase().includes("usage_based");
}

function isUsageSeat(value: string | null | undefined): boolean {
  const normalized = value?.toLowerCase();
  return normalized === "business_usage" || normalized === "business_usage_based";
}

function buildEntitlement(input: {
  readonly accountType: CodexUsageSnapshot["accountType"];
  readonly planType: CodexAccountSnapshot["planType"];
  readonly planSubtype: string | null;
  readonly billingType: string | null;
  readonly seatType: string | null;
  readonly credits: CodexUsageSnapshot["credits"];
  readonly primaryWindow: CodexUsageWindow | null;
  readonly weeklyWindow: CodexUsageWindow | null;
}): CodexUsageSnapshot["entitlement"] {
  const showRateLimits = input.primaryWindow !== null || input.weeklyWindow !== null;
  const isBusinessUsageBased =
    input.accountType === "chatgpt" &&
    input.planType === "business" &&
    (containsUsageBasedHint(input.planSubtype) ||
      containsUsageBasedHint(input.billingType) ||
      isUsageSeat(input.seatType) ||
      input.credits?.available === true);

  if (isBusinessUsageBased) {
    return {
      showRateLimits,
      showCreditsBalance: input.credits?.available === true,
      showCreditCosts: true,
      isBusinessUsageBased: true,
      reason: null,
    };
  }

  return {
    showRateLimits,
    showCreditsBalance: false,
    showCreditCosts: false,
    isBusinessUsageBased: false,
    reason:
      input.accountType !== "chatgpt"
        ? "Workspace credits require ChatGPT-authenticated Codex."
        : input.planType !== "business"
          ? "Credit details are only available for business usage-based Codex workspaces."
          : "This business workspace is not marked as usage-based.",
  };
}

function makeUnavailableSnapshot(input: {
  readonly fetchedAt: string;
  readonly accountType: CodexUsageSnapshot["accountType"];
  readonly account: CodexAccountSnapshot | null;
  readonly runtimeHints: RuntimeUsageHints;
  readonly message: string;
}): CodexUsageSnapshot {
  const source =
    input.runtimeHints.primaryWindow !== null || input.runtimeHints.weeklyWindow !== null
      ? "runtime-events"
      : "unavailable";
  const primaryWindow = input.runtimeHints.primaryWindow;
  const weeklyWindow = input.runtimeHints.weeklyWindow;
  return {
    provider: "codex",
    fetchedAt: input.fetchedAt,
    source,
    accountType: input.accountType,
    planType: input.account?.planType ?? null,
    planSubtype: input.account?.planSubtype ?? null,
    pricingMode: "unknown",
    primaryWindow,
    weeklyWindow,
    credits: null,
    entitlement: buildEntitlement({
      accountType: input.accountType,
      planType: input.account?.planType ?? null,
      planSubtype: input.account?.planSubtype ?? null,
      billingType: input.account?.billingType ?? null,
      seatType: input.account?.seatType ?? null,
      credits: null,
      primaryWindow,
      weeklyWindow,
    }),
    message: input.message,
  };
}

const makeCodexUsage = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const httpClient = yield* HttpClient.HttpClient;
  const serverSettings = yield* ServerSettingsService;
  const changesPubSub = yield* Effect.acquireRelease(
    PubSub.unbounded<CodexUsageSnapshot>(),
    PubSub.shutdown,
  );
  const runtimeHintsRef = yield* Ref.make<RuntimeUsageHints>(EMPTY_RUNTIME_HINTS);
  const cacheRef = yield* Ref.make<CachedSnapshot | null>(null);
  const lastGoodSnapshotRef = yield* Ref.make<CodexUsageSnapshot | null>(null);

  const readCodexHome = serverSettings.getSettings.pipe(
    Effect.map(
      (settings) =>
        settings.providers.codex.homePath ||
        process.env.CODEX_HOME ||
        path.join(homedir(), ".codex"),
    ),
  );

  const readAuthState = Effect.gen(function* () {
    const authPath = path.join(yield* readCodexHome, "auth.json");
    const exists = yield* fileSystem.exists(authPath).pipe(Effect.orElseSucceed(() => false));
    if (!exists) {
      return {
        authMode: "unknown",
        accessToken: null,
      } satisfies CodexAuthState;
    }

    const raw = yield* fileSystem.readFileString(authPath);
    const parsed = yield* Effect.try({
      try: () => JSON.parse(raw) as unknown,
      catch: () => null,
    });
    const record = asObject(parsed);
    const tokens = asObject(record?.tokens);
    const authModeValue = asString(record?.auth_mode)?.toLowerCase();

    const authMode = (() => {
      switch (authModeValue) {
        case "chatgpt":
          return "chatgpt";
        case "apikey":
        case "api_key":
          return "apikey";
        default:
          return "unknown";
      }
    })();

    return {
      authMode,
      accessToken: asString(tokens?.access_token) ?? null,
    } satisfies CodexAuthState;
  });

  const fetchUsageResponse = Effect.gen(function* () {
    const authState = yield* readAuthState;
    if (authState.authMode === "apikey") {
      return {
        authState,
        response: null,
      } as const;
    }
    if (authState.authMode !== "chatgpt" || authState.accessToken === null) {
      return {
        authState,
        response: null,
      } as const;
    }

    const request = HttpClientRequest.get(CODEX_USAGE_ENDPOINT).pipe(
      HttpClientRequest.acceptJson,
      HttpClientRequest.bearerToken(authState.accessToken),
    );
    const response = yield* httpClient.execute(request);
    const okResponse = yield* HttpClientResponse.filterStatusOk(response);
    const body = yield* HttpClientResponse.schemaBodyJson(Schema.Unknown)(okResponse);

    return {
      authState,
      response: body,
    } as const;
  });

  const buildSnapshotFromUsageResponse = (input: {
    readonly fetchedAt: string;
    readonly account: CodexAccountSnapshot | null;
    readonly authState: CodexAuthState;
    readonly response: unknown;
  }): CodexUsageSnapshot => {
    const { primaryWindow, weeklyWindow } = findWindows(input.response);
    const credits = normalizeCredits(input.response);
    const planType = readPlanType(input.response) ?? input.account?.planType ?? null;
    const planSubtype = readPlanSubtype(input.response) ?? input.account?.planSubtype ?? null;
    const accountType =
      input.authState.authMode === "chatgpt"
        ? "chatgpt"
        : input.authState.authMode === "apikey"
          ? "apiKey"
          : "unknown";

    return {
      provider: "codex",
      fetchedAt: input.fetchedAt,
      source: "oauth-usage-api",
      accountType,
      planType,
      planSubtype,
      pricingMode: readPricingMode(input.response),
      primaryWindow,
      weeklyWindow,
      credits,
      entitlement: buildEntitlement({
        accountType,
        planType,
        planSubtype,
        billingType: input.account?.billingType ?? null,
        seatType: input.account?.seatType ?? null,
        credits,
        primaryWindow,
        weeklyWindow,
      }),
      message: null,
    };
  };

  const publishSnapshot = (snapshot: CodexUsageSnapshot) =>
    PubSub.publish(changesPubSub, snapshot).pipe(Effect.asVoid);

  const refreshInternal = Effect.fn("refreshInternal")(function* (options?: {
    readonly forceRefresh?: boolean;
  }) {
    const now = Date.now();
    const cached = yield* Ref.get(cacheRef);
    if (!options?.forceRefresh && cached && now - cached.fetchedAtMs < SNAPSHOT_TTL_MS) {
      return cached.snapshot;
    }

    const fetchedAt = new Date(now).toISOString();
    const runtimeHints = yield* Ref.get(runtimeHintsRef);
    const account = runtimeHints.account;

    const exit = yield* Effect.exit(fetchUsageResponse);
    const snapshot =
      exit._tag === "Success" && exit.value.response !== null
        ? buildSnapshotFromUsageResponse({
            fetchedAt,
            account,
            authState: exit.value.authState,
            response: exit.value.response,
          })
        : exit._tag === "Success" && exit.value.authState.authMode === "apikey"
          ? makeUnavailableSnapshot({
              fetchedAt,
              accountType: "apiKey",
              account,
              runtimeHints,
              message: "Workspace usage and credits require ChatGPT-authenticated Codex.",
            })
          : yield* Ref.get(lastGoodSnapshotRef).pipe(
              Effect.map(
                (lastGood) =>
                  lastGood ??
                  makeUnavailableSnapshot({
                    fetchedAt,
                    accountType:
                      exit._tag === "Success"
                        ? exit.value.authState.authMode === "chatgpt"
                          ? "chatgpt"
                          : exit.value.authState.authMode === "apikey"
                            ? "apiKey"
                            : "unknown"
                        : "unknown",
                    account,
                    runtimeHints,
                    message: "Codex usage is currently unavailable. Try refreshing again.",
                  }),
              ),
            );

    yield* Ref.set(cacheRef, { snapshot, fetchedAtMs: now });
    if (snapshot.source === "oauth-usage-api") {
      yield* Ref.set(lastGoodSnapshotRef, snapshot);
    }
    yield* publishSnapshot(snapshot);
    return snapshot;
  });

  const ingestRuntimeEvent: CodexUsageShape["ingestRuntimeEvent"] = (event) =>
    Effect.gen(function* () {
      if (event.provider !== "codex") {
        return;
      }

      if (event.type === "account.updated") {
        yield* Ref.update(runtimeHintsRef, (current) => ({
          ...current,
          account: readCodexAccountSnapshot(event.payload.account),
        }));
      }

      if (event.type === "account.rate-limits.updated") {
        const windows = findWindows(event.payload.rateLimits);
        yield* Ref.update(runtimeHintsRef, (current) => ({
          ...current,
          primaryWindow: windows.primaryWindow ?? current.primaryWindow,
          weeklyWindow: windows.weeklyWindow ?? current.weeklyWindow,
        }));
      }

      if (
        event.type === "account.updated" ||
        event.type === "account.rate-limits.updated" ||
        event.type === "turn.completed"
      ) {
        yield* Ref.set(cacheRef, null);
        yield* refreshInternal({ forceRefresh: true });
      }
    });

  return {
    getSnapshot: (options) => refreshInternal(options),
    refresh: () => refreshInternal({ forceRefresh: true }),
    ingestRuntimeEvent,
    get streamChanges() {
      return Stream.fromPubSub(changesPubSub);
    },
  } satisfies CodexUsageShape;
});

export const CodexUsageLive = Layer.effect(CodexUsage, makeCodexUsage);
