# Auth And Pairing

This is the core access model for T3 Code.

## Concepts

T3 Code distinguishes between:

- bootstrap credentials, which are used once to establish trust
- session credentials, which are used for ordinary authenticated requests
- WebSocket tokens, which are short-lived and used for the WS upgrade path

The shared contract types live in [`packages/contracts/src/auth.ts`](../../packages/contracts/src/auth.ts).

## Auth Posture

The server advertises a `ServerAuthDescriptor` containing:

- `policy`
- `bootstrapMethods`
- `sessionMethods`
- `sessionCookieName`

This allows the UI to decide whether it should show:

- a silent desktop bootstrap path
- a one-time pairing token form
- a remote bearer bootstrap flow

## Bootstrap Modes

Current bootstrap methods:

- `desktop-bootstrap`
- `one-time-token`

Current session methods:

- `browser-session-cookie`
- `bearer-session-token`

### Desktop-Managed Local Mode

When the desktop app provides a bootstrap token, the browser-side primary environment can attempt silent auth on startup.

Relevant files:

- [`apps/web/src/environments/primary/auth.ts`](../../apps/web/src/environments/primary/auth.ts)
- [`apps/server/src/startupAccess.ts`](../../apps/server/src/startupAccess.ts)
- [`apps/server/src/auth/Layers/ServerAuth.ts`](../../apps/server/src/auth/Layers/ServerAuth.ts)

### Manual Pairing

The `/pair` route accepts a one-time credential, either from the URL hash or from direct input.

Relevant files:

- [`apps/web/src/routes/pair.tsx`](../../apps/web/src/routes/pair.tsx)
- [`apps/web/src/components/auth/PairingRouteSurface.tsx`](../../apps/web/src/components/auth/PairingRouteSurface.tsx)
- [`apps/web/src/pairingUrl.ts`](../../apps/web/src/pairingUrl.ts)

The URL convention is:

- token stored in the hash as `#token=...`
- query-string tokens are still accepted as a backward-compatible fallback

### Remote Pairing

Remote access uses bearer auth:

1. The client resolves the remote pairing target from a pairing URL or host + code.
2. The client exchanges the bootstrap credential for a bearer session.
3. The client fetches the session state using the bearer token.
4. The client requests a short-lived WebSocket token.
5. The client connects to the WebSocket endpoint with `?wsToken=...`.

Relevant files:

- [`apps/web/src/environments/remote/target.ts`](../../apps/web/src/environments/remote/target.ts)
- [`apps/web/src/environments/remote/api.ts`](../../apps/web/src/environments/remote/api.ts)

## Server Endpoints

Auth endpoints exposed by the server:

- `GET /api/auth/session`
- `POST /api/auth/bootstrap`
- `POST /api/auth/bootstrap/bearer`
- `POST /api/auth/ws-token`
- `POST /api/auth/pairing-token`
- `GET /api/auth/pairing-links`
- `POST /api/auth/pairing-links/revoke`
- `GET /api/auth/clients`
- `POST /api/auth/clients/revoke`
- `POST /api/auth/clients/revoke-others`

These are wired in [`apps/server/src/auth/http.ts`](../../apps/server/src/auth/http.ts).

## Session Model

Session issuance is handled by [`apps/server/src/auth/Layers/SessionCredentialService.ts`](../../apps/server/src/auth/Layers/SessionCredentialService.ts).

Important properties:

- session tokens are signed
- session TTL is explicit
- sessions are stored in persistence and can be revoked
- connected state is tracked separately from issued state
- active sessions expose client metadata but not raw tokens

### Browser Cookie Sessions

`POST /api/auth/bootstrap` consumes a bootstrap credential and issues a browser session cookie.

### Bearer Sessions

`POST /api/auth/bootstrap/bearer` consumes a bootstrap credential and returns a bearer token for non-cookie clients.

### WebSocket Tokens

`POST /api/auth/ws-token` issues a short-lived token used only to authenticate the WS upgrade.

## Pairing Links

Pairing links are stored as short-lived bootstrap credentials.

The control plane supports:

- creating pairing links
- listing active pairing links
- revoking a pairing link
- listing client sessions
- revoking a client session
- revoking all other client sessions

The control plane is implemented in [`apps/server/src/auth/Layers/AuthControlPlane.ts`](../../apps/server/src/auth/Layers/AuthControlPlane.ts).

## Auth Access Stream

The server publishes auth changes over the auth access stream so the UI can update pairing links and client session lists live.

Stream events include:

- snapshot
- pairing link upsert/remove
- client session upsert/remove

The stream plumbing lives in [`apps/server/src/ws.ts`](../../apps/server/src/ws.ts) and the schema lives in [`packages/contracts/src/auth.ts`](../../packages/contracts/src/auth.ts).

## Invariants

- pairing credentials are short-lived and one-time
- session tokens are the durable credential used after auth succeeds
- WebSocket tokens are short-lived and should not be reused as general auth
- owner/client roles are preserved through the auth flow
- auth failure should degrade to a clear re-pairing path, not a broken shell
