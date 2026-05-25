import {
  CommandId,
  defaultInstanceIdForDriver,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  MessageId,
  ProjectId,
  ProviderDriverKind,
  ThreadId,
} from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as NodeServices from "@effect/platform-node/NodeServices";

import {
  makeOrchestrationIntegrationHarness,
  type OrchestrationIntegrationHarness,
} from "./OrchestrationEngineHarness.integration.ts";

const PI_PROVIDER = ProviderDriverKind.make("piAgent");
const PI_INSTANCE_ID = defaultInstanceIdForDriver(PI_PROVIDER);
const PI_OPENCODE_GO_MODEL = "opencode-go/deepseek-v4-flash";

const PROJECT_ID = ProjectId.make("project-pi-opencode-go");
const THREAD_ID = ThreadId.make("thread-pi-opencode-go");

const hasPiCredentials = () =>
  Boolean(process.env.OPENCODE_API_KEY?.trim() || process.env.OPENCODE_GO_API_KEY?.trim());

function withRealPiHarness<A, E>(
  use: (harness: OrchestrationIntegrationHarness) => Effect.Effect<A, E>,
) {
  return Effect.acquireUseRelease(
    makeOrchestrationIntegrationHarness({ provider: PI_PROVIDER, realPi: true }),
    use,
    (harness) => harness.dispose,
  ).pipe(Effect.provide(NodeServices.layer));
}

function nowIso() {
  return "2026-05-25T00:00:00.000Z";
}

it.live.skipIf(!hasPiCredentials())(
  "runs a Pi Agent turn through T3 orchestration with OpenCode Go",
  () =>
    withRealPiHarness((harness) =>
      Effect.gen(function* () {
        const createdAt = nowIso();

        yield* harness.engine.dispatch({
          type: "project.create",
          commandId: CommandId.make("cmd-project-create-pi-opencode-go"),
          projectId: PROJECT_ID,
          title: "Pi OpenCode Go Integration",
          workspaceRoot: harness.workspaceDir,
          defaultModelSelection: {
            instanceId: PI_INSTANCE_ID,
            model: PI_OPENCODE_GO_MODEL,
          },
          createdAt,
        });

        yield* harness.engine.dispatch({
          type: "thread.create",
          commandId: CommandId.make("cmd-thread-create-pi-opencode-go"),
          threadId: THREAD_ID,
          projectId: PROJECT_ID,
          title: "Pi OpenCode Go Thread",
          modelSelection: {
            instanceId: PI_INSTANCE_ID,
            model: PI_OPENCODE_GO_MODEL,
          },
          interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
          runtimeMode: "full-access",
          branch: null,
          worktreePath: harness.workspaceDir,
          createdAt,
        });

        yield* harness.engine.dispatch({
          type: "thread.turn.start",
          commandId: CommandId.make("cmd-turn-start-pi-opencode-go"),
          threadId: THREAD_ID,
          message: {
            messageId: MessageId.make("msg-pi-opencode-go-1"),
            role: "user",
            text: "Reply with exactly: T3-PI-OK",
            attachments: [],
          },
          interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
          runtimeMode: "full-access",
          createdAt: nowIso(),
        });

        const thread = yield* harness.waitForThread(
          THREAD_ID,
          (entry) =>
            entry.session?.status === "ready" &&
            entry.session.providerName === PI_PROVIDER &&
            entry.messages.some(
              (message) =>
                message.role === "assistant" &&
                message.streaming === false &&
                message.text.includes("T3-PI-OK"),
            ),
          180_000,
        );

        assert.equal(thread.session?.providerName, PI_PROVIDER);
        const assistant = thread.messages.find(
          (message) => message.role === "assistant" && message.text.includes("T3-PI-OK"),
        );
        assert.ok(assistant);
      }),
    ),
  200_000,
);
