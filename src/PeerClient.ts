/**
 * Durable client for one OrgX gateway peer.
 *
 * The client owns four guarantees that every editor integration needs:
 * capped-backoff reconnect, dispatch idempotency, cancellation, and an HTTP
 * receipt fallback when a completion cannot be delivered over the socket.
 */

import type { Driver } from './Driver.js';
import { validateExecutionEnvelope } from './execution.js';
import {
  ExecutionFinalizationError,
  postExecutionFinalization,
} from './ExecutionFinalizer.js';
import {
  isTaskFinalization,
  isV2TaskDispatch,
  PROTOCOL_VERSION,
  type AttentionResolutionMessage,
  type ContinuationReceiptMessage,
  type PeerToServerMessage,
  type ProtocolVersion,
  type ProtocolMessage,
  type ServerToPeerMessage,
  type TaskCompletedMessage,
  type TaskDispatchMessage,
  type TaskFinalizationMessage,
  type TaskResultMessage,
} from './protocol.js';

export type WebSocketEvent = { code?: number; reason?: string; data?: unknown };

export interface WebSocketLike {
  addEventListener(
    type: 'open' | 'close' | 'error' | 'message',
    listener: (event: WebSocketEvent) => void
  ): void;
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

export type PeerClientState =
  | 'idle'
  | 'connecting'
  | 'open'
  | 'reconnecting'
  | 'closing'
  | 'closed';

const DEFAULT_RECONNECT = {
  // Local peers are supervised daemons. A normal production deploy can last
  // longer than eight attempts, so keep retrying with a capped delay until the
  // gateway returns or the client is stopped explicitly.
  maxAttempts: Number.POSITIVE_INFINITY,
  initialDelayMs: 500,
  maxDelayMs: 30_000,
  jitterRatio: 0.2,
} as const;
const IDEMPOTENCY_CACHE_LIMIT = 1_000;
const NON_RETRYABLE_CLOSE_CODES = new Set([1000, 4000, 4001, 4003, 4401, 4403]);
type TerminalReceiptMessage = TaskCompletedMessage | TaskResultMessage;

export class PeerClient {
  private ws: WebSocketLike | null = null;
  private state: PeerClientState = 'idle';
  private readonly driversById = new Map<string, Driver>();
  private readonly completedDispatches = new Map<string, string>();
  private readonly inFlightDispatches = new Map<string, Promise<void>>();
  private readonly pendingReceipts = new Map<string, TerminalReceiptMessage>();
  private readonly pendingContinuationReceipts = new Map<
    string,
    ContinuationReceiptMessage
  >();
  private readonly handledAttentionResolutions = new Set<string>();
  private readonly suspendedDispatches = new Map<string, string>();
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private manualClose = false;

  constructor(private readonly config: PeerClientConfig) {
    for (const driver of config.drivers) {
      this.driversById.set(driver.id, driver);
    }
  }

  get currentState(): PeerClientState {
    return this.state;
  }

  get advertisedDrivers(): string[] {
    return Array.from(this.driversById.keys());
  }

  connect(): void {
    if (this.state === 'open' || this.state === 'connecting') return;
    this.manualClose = false;
    this.openSocket();
  }

  disconnect(code = 1000, reason = 'client closing'): void {
    this.manualClose = true;
    this.clearReconnect();
    if (!this.ws || this.state === 'closed') {
      this.state = 'closed';
      return;
    }
    this.state = 'closing';
    this.ws.close(code, reason);
  }

  send(message: PeerToServerMessage): void {
    if (this.state !== 'open' || !this.ws) {
      throw new Error(`PeerClient.send called while state=${this.state}`);
    }
    this.ws.send(JSON.stringify(message));
  }

  private openSocket(): void {
    this.clearReconnect();
    this.state = this.reconnectAttempt > 0 ? 'reconnecting' : 'connecting';

    const url = new URL('/api/v1/gateway/stream', this.config.baseUrl);
    url.searchParams.set('workspace_id', this.config.workspaceId);
    url.searchParams.set('plugin_id', this.config.pluginId);
    url.searchParams.set('drivers', this.advertisedDrivers.join(','));
    if (this.config.installationId) {
      url.searchParams.set('installation_id', this.config.installationId);
    }

    const protocols = [
      `orgx.v${this.config.protocolVersion ?? PROTOCOL_VERSION}`,
      `bearer.${this.config.apiKey}`,
    ];
    const factory =
      this.config.webSocketFactory ??
      ((socketUrl: string, socketProtocols: string[]) =>
        new WebSocket(socketUrl, socketProtocols));

    try {
      const socket = factory(url.toString(), protocols);
      this.ws = socket;
      socket.addEventListener('open', () => {
        if (socket !== this.ws) return;
        this.state = 'open';
        this.reconnectAttempt = 0;
        this.config.onOpen?.();
        void this.flushPendingReceipts();
      });
      socket.addEventListener('close', (event) => {
        if (socket !== this.ws) return;
        this.ws = null;
        const code = event.code ?? 1006;
        const reason = event.reason ?? '';
        this.state = 'closed';
        this.config.onClose?.(code, reason);
        if (!this.manualClose && !NON_RETRYABLE_CLOSE_CODES.has(code)) {
          this.scheduleReconnect();
        }
      });
      socket.addEventListener('error', (event) => {
        this.config.onError?.(event);
      });
      socket.addEventListener('message', (event) => {
        try {
          const msg = JSON.parse(String(event.data)) as ServerToPeerMessage;
          if (this.config.onMessage) this.config.onMessage(msg);
          else void this.defaultHandle(msg);
        } catch (error) {
          this.config.onError?.(error);
        }
      });
    } catch (error) {
      this.ws = null;
      this.state = 'closed';
      this.config.onError?.(error);
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.config.reconnect === false || this.manualClose) return;
    const policy = { ...DEFAULT_RECONNECT, ...(this.config.reconnect ?? {}) };
    if (this.reconnectAttempt >= policy.maxAttempts) return;

    this.reconnectAttempt += 1;
    const exponential = Math.min(
      policy.maxDelayMs,
      policy.initialDelayMs * 2 ** (this.reconnectAttempt - 1)
    );
    const random = this.config.random ?? Math.random;
    const jitter = exponential * policy.jitterRatio * (random() * 2 - 1);
    const delayMs = Math.max(0, Math.round(exponential + jitter));
    this.state = 'reconnecting';
    this.config.onReconnectScheduled?.(this.reconnectAttempt, delayMs);
    const schedule = this.config.setTimeout ?? globalThis.setTimeout;
    this.reconnectTimer = schedule(() => this.openSocket(), delayMs);
  }

  private clearReconnect(): void {
    if (!this.reconnectTimer) return;
    const cancel = this.config.clearTimeout ?? globalThis.clearTimeout;
    cancel(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private async defaultHandle(msg: ProtocolMessage): Promise<void> {
    if (msg.kind === 'task.dispatch') {
      if (
        this.completedDispatches.has(msg.idempotency_key) ||
        this.inFlightDispatches.has(msg.idempotency_key) ||
        this.suspendedDispatches.has(msg.idempotency_key)
      ) {
        return;
      }
      const execution = this.executeDispatch(msg).finally(() => {
        this.inFlightDispatches.delete(msg.idempotency_key);
      });
      this.inFlightDispatches.set(msg.idempotency_key, execution);
      await execution;
      return;
    }

    if (msg.kind === 'task.cancel') {
      await Promise.all(
        Array.from(this.driversById.values()).map((driver) =>
          driver.cancel(msg.run_id).catch(() => undefined)
        )
      );
      return;
    }

    if (msg.kind === 'attention.resolve') {
      await this.resolveAttention(msg);
    }
  }

  private async resolveAttention(
    message: AttentionResolutionMessage
  ): Promise<void> {
    if (this.handledAttentionResolutions.has(message.idempotency_key)) return;
    this.handledAttentionResolutions.add(message.idempotency_key);

    const baseReceipt = {
      kind: 'continuation.receipt' as const,
      protocol_version: 3 as const,
      run_id: message.run_id,
      decision_id: message.decision_id,
      idempotency_key: message.idempotency_key,
    };
    if (message.resolution.status === 'cancelled') {
      await this.deliverContinuationReceipt({
        ...baseReceipt,
        state: 'cancelled',
        ...(message.session_handle
          ? { session_handle: message.session_handle }
          : {}),
        occurred_at: new Date().toISOString(),
      });
      return;
    }

    await this.deliverContinuationReceipt({
      ...baseReceipt,
      state: 'answer_received',
      ...(message.session_handle
        ? { session_handle: message.session_handle }
        : {}),
      occurred_at: new Date().toISOString(),
    });

    const candidates = message.driver
      ? [this.driversById.get(message.driver)].filter(
          (driver): driver is Driver => Boolean(driver)
        )
      : Array.from(this.driversById.values()).filter(
          (driver) => typeof driver.resolveAttention === 'function'
        );
    const driver =
      candidates.length === 1 && candidates[0]?.resolveAttention
        ? candidates[0]
        : null;
    if (!driver?.resolveAttention) {
      await this.deliverContinuationReceipt({
        ...baseReceipt,
        state: 'resume_failed',
        ...(message.session_handle
          ? { session_handle: message.session_handle }
          : {}),
        detail:
          candidates.length > 1
            ? 'Multiple resumable drivers are registered; attention.resolve must name a driver.'
            : 'This driver does not implement resumable attention.',
        occurred_at: new Date().toISOString(),
      });
      return;
    }

    let emitted = false;
    try {
      for await (const update of driver.resolveAttention(message)) {
        if ('kind' in update) {
          if (update.run_id !== message.run_id) {
            throw new Error('continuation message run id mismatch');
          }
          if (isTaskFinalization(update)) {
            throw new Error(
              'proof finalization after attention is not supported by this SDK version'
            );
          }
          this.sendSafely(update);
          if (update.kind === 'task.completed') {
            this.completeSuspendedRun(message.run_id);
          }
          continue;
        }
        emitted = true;
        await this.deliverContinuationReceipt({
          ...baseReceipt,
          state: update.state,
          ...(update.session_handle ?? message.session_handle
            ? {
                session_handle:
                  update.session_handle ?? message.session_handle,
              }
            : {}),
          ...(update.detail ? { detail: update.detail } : {}),
          occurred_at: update.occurred_at ?? new Date().toISOString(),
        });
      }
      if (!emitted) {
        throw new Error('driver ended without a continuation state');
      }
    } catch (error) {
      await this.deliverContinuationReceipt({
        ...baseReceipt,
        state: 'resume_failed',
        ...(message.session_handle
          ? { session_handle: message.session_handle }
          : {}),
        detail: error instanceof Error ? error.message : String(error),
        occurred_at: new Date().toISOString(),
      });
    }
  }

  private async executeDispatch(
    msg: TaskDispatchMessage
  ): Promise<void> {
    const driver = this.driversById.get(msg.task.driver);
    if (!driver) {
      this.sendSafely({
        kind: 'task.failed',
        run_id: msg.run_id,
        reason: `No driver registered for '${msg.task.driver}'`,
        recoverable: false,
      });
      return;
    }

    const protocolVersion = isV2TaskDispatch(msg) ? 2 : 1;
    if (isV2TaskDispatch(msg)) {
      try {
        validateExecutionEnvelope(msg.execution_envelope);
        if (
          msg.execution_envelope.runId !== msg.run_id ||
          msg.execution_envelope.idempotencyKey !== msg.idempotency_key
        ) {
          throw new Error('dispatch identity does not match execution envelope');
        }
      } catch (error) {
        this.sendProtocolFailure(msg.run_id, error);
        return;
      }
    }

    let terminalResult: TerminalReceiptMessage | null = null;
    let finalization: TaskFinalizationMessage | null = null;
    let suspended = false;
    try {
      for await (const outbound of driver.dispatch(msg.task, {
        run_id: msg.run_id,
        idempotency_key: msg.idempotency_key,
        protocol_version: protocolVersion,
        ...(isV2TaskDispatch(msg)
          ? { execution_envelope: msg.execution_envelope }
          : {}),
      })) {
        if (outbound.kind === 'task.suspended') {
          if (terminalResult || finalization || suspended) {
            this.sendProtocolFailure(
              msg.run_id,
              new Error('driver emitted multiple terminal or suspended results')
            );
            return;
          }
          suspended = true;
          this.sendSafely(outbound);
        } else if (
          outbound.kind === 'task.completed' ||
          isTaskFinalization(outbound)
        ) {
          if (terminalResult || finalization || suspended) {
            this.sendProtocolFailure(
              msg.run_id,
              new Error('driver emitted multiple terminal results')
            );
            return;
          }
          if (isV2TaskDispatch(msg) !== isTaskFinalization(outbound)) {
            this.sendProtocolFailure(
              msg.run_id,
              new Error(`protocol v${protocolVersion} terminal result mismatch`)
            );
            return;
          }
          if (isTaskFinalization(outbound) && isV2TaskDispatch(msg)) {
            if (outbound.run_id !== msg.run_id) {
              this.sendProtocolFailure(
                msg.run_id,
                new Error('finalization request run id mismatch')
              );
              return;
            }
            finalization = outbound;
          } else if (outbound.kind === 'task.completed') {
            terminalResult = outbound;
          }
        } else {
          this.sendSafely(outbound);
        }
      }
      if (suspended) {
        this.suspendedDispatches.set(msg.idempotency_key, msg.run_id);
        return;
      }
      if (finalization && isV2TaskDispatch(msg)) {
        try {
          const finalized = await postExecutionFinalization(
            this.config,
            msg.execution_envelope,
            finalization.execution_finalization_request
          );
          terminalResult = {
            kind: 'task.result',
            protocol_version: 2,
            run_id: msg.run_id,
            execution_result: finalized.response.executionResult,
            ...(finalization.provider_attribution
              ? { provider_attribution: finalization.provider_attribution }
              : {}),
          };
        } catch (error) {
          this.sendProtocolFailure(
            msg.run_id,
            error,
            error instanceof ExecutionFinalizationError
              ? error.recoverable
              : false
          );
          return;
        }
      }
      if (!terminalResult) {
        this.sendProtocolFailure(
          msg.run_id,
          new Error('driver ended without a terminal result')
        );
        return;
      }
      this.rememberCompleted(msg.idempotency_key, msg.run_id);
      this.pendingReceipts.set(msg.run_id, terminalResult);
      try {
        this.send(terminalResult);
        this.pendingReceipts.delete(msg.run_id);
      } catch (error) {
        this.config.onError?.(error);
        await this.postReceipt(terminalResult);
      }
    } catch (error) {
      this.config.onError?.(error);
      this.sendProtocolFailure(msg.run_id, error, true);
    }
  }

  private sendProtocolFailure(
    runId: string,
    error: unknown,
    recoverable = false
  ): void {
    this.sendSafely({
      kind: 'task.failed',
      run_id: runId,
      reason: error instanceof Error ? error.message : String(error),
      recoverable,
    });
  }

  private sendSafely(message: PeerToServerMessage): void {
    try {
      this.send(message);
    } catch (error) {
      this.config.onError?.(error);
    }
  }

  private rememberCompleted(idempotencyKey: string, runId: string): void {
    this.completedDispatches.set(idempotencyKey, runId);
    while (this.completedDispatches.size > IDEMPOTENCY_CACHE_LIMIT) {
      const oldest = this.completedDispatches.keys().next().value as
        | string
        | undefined;
      if (!oldest) break;
      this.completedDispatches.delete(oldest);
    }
  }

  private completeSuspendedRun(runId: string): void {
    for (const [idempotencyKey, suspendedRunId] of this.suspendedDispatches) {
      if (suspendedRunId !== runId) continue;
      this.suspendedDispatches.delete(idempotencyKey);
      this.rememberCompleted(idempotencyKey, runId);
    }
  }

  private async flushPendingReceipts(): Promise<void> {
    for (const receipt of this.pendingReceipts.values()) {
      await this.postReceipt(receipt);
    }
    for (const receipt of this.pendingContinuationReceipts.values()) {
      await this.postContinuationReceipt(receipt);
    }
  }

  private async postReceipt(receipt: TerminalReceiptMessage): Promise<void> {
    const request = this.config.fetch ?? globalThis.fetch;
    if (!request) return;
    const base = this.config.baseUrl.replace(/^ws:/, 'http:').replace(/^wss:/, 'https:');
    const url = new URL(
      `/api/v1/runs/${encodeURIComponent(receipt.run_id)}/receipt`,
      base
    );
    try {
      const response = await request(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': receipt.run_id,
        },
        body: JSON.stringify(receiptBody(receipt)),
      });
      if (!response.ok) {
        throw new Error(`receipt recovery failed with ${response.status}`);
      }
      this.pendingReceipts.delete(receipt.run_id);
    } catch (error) {
      this.config.onError?.(error);
    }
  }

  private async deliverContinuationReceipt(
    receipt: ContinuationReceiptMessage
  ): Promise<void> {
    const receiptKey = `${receipt.decision_id}:${receipt.state}`;
    this.pendingContinuationReceipts.set(receiptKey, receipt);
    try {
      this.send(receipt);
    } catch (error) {
      this.config.onError?.(error);
    }
    // Persist independently of the WebSocket. v3 can therefore roll out to
    // peers before every gateway relay knows how to consume receipt frames,
    // and a successful socket write is never mistaken for durable acceptance.
    await this.postContinuationReceipt(receipt);
  }

  private async postContinuationReceipt(
    receipt: ContinuationReceiptMessage
  ): Promise<void> {
    const request = this.config.fetch ?? globalThis.fetch;
    if (!request) return;
    const base = this.config.baseUrl
      .replace(/^ws:/, 'http:')
      .replace(/^wss:/, 'https:');
    const url = new URL(
      `/api/client/live/attention/${encodeURIComponent(receipt.decision_id)}`,
      base
    );
    const receiptKey = `${receipt.decision_id}:${receipt.state}`;
    try {
      const response = await request(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': `${receipt.idempotency_key}:${receipt.state}`,
        },
        body: JSON.stringify({
          state: receipt.state,
          idempotency_key: receipt.idempotency_key,
          session_handle: receipt.session_handle,
          detail: receipt.detail,
          occurred_at: receipt.occurred_at,
        }),
      });
      if (!response.ok) {
        throw new Error(
          `continuation receipt recovery failed with ${response.status}`
        );
      }
      this.pendingContinuationReceipts.delete(receiptKey);
    } catch (error) {
      this.config.onError?.(error);
    }
  }
}

function receiptBody(receipt: TerminalReceiptMessage): Record<string, unknown> {
  if (receipt.kind === 'task.result') {
    return {
      protocol_version: 2,
      execution_result: receipt.execution_result,
      provider_attribution: receipt.provider_attribution ?? null,
      outcome_kind: receipt.execution_result.disposition,
      completed_at: receipt.execution_result.completedAt,
      metadata: { recovered_from: 'gateway_socket' },
    };
  }
  return {
    provider: receipt.provider,
    source_sub_type: receipt.source_sub_type,
    source_driver: receipt.source_driver,
    started_at: receipt.started_at,
    first_response_at: receipt.first_response_at ?? null,
    completed_at: receipt.completed_at,
    tokens_used: receipt.tokens_used,
    cost_estimate_cents: receipt.cost_estimate_cents,
    saved_estimate_cents: receipt.saved_estimate_cents ?? 0,
    outcome_kind: receipt.outcome_kind,
    metadata: { recovered_from: 'gateway_socket' },
  };
}
