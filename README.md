# @useorgx/orgx-gateway-sdk

Client SDK for OrgX Gateway Protocol v1/v2/v3. Protocol v2 adds an opt-in,
proof-carrying execution boundary. Protocol v3 adds resumable human attention
with delivery receipts. v1 remains the default during the compatibility
window.

License: MIT.

**Each editor plugin is a self-sufficient peer.** It opens its own authenticated WebSocket to OrgX server and implements the protocol directly. No central broker. This package is a shared TypeScript client + Driver interface, not a hub.

See [PEER_ARCHITECTURE.md](./PEER_ARCHITECTURE.md) for the full model and [PROTOCOL.md](./PROTOCOL.md) for the wire spec.

## Minimal peer

```ts
import { PeerClient, type Driver } from '@useorgx/orgx-gateway-sdk';

class ClaudeCodeDriver implements Driver {
  readonly id = 'claude_code' as const;
  async detect() { return { installed: true, authenticated: true }; }
  async *dispatch(task, ctx) {
    yield { kind: 'task.started', run_id: ctx.run_id, started_at: new Date().toISOString() };
    // ... run in editor session, yield task.step / task.deviation / task.completed
  }
  async cancel() { /* ... */ }
  async probe() { return { subscription_active: true, session_alive: true }; }
}

const client = new PeerClient({
  baseUrl: 'wss://useorgx.com',
  apiKey: process.env.ORGX_API_KEY!,
  workspaceId: 'ws-uuid',
  pluginId: '@useorgx/claude-code-plugin',
  drivers: [new ClaudeCodeDriver()],
});

client.connect();
```

Peer clients retry transient network and server-restart closures continuously
with exponential backoff capped at 30 seconds. Set `reconnect.maxAttempts` when
a short-lived integration needs a finite retry window; authentication and
protocol close codes remain non-retryable.

## Resumable attention in v3

A v3 driver can implement `resolveAttention` to restore the session that
raised a question, apply the human answer, and yield truthful continuation
transitions:

```ts
async *resolveAttention(message) {
  yield { state: 'resuming' };
  await resumeCliSession(message.session_handle, message.resolution.answer);
  yield { state: 'resumed', session_handle: message.session_handle };
}
```

`PeerClient` emits `answer_received` before invoking the driver, then forwards
its transitions as `continuation.receipt` messages. A missing implementation,
ambiguous multi-driver peer, or thrown error becomes `resume_failed`. Receipts
fall back to the durable attention HTTP endpoint when the socket is down.

## Proof-carrying v2 finalization

In v2, a driver does not construct its own successful `ExecutionResult`. It
yields one SDK-local `task.finalize` message containing a content-hashed
`ExecutionFinalizationRequest` with persisted action and verification source
IDs. `PeerClient` calls OrgX's idempotent finalization endpoint, validates the
signed response and envelope lineage, and only then emits `task.result`.

This keeps the producer/verifier boundary explicit: plugins report evidence
sources; the OrgX control plane resolves those sources, builds the Proof
Packet, and issues the terminal result. Protocol v1 remains the default until
a plugin can supply real canonical source IDs.

## Status

Alpha — shipped as part of the Sovereign Execution initiative (993cabeb).
