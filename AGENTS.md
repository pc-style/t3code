# AGENTS.md

## Task Completion Requirements

- All of `bun fmt`, `bun lint`, and `bun typecheck` must pass before considering tasks completed.
- NEVER run `bun test`. Always use `bun run test` (runs Vitest).

## Project Snapshot

T3 Code is a minimal web GUI for using coding agents like Codex and Claude.

This repository is a VERY EARLY WIP. Proposing sweeping changes that improve long-term maintainability is encouraged.

## Core Priorities

1. Performance first.
2. Reliability first.
3. Keep behavior predictable under load and during failures (session restarts, reconnects, partial streams).

If a tradeoff is required, choose correctness and robustness over short-term convenience.

## Maintainability

Long term maintainability is a core priority. If you add new functionality, first check if there is shared logic that can be extracted to a separate module. Duplicate logic across multiple files is a code smell and should be avoided. Don't be afraid to change existing code. Don't take shortcuts by just adding local logic to solve a problem.

## Package Roles

- `apps/server`: Node.js WebSocket server. Wraps Codex app-server (JSON-RPC over stdio), serves the React web app, and manages provider sessions.
- `apps/web`: React/Vite UI. Owns session UX, conversation/event rendering, and client-side state. Connects to the server via WebSocket.
- `packages/contracts`: Shared effect/Schema schemas and TypeScript contracts for provider events, WebSocket protocol, and model/session types. Keep this package schema-only — no runtime logic.
- `packages/shared`: Shared runtime utilities consumed by both server and web. Uses explicit subpath exports (e.g. `@t3tools/shared/git`) — no barrel index.

## Codex App Server (Important)

T3 Code is currently Codex-first. The server starts `codex app-server` (JSON-RPC over stdio) per provider session, then streams structured events to the browser through WebSocket push messages.

How we use it in this codebase:

- Session startup/resume and turn lifecycle are brokered in `apps/server/src/codexAppServerManager.ts`.
- Provider dispatch and thread event logging are coordinated in `apps/server/src/providerManager.ts`.
- WebSocket server routes NativeApi methods in `apps/server/src/wsServer.ts`.
- Web app consumes orchestration domain events via WebSocket push on channel `orchestration.domainEvent` (provider runtime activity is projected into orchestration events server-side).

Docs:

- Codex App Server docs: https://developers.openai.com/codex/sdk/#app-server

## Reference Repos

- Open-source Codex repo: https://github.com/openai/codex
- Codex-Monitor (Tauri, feature-complete, strong reference implementation): https://github.com/Dimillian/CodexMonitor

Use these as implementation references when designing protocol handling, UX flows, and operational safeguards.

## Cursor Cloud specific instructions

### Environment

- **Node.js 24.13.1** via nvm (run `nvm use 24.13.1` if not default).
- **Bun 1.3.11** at `~/.bun/bin/bun`. Ensure `$BUN_INSTALL/bin` is on PATH.
- Both are required: Bun is the package manager + SQLite runtime; Node.js runs the server and dev-runner scripts.

### Running the dev environment

- `T3CODE_NO_BROWSER=1 bun dev` starts both `apps/server` (port 13773) and `apps/web` (port 5733) via Turborepo.
- The server emits a **pairing URL** on first start (check stdout for `pairingUrl`). Open it in a browser to authenticate.
- No external databases or services are required — SQLite is embedded.
- **Codex CLI** (`@openai/codex`) is pre-installed globally via `npm install -g @openai/codex`. Run `codex login` to authenticate before using the Codex provider.
- Other provider CLIs (claude, opencode) are optional; the app works without them but shows a warning.

### Common commands (see `package.json` scripts)

| Task | Command |
|------|---------|
| Install deps | `bun install` |
| Dev (all) | `bun dev` |
| Lint | `bun lint` |
| Format check | `bun fmt:check` |
| Typecheck | `bun typecheck` |
| Tests | `bun run test` (NOT `bun test`) |

### Gotchas

- `bun test` invokes the Bun test runner directly; always use `bun run test` which delegates to Vitest via Turbo.
- The `prepare` script patches TypeScript for `@effect/language-service`. If you delete `node_modules`, re-run `bun install` to re-patch.
- Typecheck depends on `@t3tools/contracts` being built first (Turbo handles this automatically via task dependencies).
- The server uses `node-pty` which requires native compilation tools (gcc, make, python3). These are pre-installed in the Cloud VM.
