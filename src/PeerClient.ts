/**
 * PeerClient — skeleton WebSocket client each plugin peer uses to talk to
 * OrgX server. One peer = one client = one connection.
 *
 * This MVP ships the connection lifecycle + typed send/recv. A full retry
 * policy with protocol-version negotiation + killswitch handling lands in
 * the next PR alongside the first real plugin adoption.
 */

import type { Driver } from './Driver.js';
import {
  PROTOCOL_VERSION,
  type PeerToServerMessage,
  type ProtocolMessage,
  type ServerToPeerMessage,
} from './protocol.js';

export type PeerClientConfig = {
  /** Base URL, e.g. `wss://useorgx.com` */
  baseUrl: string;
  /** OrgX API key with `gateway:drive` scope. */
  apiKey: string;
  workspaceId: string;
  pluginId: string;
  /** Which drivers this peer registers. Typically a single-element array. */
  drivers: Driver[];
  /** Called for every message the server sends; the default routes via
      #defaultHandle which matches on kind and delegates to the right driver. */
  onMessage?: (msg: ServerToPeerMessage) => void;
  /** Connection lifecycle hooks. */
  onOpen?: () => void;
  onClose?: (code: number, reason: string) => void;
  onError?: (err: unknown) => void;
};

export type PeerClientState = 'idle' | 'connecting' | 'open' | 'closing' | 'closed';

export class PeerClient {
  private ws: WebSocket | null = null;
  private state: PeerClientState = 'idle';
  private driversById = new Map<string, Driver>();

  constructor(private config: PeerClientConfig) {
    for (const d of config.drivers) {
      this.driversById.set(d.id, d);
    }
  }

  get currentState(): PeerClientState {
    return this.state;
  }

  connect(): void {
    if (this.state === 'open' || this.state === 'connecting') return;
    this.state = 'connecting';

    const url = new URL('/api/v1/gateway/stream', this.config.baseUrl);
    url.searchParams.set('workspace_id', this.config.workspaceId);
    url.searchParams.set('plugin_id', this.config.pluginId);
    url.searchParams.set(
      'drivers',
      Array.from(this.driversById.keys()).join(',')
    );
    // WebSocket API doesn't expose custom headers; pass bearer via subprotocol.
    const subprotocol = `bearer.${this.config.apiKey}`;
    const proto = `orgx.v${PROTOCOL_VERSION}`;

    // Browser WebSocket takes a single subprotocols string or array; include
    // both the bearer token and the protocol version so the server can reject
    // mismatched versions before the first message.
    this.ws = new WebSocket(url.toString(), [proto, subprotocol]);
    this.ws.addEventListener('open', () => {
      this.state = 'open';
      this.config.onOpen?.();
    });
    this.ws.addEventListener('close', (ev) => {
      this.state = 'closed';
      this.config.onClose?.(ev.code, ev.reason);
    });
    this.ws.addEventListener('error', (ev) => {
      this.config.onError?.(ev);
    });
    this.ws.addEventListener('message', (ev) => {
      try {
        const msg = JSON.parse(ev.data) as ServerToPeerMessage;
        if (this.config.onMessage) {
          this.config.onMessage(msg);
        } else {
          void this.defaultHandle(msg);
        }
      } catch (err) {
        this.config.onError?.(err);
      }
    });
  }

  disconnect(code = 1000, reason = 'client closing'): void {
    if (this.state === 'closed' || !this.ws) return;
    this.state = 'closing';
    this.ws.close(code, reason);
  }

  send(message: PeerToServerMessage): void {
    if (this.state !== 'open' || !this.ws) {
      throw new Error(`PeerClient.send called while state=${this.state}`);
    }
    this.ws.send(JSON.stringify(message));
  }

  /**
   * Default router: on `task.dispatch`, pick the driver matching task.driver,
   * run its async iterator, and stream each yielded message back to the server.
   */
  private async defaultHandle(msg: ProtocolMessage): Promise<void> {
    if (msg.kind === 'task.dispatch') {
      const driver = this.driversById.get(msg.task.driver);
      if (!driver) {
        this.send({
          kind: 'task.failed',
          run_id: msg.run_id,
          reason: `No driver registered for '${msg.task.driver}'`,
          recoverable: false,
        });
        return;
      }
      for await (const outbound of driver.dispatch(msg.task, {
        run_id: msg.run_id,
        idempotency_key: msg.idempotency_key,
      })) {
        this.send(outbound);
      }
      return;
    }

    if (msg.kind === 'task.cancel') {
      const drivers = Array.from(this.driversById.values());
      await Promise.all(drivers.map((d) => d.cancel(msg.run_id).catch(() => undefined)));
      return;
    }
  }
}
