# Transport And RPC

## Transport Boundary

The browser talks to the backend over WebSocket RPC.

The client transport lives in:

- [`apps/web/src/rpc/wsTransport.ts`](../../apps/web/src/rpc/wsTransport.ts)
- [`apps/web/src/rpc/protocol.ts`](../../apps/web/src/rpc/protocol.ts)

The server-side route handling lives in:

- [`apps/server/src/ws.ts`](../../apps/server/src/ws.ts)
- [`packages/contracts/src/rpc.ts`](../../packages/contracts/src/rpc.ts)

## Connection Flow

1. The browser resolves the WebSocket URL.
2. A socket is opened against `/ws`.
3. The RPC protocol is layered on top of the socket.
4. Requests and streams are multiplexed through the Effect RPC layer.
5. The client reconnects on transient transport failure.

The WebSocket URL may be derived from:

- the local server origin
- a remote host/base URL
- a bearer-authenticated remote environment

## WebSocket Authentication

Server-side upgrade authentication accepts either:

- a session cookie / bearer session token
- a `wsToken` query parameter

The `wsToken` path is used for short-lived upgrade authorization.

## RPC Method Groups

The shared contract splits RPC into clear groups:

- project registry
- shell/editor actions
- filesystem browsing
- git actions
- terminal actions
- server config/settings
- streaming subscriptions for git, terminal, server config, lifecycle, and auth access

The WS method catalog is defined in [`packages/contracts/src/rpc.ts`](../../packages/contracts/src/rpc.ts).

## Reliability Expectations

The transport layer is designed to be resilient:

- reconnect on transient socket failure
- clear tracked RPC requests when the connection resets
- preserve subscription semantics across reconnects when possible
- keep request/response correlation explicit

## Server Events

The backend pushes domain updates over the following channels:

- server lifecycle
- server config
- auth access
- git status
- terminal events
- orchestration domain events projected into browser state

This keeps the UI stateful without requiring aggressive polling.
