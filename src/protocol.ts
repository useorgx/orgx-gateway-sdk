/**
 * OrgX Gateway Protocol v1 — wire message types.
 *
 * Each plugin peer implements this protocol directly against OrgX server.
 * See PROTOCOL.md for the wire spec; this file is the TypeScript mirror.
 */

export const PROTOCOL_VERSION = 1 as const;

// ─── Dispatchable task ─────────────────────────────────────────────────────

export type TaskDriver = 'claude_code' | 'codex' | 'opencode';

export type DispatchableTask = {
  title: string;
  description?: string;
  repo_path?: string;
  skill_ids?: string[];
  driver: TaskDriver;
};

// ─── Server → Peer ─────────────────────────────────────────────────────────

export type TaskDispatchMessage = {
  kind: 'task.dispatch';
  run_id: string;
  task: DispatchableTask;
  idempotency_key: string;
  timeout_seconds: number;
};

export type TaskCancelMessage = {
  kind: 'task.cancel';
  run_id: string;
  reason?: string;
};

export type ServerToPeerMessage = TaskDispatchMessage | TaskCancelMessage;

// ─── Peer → Server ─────────────────────────────────────────────────────────

export type TaskStepKind =
  | 'file_edit'
  | 'tool_call'
  | 'chat'
  | 'skill_fire';

export type TaskStartedMessage = {
  kind: 'task.started';
  run_id: string;
  started_at: string; // ISO
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

export type OutcomeKind =
  | 'shipped'
  | 'blocked'
  | 'abandoned'
  | 'awaiting_review';

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

export type TaskFailedMessage = {
  kind: 'task.failed';
  run_id: string;
  reason: string;
  recoverable: boolean;
};

export type PeerToServerMessage =
  | TaskStartedMessage
  | TaskStepMessage
  | TaskDeviationMessage
  | TaskCompletedMessage
  | TaskFailedMessage;

// ─── Discriminated union ───────────────────────────────────────────────────

export type ProtocolMessage = ServerToPeerMessage | PeerToServerMessage;
