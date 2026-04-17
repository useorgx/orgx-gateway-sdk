# @orgx/gateway-sdk

Client SDK for OrgX Gateway Protocol v1.

**Each editor plugin is a self-sufficient peer.** It opens its own authenticated WebSocket to OrgX server and implements the protocol directly. No central broker. This package is a shared TypeScript client + Driver interface, not a hub.

See [PEER_ARCHITECTURE.md](./PEER_ARCHITECTURE.md) for the full model and [PROTOCOL.md](./PROTOCOL.md) for the wire spec.

## Minimal peer

```ts
import { PeerClient, type Driver } from '@orgx/gateway-sdk';

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

## Status

Alpha — shipped as part of the Sovereign Execution initiative (993cabeb).
