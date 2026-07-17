/**
 * OrgX Gateway Protocol v1/v2/v3 — wire message types.
 *
 * Each plugin peer implements this protocol directly against OrgX server.
 * See PROTOCOL.md for the wire spec; this file is the TypeScript mirror.
 */
import type { ExecutionEnvelope, ExecutionFinalizationRequest, ExecutionResult } from './execution.js';
/** Backward-compatible default until gateway servers advertise v2. */
export declare const PROTOCOL_VERSION: 1;
export declare const LATEST_PROTOCOL_VERSION: 3;
export declare const SUPPORTED_PROTOCOL_VERSIONS: readonly [1, 2, 3];
export type ProtocolVersion = (typeof SUPPORTED_PROTOCOL_VERSIONS)[number];
export type TaskDriver = 'claude_code' | 'codex' | 'opencode';
export type DispatchableTask = {
    title: string;
    description?: string;
    repo_path?: string;
    workspace_id?: string;
    initiative_id?: string;
    workstream_id?: string;
    skill_ids?: string[];
    driver: TaskDriver;
};
export type TaskDispatchV1Message = {
    kind: 'task.dispatch';
    run_id: string;
    task: DispatchableTask;
    idempotency_key: string;
    timeout_seconds: number;
};
export type TaskDispatchV2Message = {
    kind: 'task.dispatch';
    protocol_version: 2;
    run_id: string;
    task: DispatchableTask;
    execution_envelope: ExecutionEnvelope;
    idempotency_key: string;
    timeout_seconds: number;
};
export type TaskDispatchMessage = TaskDispatchV1Message | TaskDispatchV2Message;
export type TaskCancelMessage = {
    kind: 'task.cancel';
    run_id: string;
    reason?: string;
};
export type AttentionResolutionMessage = {
    kind: 'attention.resolve';
    protocol_version: 3;
    decision_id: string;
    run_id: string;
    driver?: TaskDriver;
    session_handle?: string;
    idempotency_key: string;
    resolution: {
        status: 'approved' | 'declined' | 'cancelled';
        answer?: unknown;
        note?: string | null;
        option_id?: string | null;
        option_ids?: string[];
        context?: Record<string, unknown>;
    };
};
export type ServerToPeerMessage = TaskDispatchMessage | TaskCancelMessage | AttentionResolutionMessage;
export type TaskStepKind = 'file_edit' | 'tool_call' | 'chat' | 'skill_fire';
export type TaskStartedMessage = {
    kind: 'task.started';
    run_id: string;
    started_at: string;
    session_handle?: string;
};
export type TaskStepMessage = {
    kind: 'task.step';
    run_id: string;
    step: {
        kind: TaskStepKind;
        summary: string;
        evidence_ref?: string;
        confidence?: number;
    };
};
export type TaskDeviationMessage = {
    kind: 'task.deviation';
    run_id: string;
    skill_id: string;
    evidence_kind: string;
    evidence_ref: string;
    dedupe_key: string;
    severity?: 'info' | 'warn' | 'error';
};
export type OutcomeKind = 'shipped' | 'blocked' | 'abandoned' | 'awaiting_review';
export type Provider = 'anthropic' | 'openai' | 'other';
export type SourceSubType = 'subscription' | 'api_key' | 'enterprise_key';
export type TaskCompletedMessage = {
    kind: 'task.completed';
    run_id: string;
    outcome_kind: OutcomeKind;
    started_at: string;
    first_response_at?: string;
    completed_at: string;
    tokens_used: number;
    provider: Provider;
    source_sub_type: SourceSubType;
    source_driver: TaskDriver;
    cost_estimate_cents: number;
    saved_estimate_cents?: number;
};
export type TaskResultMessage = {
    kind: 'task.result';
    protocol_version: 2;
    run_id: string;
    execution_result: ExecutionResult;
    provider_attribution?: {
        provider: Provider;
        source_sub_type: SourceSubType;
        source_driver: TaskDriver;
        tokens_used: number;
        cost_estimate_cents: number;
        saved_estimate_cents?: number;
    };
};
/**
 * SDK-local driver handoff. This is never written to the Gateway WebSocket.
 * PeerClient exchanges it for the OrgX-issued TaskResultMessage.
 */
export type TaskFinalizationMessage = {
    kind: 'task.finalize';
    run_id: string;
    execution_finalization_request: ExecutionFinalizationRequest;
    provider_attribution?: TaskResultMessage['provider_attribution'];
};
export type TaskFailedMessage = {
    kind: 'task.failed';
    run_id: string;
    reason: string;
    recoverable: boolean;
};
export type TaskSuspendedMessage = {
    kind: 'task.suspended';
    run_id: string;
    reason: 'attention';
    session_handle?: string;
    detail?: string;
};
export type ContinuationState = 'answer_received' | 'resuming' | 'resumed' | 'resume_failed' | 'cancelled';
export type ContinuationReceiptMessage = {
    kind: 'continuation.receipt';
    protocol_version: 3;
    run_id: string;
    decision_id: string;
    idempotency_key: string;
    state: ContinuationState;
    session_handle?: string;
    detail?: string;
    occurred_at: string;
};
export type PeerToServerMessage = TaskStartedMessage | TaskStepMessage | TaskDeviationMessage | TaskCompletedMessage | TaskResultMessage | TaskFailedMessage | TaskSuspendedMessage | ContinuationReceiptMessage;
export type DriverOutboundMessage = Exclude<PeerToServerMessage, TaskResultMessage> | TaskFinalizationMessage;
export declare function isV2TaskDispatch(message: TaskDispatchMessage): message is TaskDispatchV2Message;
export declare function isTaskResult(message: PeerToServerMessage): message is TaskResultMessage;
export declare function isTaskFinalization(message: DriverOutboundMessage): message is TaskFinalizationMessage;
export type ProtocolMessage = ServerToPeerMessage | PeerToServerMessage;
//# sourceMappingURL=protocol.d.ts.map