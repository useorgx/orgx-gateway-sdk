# OrgX Gateway Protocol v1/v2/v3 — Wire Spec

Supported versions: `1`, `2`, and `3`. Subprotocol strings: `orgx.v1`,
`orgx.v2`, and `orgx.v3`.

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
  runner_instance_id=<string>   exact durable process identity (managed runners)
```

The peer offers two subprotocols in the WebSocket handshake:

- `orgx.v<N>` — declares which protocol version it speaks
- `bearer.<apiKey>` — bearer auth payload (WebSocket API can't set headers)

The server accepts exactly one protocol version per connection. A mismatch closes the socket with code `4000` and reason `protocol-version-unsupported`. See `PeerClient.ts` for the client side.

Compatibility peers may omit `runner_instance_id`. Managed autonomous runners,
including credential-activation candidates, MUST include it and MUST use the
same exact value as the top-level `runner_instance_id` in their license
heartbeat. The shared client accepts 1-160 characters matching
`^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$` and rejects an invalid supplied value
before opening a socket.

## Message envelope

Every frame is a single JSON object with a `kind` discriminator. See `src/protocol.ts` for exhaustive typed definitions.

### Server → Peer

- `task.dispatch` — run this task on the named driver. In v2 it also carries a
  canonical, content-addressed `execution_envelope`.
- `task.cancel` — stop an in-flight run
- `attention.resolve` (v3) — deliver a persisted human answer to the exact
  run/session that raised the question, permission, approval, or recovery ask

### Peer → Server

- `task.started` — handshake confirming the peer accepted the dispatch
- `task.step` — incremental progress (file edit, tool call, skill fire)
- `task.deviation` — a skill rule matched during execution
- `task.completed` — final outcome + token counts + provider attribution
- `task.failed` — unrecoverable (or recoverable + retryable) error
- `task.suspended` (v3) — the local process stopped at a preserved attention
  point; the run is neither failed nor complete
- `task.result` (v2) — the single typed terminal result carrying the canonical
  OrgX-issued `ExecutionResult`, including work lineage, receipts, artifacts,
  proof, outcomes, costs, and disposition.
- `continuation.receipt` (v3) — acknowledge `answer_received`, `resuming`,
  `resumed`, `resume_failed`, or `cancelled`; this is the source of truth for
  whether work actually moved after a person answered.

`task.finalize` is an SDK-local driver handoff, not a wire message. It carries
the content-hashed finalization request and canonical action/verification
source IDs. `PeerClient` posts it to OrgX before it can emit `task.result`.

## v2 proof-carrying boundary

Protocol v2 preserves the familiar task description for driver UX while making
the execution contract authoritative:

```text
task.dispatch
  task                    legacy human-readable driver input
  execution_envelope      canonical authority/context/budget/proof contract

driver task.finalize      local source references; never sent over WebSocket
  ↓ POST /api/v1/runs/:run_id/finalize
OrgX Proof Plane          resolves sources, signs proof, issues result
  ↓
task.result               canonical terminal receipts/artifacts/outcomes/costs
```

The peer rejects v2 dispatches when the top-level run or idempotency identity
does not match the envelope. A v2 driver must emit exactly one local
`task.finalize`; duplicate terminal candidates are rejected before any
finalization request is sent. The client validates the finalization request,
the OrgX-issued response digest, proof reference, result digest, and envelope
lineage before emitting `task.result`. Legacy `task.completed` remains the v1
terminal message.

## v3 resumable-attention boundary

Protocol v3 adds an interruption lifecycle without changing v1/v2 task
execution or finalization:

```text
client asks or needs permission
  -> OrgX attention record (waiting)
human answers in OrgX
  -> attention.resolve over the owning peer connection
peer persists answer_received
  -> driver restores the exact session/tool call
peer emits resuming
  -> CLI accepts the answer and work advances
peer emits resumed (or resume_failed with a reason)
  -> continued driver emits normal task.step and terminal task messages
```

`attention.resolve` includes a stable decision ID, run ID, optional driver and
session handle, the structured answer, and an idempotency key. `PeerClient`
deduplicates the resolution and wraps driver-local continuation updates in
canonical receipts. If the WebSocket is unavailable, it posts each receipt to
`/api/client/live/attention/:decision_id`, so UI state never has to infer
motion from a button click.

Drivers opt in with `resolveAttention`. A peer that cannot resume reports
`resume_failed`; it must not claim work is running. An OrgX-stored answer
remains available for polling even when push delivery or local continuation
fails.

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
- Protocol version bumps require parallel support windows. v1, v2, and v3
  coexist server-side; a peer opts into v3 only after its driver implements
  truthful continuation receipts.
