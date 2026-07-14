# OrgX Gateway Protocol v1/v2 — Wire Spec

Supported versions: `1` and `2`. Subprotocol strings: `orgx.v1` and
`orgx.v2`.

The shared client defaults to v1 until the gateway advertises v2 support. A
peer opts into v2 with `protocolVersion: 2`; this keeps the migration additive
and prevents a package upgrade from silently changing the wire protocol.

## Connection

```
GET wss://useorgx.com/api/v1/gateway/stream
Sec-WebSocket-Protocol: orgx.v1, bearer.<oxk_api_key>
Query params:
  workspace_id=<uuid>
  plugin_id=<string>            e.g. @useorgx/claude-code-plugin
  drivers=claude_code,codex     comma-separated
```

The peer offers two subprotocols in the WebSocket handshake:

- `orgx.v<N>` — declares which protocol version it speaks
- `bearer.<apiKey>` — bearer auth payload (WebSocket API can't set headers)

The server accepts exactly one protocol version per connection. A mismatch closes the socket with code `4000` and reason `protocol-version-unsupported`. See `PeerClient.ts` for the client side.

## Message envelope

Every frame is a single JSON object with a `kind` discriminator. See `src/protocol.ts` for exhaustive typed definitions.

### Server → Peer

- `task.dispatch` — run this task on the named driver. In v2 it also carries a
  canonical, content-addressed `execution_envelope`.
- `task.cancel` — stop an in-flight run

### Peer → Server

- `task.started` — handshake confirming the peer accepted the dispatch
- `task.step` — incremental progress (file edit, tool call, skill fire)
- `task.deviation` — a skill rule matched during execution
- `task.completed` — final outcome + token counts + provider attribution
- `task.failed` — unrecoverable (or recoverable + retryable) error
- `task.result` (v2) — the single typed terminal result carrying the canonical
  `ExecutionResult`, including work lineage, receipts, artifacts, proof,
  outcomes, costs, and disposition.

## v2 proof-carrying boundary

Protocol v2 preserves the familiar task description for driver UX while making
the execution contract authoritative:

```text
task.dispatch
  task                    legacy human-readable driver input
  execution_envelope      canonical authority/context/budget/proof contract

task.result
  execution_result        canonical terminal receipts/artifacts/outcomes/costs
```

The peer rejects v2 dispatches when the top-level run or idempotency identity
does not match the envelope. It also rejects terminal results whose run,
attempt, envelope digest, work lineage, proof requirements, or outcome
requirements do not match the dispatch. A v2 driver must emit exactly one
`task.result`; legacy `task.completed` remains the v1 terminal message.

## Idempotency

Every `task.dispatch` carries an `idempotency_key`. Peers MUST deduplicate by this key; re-dispatching the same key is a no-op.

`task.completed` (v1) or `task.result` (v2) is posted exactly once per
`run_id`. If a connection drops before the peer sends it, the peer MUST re-post
the terminal receipt via HTTP (survives WS outages). The server deduplicates on
`run_id`.

The shared `PeerClient` enforces both guarantees with a bounded in-memory
idempotency cache and `POST /api/v1/runs/:run_id/receipt` recovery. Transient
socket closes reconnect with bounded exponential backoff. Protocol, auth, and
intentional close codes do not reconnect.

## Authorization scopes

`oxk_` keys used for the gateway stream MUST have the `gateway:drive` scope. A narrower scope is rejected on handshake. Broader scopes (e.g. `workspace:admin`) are accepted but unnecessary — use the narrowest scope that works.

## Versioning + killswitches

- The server can disable a driver by rejecting `task.dispatch` for that driver with a structured error. The plugin surfaces a degraded banner and its UI shows the driver as unavailable.
- The server can kill an entire plugin by revoking its `plugin_licenses` row. Subsequent heartbeats return 402; deviation endpoints also return 402. The peer continues to render read-only views.
- Protocol version bumps require parallel support windows. v1 and v2 will coexist server-side for at least one quarter before v1 is retired.
