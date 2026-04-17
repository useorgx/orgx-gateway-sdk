# Peer Architecture

**Each editor plugin is a self-sufficient peer.** It opens its own authenticated WebSocket to OrgX server, receives `task.dispatch` intents, runs the task in its editor session, and posts its own receipts + deviations + license heartbeat.

There is no central broker. `@useorgx/orgx-gateway-sdk` is a **shared client library**, not a hub. It ships the typed message shapes, the Driver interface, and a skeleton `PeerClient` that manages a single WebSocket connection. Each plugin consumes this library independently.

## Peers today

| Plugin | Driver inside | Repo |
|---|---|---|
| `orgx-claude-code-plugin` | `ClaudeCodeDriver` | existing |
| `orgx-codex-plugin` | `CodexDriver` | existing |
| `orgx-opencode-plugin` | `OpenCodeDriver` | new in this initiative |

OpenClaw's original "broker" role is deprecated. Its Claude-Code-specific dispatch logic migrates into `orgx-claude-code-plugin`. Shared protocol code lives here. Nothing in OpenClaw is load-bearing anymore.

## Lifecycle

```
1. Plugin boot:
     const client = new PeerClient({
       baseUrl: 'wss://useorgx.com',
       apiKey: 'oxk_...', // scope: gateway:drive
       workspaceId, pluginId: '@useorgx/claude-code-plugin',
       drivers: [new ClaudeCodeDriver()],
     });
     client.connect();

2. Server emits task.dispatch over the open WS.

3. PeerClient.defaultHandle matches task.driver against the driver map and
   awaits driver.dispatch(). Each yielded PeerToServerMessage is serialized
   and sent back.

4. Plugin posts execution_receipt via POST /api/v1/runs/:id/receipt (outside
   the WS stream — the receipt survives connection drops).

5. Plugin posts POST /api/v1/licenses/heartbeat weekly. An unlicensed or
   stale plugin gets 402 on deviation endpoints and surfaces a degraded banner.
```

## Invariants

- **One WS per peer per workspace.** Two browser tabs = still one peer process (the plugin, not the UI).
- **Driver is a plugin implementation detail.** The server never names a specific driver; it names `task.driver` which the plugin routes. If a peer doesn't have that driver, it returns `task.failed` with `recoverable: false` so the server can pick a different peer.
- **Plugin is identified by `plugin_id` + `installation_id`.** The server tracks each in `gateway_connections`.
- **No peer depends on another.** If the OpenCode plugin is killswitched, the Claude Code plugin keeps running. Bugs don't cascade.
- **Protocol version is negotiated at connect.** The client sends `orgx.v1` as a WebSocket subprotocol. If the server only supports v2, the handshake fails cleanly.
