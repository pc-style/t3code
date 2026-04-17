# Backend Docs

This folder documents the server runtime, remote access model, auth/pairing flow, and the WebSocket/RPC boundary.

## Reading Order

1. [`runtime-overview.md`](./runtime-overview.md)
2. [`auth-and-pairing.md`](./auth-and-pairing.md)
3. [`transport-and-rpc.md`](./transport-and-rpc.md)
4. [`orchestration-and-provider-runtime.md`](./orchestration-and-provider-runtime.md)

## What This Covers

- how the server starts and wires its Effect layers
- how local, desktop-managed, and remote pairing work
- how session cookies, bearer sessions, and WebSocket tokens are issued
- how the browser connects over WebSocket RPC
- how orchestration, provider lifecycle, git, terminals, and checkpoints fit together

## Canonical Files

- [`apps/server/src/server.ts`](../../apps/server/src/server.ts)
- [`apps/server/src/config.ts`](../../apps/server/src/config.ts)
- [`apps/server/src/startupAccess.ts`](../../apps/server/src/startupAccess.ts)
- [`apps/server/src/auth/http.ts`](../../apps/server/src/auth/http.ts)
- [`apps/server/src/auth/Layers/ServerAuth.ts`](../../apps/server/src/auth/Layers/ServerAuth.ts)
- [`apps/server/src/auth/Layers/SessionCredentialService.ts`](../../apps/server/src/auth/Layers/SessionCredentialService.ts)
- [`apps/server/src/ws.ts`](../../apps/server/src/ws.ts)
- [`apps/server/src/orchestration/Services/OrchestrationEngine.ts`](../../apps/server/src/orchestration/Services/OrchestrationEngine.ts)
- [`apps/server/src/providerManager.ts`](../../apps/server/src/providerManager.ts)
- [`apps/web/src/environments/primary/auth.ts`](../../apps/web/src/environments/primary/auth.ts)
- [`apps/web/src/environments/remote/api.ts`](../../apps/web/src/environments/remote/api.ts)
- [`apps/web/src/rpc/wsTransport.ts`](../../apps/web/src/rpc/wsTransport.ts)
