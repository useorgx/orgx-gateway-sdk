import type {
  SourceSubType,
  TaskCompletedMessage,
  TaskResultMessage,
} from '../src/protocol.js';

const sourceSubType: SourceSubType = 'user_managed';

const terminal: TaskCompletedMessage = {
  kind: 'task.completed',
  run_id: 'run-user-managed',
  outcome_kind: 'awaiting_review',
  started_at: '2026-08-26T17:00:00.000Z',
  completed_at: '2026-08-26T17:00:01.000Z',
  tokens_used: 1,
  provider: 'openai',
  source_sub_type: sourceSubType,
  source_driver: 'opencode',
  cost_estimate_cents: 0,
};

void terminal;

const providerAttribution: NonNullable<
  TaskResultMessage['provider_attribution']
> = {
  provider: 'openai',
  provider_id: 'openai',
  source_sub_type: 'user_managed',
  source_driver: 'opencode',
  tokens_used: 1,
  cost_estimate_cents: 0,
};

void providerAttribution;

const nullableProviderId: TaskCompletedMessage = {
  ...terminal,
  provider: 'other',
  provider_id: null,
};

void nullableProviderId;

const opaqueProviderId: NonNullable<
  TaskResultMessage['provider_attribution']
> = {
  ...providerAttribution,
  provider: 'other',
  provider_id: 'openrouter',
};

void opaqueProviderId;

const nullableProviderAttribution: NonNullable<
  TaskResultMessage['provider_attribution']
> = {
  ...providerAttribution,
  provider: 'other',
  provider_id: null,
};

void nullableProviderAttribution;

// @ts-expect-error Unknown attribution values must remain outside the contract.
const unknownSourceSubType: SourceSubType = 'opaque_local_auth';

void unknownSourceSubType;
