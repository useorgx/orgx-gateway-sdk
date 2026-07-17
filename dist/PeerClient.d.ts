/**
 * Durable client for one OrgX gateway peer.
 *
 * The client owns four guarantees that every editor integration needs:
 * capped-backoff reconnect, dispatch idempotency, cancellation, and an HTTP
 * receipt fallback when a completion cannot be delivered over the socket.
 */
import type { Driver } from './Driver.js';
import { type PeerToServerMessage, type ProtocolVersion, type ServerToPeerMessage } from './protocol.js';
export type WebSocketEvent = {
    code?: number;
    reason?: string;
    data?: unknown;
};
export interface WebSocketLike {
    addEventListener(type: 'open' | 'close' | 'error' | 'message', listener: (event: WebSocketEvent) => void): void;
    close(code?: number, reason?: string): void;
    send(data: string): void;
}
export type ReconnectPolicy = {
    /** Defaults to continuous retry. Set a finite value for short-lived clients. */
    maxAttempts?: number;
    initialDelayMs?: number;
    maxDelayMs?: number;
    jitterRatio?: number;
};
export type PeerClientConfig = {
    /** Base URL, e.g. `wss://useorgx.com`. */
    baseUrl: string;
    /** OrgX API key with `gateway:drive` scope. */
    apiKey: string;
    workspaceId: string;
    pluginId: string;
    /** Which drivers this peer registers. Typically a single-element array. */
    drivers: Driver[];
    /** Defaults to v1 until the connected gateway advertises v2 support. */
    protocolVersion?: ProtocolVersion;
    /** Optional installation identity advertised to the gateway. */
    installationId?: string;
    /**
     * Stable process identity advertised to the gateway. Managed autonomous
     * runners must supply the same value in their heartbeat and stream URL.
     */
    runnerInstanceId?: string;
    /** Called instead of the default task router when supplied. */
    onMessage?: (msg: ServerToPeerMessage) => void;
    onOpen?: () => void;
    onClose?: (code: number, reason: string) => void;
    onError?: (err: unknown) => void;
    onReconnectScheduled?: (attempt: number, delayMs: number) => void;
    reconnect?: ReconnectPolicy | false;
    /** Injectable boundaries keep the lifecycle deterministic in tests. */
    webSocketFactory?: (url: string, protocols: string[]) => WebSocketLike;
    fetch?: typeof globalThis.fetch;
    random?: () => number;
    setTimeout?: typeof globalThis.setTimeout;
    clearTimeout?: typeof globalThis.clearTimeout;
};
export type PeerClientState = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'closing' | 'closed';
export declare class PeerClient {
    private readonly config;
    private ws;
    private state;
    private readonly driversById;
    private readonly completedDispatches;
    private readonly inFlightDispatches;
    private readonly pendingReceipts;
    private readonly pendingContinuationReceipts;
    private readonly handledAttentionResolutions;
    private readonly suspendedDispatches;
    private reconnectAttempt;
    private reconnectTimer;
    private manualClose;
    constructor(config: PeerClientConfig);
    get currentState(): PeerClientState;
    get advertisedDrivers(): string[];
    connect(): void;
    disconnect(code?: number, reason?: string): void;
    send(message: PeerToServerMessage): void;
    private openSocket;
    private scheduleReconnect;
    private clearReconnect;
    private defaultHandle;
    private resolveAttention;
    private executeDispatch;
    private sendProtocolFailure;
    private sendSafely;
    private rememberCompleted;
    private completeSuspendedRun;
    private flushPendingReceipts;
    private postReceipt;
    private deliverContinuationReceipt;
    private postContinuationReceipt;
}
//# sourceMappingURL=PeerClient.d.ts.map