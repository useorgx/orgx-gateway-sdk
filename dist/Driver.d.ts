/**
 * Driver interface — an implementation detail INSIDE a plugin peer.
 *
 * A plugin peer opens its own WebSocket to OrgX server, receives
 * task.dispatch messages, and delegates execution to its driver.
 * The server never talks to drivers directly; drivers are not plugins
 * of the gateway. The peer owns the driver entirely.
 */
import type { AttentionResolutionMessage, ContinuationState, DriverOutboundMessage, DispatchableTask, ProtocolVersion, TaskDriver } from './protocol.js';
import type { ExecutionEnvelope } from './execution.js';
export type DriverStatus = {
    installed: boolean;
    authenticated: boolean;
    version?: string;
    subscription_active?: boolean;
    error?: string;
};
export type DriverProbe = {
    subscription_active: boolean;
    session_alive: boolean;
    queue_depth?: number;
};
/**
 * A driver reports only the client-local continuation transition. PeerClient
 * supplies the canonical decision, run, protocol, and idempotency fields.
 */
export type DriverContinuationUpdate = {
    state: ContinuationState;
    session_handle?: string;
    detail?: string;
    occurred_at?: string;
};
export interface Driver {
    /** Canonical driver id — same string used in `source_driver` + `task.driver`. */
    readonly id: TaskDriver;
    /** Is the editor installed + authed on this machine? */
    detect(): Promise<DriverStatus>;
    /**
     * Execute the task in the editor session. Progress and v1 messages are
     * forwarded to the Gateway. For v2, the driver yields one SDK-local
     * task.finalize request; PeerClient exchanges it for the OrgX-issued result.
     *
     * Implementations should yield (at minimum):
     *   - one task.started as the first message
     *   - task.step events as work progresses
     *   - task.deviation when skill rules match
     *   - v1: exactly one task.completed at the end
     *   - v2: exactly one task.finalize with canonical source IDs at the end
     *   - task.failed when execution cannot reach a terminal candidate
     */
    dispatch(task: DispatchableTask, context: {
        run_id: string;
        idempotency_key: string;
        protocol_version: ProtocolVersion;
        execution_envelope?: ExecutionEnvelope;
    }): AsyncIterable<DriverOutboundMessage>;
    /** Cancel an in-flight run. Idempotent. */
    cancel(run_id: string): Promise<void>;
    /**
     * Apply a human answer to the exact paused client session. Optional because
     * not every CLI exposes a resumable interaction API. Drivers that implement
     * it should yield `resuming` before starting work and then `resumed` only
     * after the client has accepted the continuation. Throwing is reported as
     * `resume_failed` without losing the persisted answer in OrgX.
     */
    resolveAttention?(message: AttentionResolutionMessage): AsyncIterable<DriverContinuationUpdate | DriverOutboundMessage>;
    /** Lightweight liveness probe; called periodically by the peer. */
    probe(): Promise<DriverProbe>;
}
//# sourceMappingURL=Driver.d.ts.map