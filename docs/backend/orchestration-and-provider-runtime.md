# Orchestration And Provider Runtime

## Core Responsibility

This layer manages the actual agent work:

- starting and resuming provider sessions
- dispatching orchestration commands
- projecting thread/project state
- logging provider runtime events
- coordinating git, terminal, checkpoint, and workspace operations

## Main Entry Points

- [`apps/server/src/codexAppServerManager.ts`](../../apps/server/src/codexAppServerManager.ts)
- [`apps/server/src/providerManager.ts`](../../apps/server/src/providerManager.ts)
- [`apps/server/src/orchestration/Services/OrchestrationEngine.ts`](../../apps/server/src/orchestration/Services/OrchestrationEngine.ts)
- [`apps/server/src/orchestration/runtimeLayer.ts`](../../apps/server/src/orchestration/runtimeLayer.ts)

## Provider Runtime

The server coordinates provider-specific sessions and adapters under:

- [`apps/server/src/provider/`](../../apps/server/src/provider/)
- [`apps/server/src/provider/Layers/`](../../apps/server/src/provider/Layers/)
- [`apps/server/src/provider/Services/`](../../apps/server/src/provider/Services/)

The runtime is responsible for:

- session lifecycle
- thread event logging
- adapter selection
- provider state reporting
- bridging provider runtime into orchestration events

## Orchestration Model

The orchestration domain is schema-driven in [`packages/contracts/src/orchestration.ts`](../../packages/contracts/src/orchestration.ts).

It covers:

- projects
- threads
- messages
- sessions
- checkpoints
- thread activities
- proposed plans
- dispatch commands and replay

## Bootstrap Turn Start

The server has special handling for bootstrap turns:

- create a thread if bootstrap asks for it
- prepare a worktree if requested
- run setup scripts if requested
- dispatch the final turn start command only after bootstrap work is complete

This keeps “create + configure + start” atomic from the client’s point of view.

## Git, Terminal, And Checkpoint Integration

The orchestration layer depends on:

- git core and git manager services
- terminal manager
- checkpoint diff/store services
- workspace filesystem and workspace entry services
- project setup script runner

These systems are wired together in [`apps/server/src/server.ts`](../../apps/server/src/server.ts) and the orchestration runtime layers.

## Reliability Notes

- bootstrap commands should clean up partial thread creation when they fail
- orchestration commands are queued until startup readiness is satisfied
- thread detail state should be derived from events, not duplicated ad hoc
- provider runtime failures should surface as structured thread activity and/or session status
