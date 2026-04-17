# Runtime Overview

## High-Level Shape

T3 Code runs a single backend that owns:

- the HTTP server
- the WebSocket RPC server
- auth and pairing
- orchestration state
- provider session management
- git, terminal, checkpointing, and workspace services

The main composition happens in [`apps/server/src/server.ts`](../../apps/server/src/server.ts).

## Startup Sequence

1. Runtime configuration is resolved in [`apps/server/src/config.ts`](../../apps/server/src/config.ts).
2. Required directories and runtime paths are derived and created.
3. The Effect layer graph is assembled.
4. HTTP and WebSocket routes are mounted.
5. Runtime state is persisted once the listener is ready.
6. A welcome payload is emitted to the browser so the UI can bootstrap its environment and active project/thread state.

## Important Runtime Paths

- [`apps/server/src/config.ts`](../../apps/server/src/config.ts) defines ports, modes, derived storage paths, and startup presentation.
- [`apps/server/src/server.ts`](../../apps/server/src/server.ts) wires the service graph.
- [`apps/server/src/serverRuntimeStartup.ts`](../../apps/server/src/serverRuntimeStartup.ts) gates startup commands until the server is ready.
- [`apps/server/src/serverLifecycleEvents.ts`](../../apps/server/src/serverLifecycleEvents.ts) publishes `welcome` and `ready` events to clients.
- [`apps/server/src/startupAccess.ts`](../../apps/server/src/startupAccess.ts) builds the connection string and pairing URL used for headless and desktop startup output.

## Persistent State

The server persists state under a runtime state directory, including:

- SQLite backing data
- logs
- terminal logs
- provider logs and event traces
- attachments
- worktrees
- server secrets

The exact paths are derived from the configured base directory in [`apps/server/src/config.ts`](../../apps/server/src/config.ts).

## Design Constraints

- startup must be predictable under partial initialization
- server readiness should be observable before dispatching queued commands
- reconnects and restarts must not lose the auth/control-plane state that clients rely on
- persistence boundaries should stay explicit
