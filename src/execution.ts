/**
 * Gateway mirror of the canonical OrgX execution boundary.
 *
 * Field names intentionally match `@orgx/contracts` exactly. The gateway SDK
 * stays dependency-free, while conformance tests in the OrgX application pin
 * this wire shape to the JSON Schema-addressable source contract.
 */

export type Digest = `sha256:${string}`;
export type MoneyMicros = string;

export type ActorRef = {
  type: 'human' | 'agent' | 'service' | 'external_agent' | 'system';
  id: string;
  displayName?: string;
};

export type ContractProducer = {
  actor: ActorRef;
  service: string;
  serviceVersion: string;
};

export type WorkRef = {
  workspaceId: string;
  customerId?: string;
  goalId?: string;
  objectiveId?: string;
  initiativeId?: string;
  workstreamId?: string;
  milestoneId?: string;
  taskId?: string;
};

export type AttemptBudget = {
  modelCostMicros: MoneyMicros;
  toolCostMicros: MoneyMicros;
  humanMinutes: number;
  maximumLatencyMs?: number;
};

export type ExecutionEnvelope = {
  schemaVersion: string;
  producer: ContractProducer;
  id: string;
  runId: string;
  attemptId: string;
  idempotencyKey: string;
  workRef: WorkRef;
  missionId: string;
  missionContractDigest: Digest;
  nodeId: string;
  contextManifestDigest: Digest;
  capabilityLeaseId: string;
  capabilityLeaseDigest: Digest;
  runtimeProfileDigest: Digest;
  qualityBarVersionId: string;
  skillVersionDigests: Digest[];
  toolManifestDigests: Digest[];
  budget: AttemptBudget;
  requestedAt: string;
  deadline?: string;
  digest: Digest;
};

export type ReceiptRef = {
  kind: 'run' | 'action' | 'proof';
  id: string;
  digest?: Digest;
};

export type ArtifactRef = {
  id: string;
  uri: string;
  digest: Digest;
  mediaType?: string;
  schemaVersion?: string;
};

export type EvidenceRecordRef = { id: string; digest: Digest };

export type CostSummary = {
  modelMicros: MoneyMicros;
  toolMicros: MoneyMicros;
  infrastructureMicros: MoneyMicros;
  humanLaborMicros: MoneyMicros;
  totalMicros: MoneyMicros;
};

export type ExecutionResult = {
  schemaVersion: string;
  producer: ContractProducer;
  id: string;
  envelopeId: string;
  envelopeDigest: Digest;
  workRef: WorkRef;
  missionId: string;
  nodeId: string;
  runId: string;
  attemptId: string;
  disposition:
    | 'failed'
    | 'blocked'
    | 'technically_complete'
    | 'outcome_pending'
    | 'accepted';
  receiptRefs: ReceiptRef[];
  artifactRefs: ArtifactRef[];
  decisionRefs: string[];
  blockerRefs: string[];
  proofPacketRef?: EvidenceRecordRef;
  outcomeRefs: EvidenceRecordRef[];
  costs: CostSummary;
  completedAt: string;
  digest: Digest;
};

const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;

export function validateExecutionEnvelope(envelope: ExecutionEnvelope): void {
  if (envelope.schemaVersion !== '1.0.0') {
    throw new Error('execution envelope schema version unsupported');
  }
  if (!envelope.workRef.workspaceId) {
    throw new Error('execution envelope requires a workspace reference');
  }
  if (
    !envelope.workRef.goalId &&
    !envelope.workRef.objectiveId &&
    !envelope.workRef.initiativeId
  ) {
    throw new Error('execution envelope requires goal, objective, or initiative lineage');
  }
  if (
    (envelope.workRef.workstreamId ||
      envelope.workRef.milestoneId ||
      envelope.workRef.taskId) &&
    !envelope.workRef.initiativeId
  ) {
    throw new Error('nested work requires initiative lineage');
  }
  for (const digest of [
    envelope.digest,
    envelope.missionContractDigest,
    envelope.contextManifestDigest,
    envelope.capabilityLeaseDigest,
    envelope.runtimeProfileDigest,
    ...envelope.skillVersionDigests,
    ...envelope.toolManifestDigests,
  ]) {
    if (!DIGEST_PATTERN.test(digest)) {
      throw new Error('execution envelope contains an invalid digest');
    }
  }
  if (new Set(envelope.skillVersionDigests).size !== envelope.skillVersionDigests.length) {
    throw new Error('execution envelope skill digests must be unique');
  }
  if (new Set(envelope.toolManifestDigests).size !== envelope.toolManifestDigests.length) {
    throw new Error('execution envelope tool digests must be unique');
  }
}

export function validateExecutionResult(
  result: ExecutionResult,
  envelope: ExecutionEnvelope
): void {
  if (
    result.runId !== envelope.runId ||
    result.attemptId !== envelope.attemptId ||
    result.envelopeId !== envelope.id ||
    result.envelopeDigest !== envelope.digest
  ) {
    throw new Error('execution result does not match its envelope');
  }
  if (!sameWorkRef(result.workRef, envelope.workRef)) {
    throw new Error('execution result work lineage does not match its envelope');
  }
  if (result.receiptRefs.length === 0) {
    throw new Error('execution result requires at least one receipt');
  }
  if (
    ['technically_complete', 'outcome_pending', 'accepted'].includes(
      result.disposition
    ) &&
    !result.proofPacketRef
  ) {
    throw new Error(`${result.disposition} requires a proof packet`);
  }
  if (result.disposition === 'accepted' && result.outcomeRefs.length === 0) {
    throw new Error('accepted execution requires an outcome');
  }
  if (!DIGEST_PATTERN.test(result.digest)) {
    throw new Error('execution result contains an invalid digest');
  }
}

function sameWorkRef(left: WorkRef, right: WorkRef): boolean {
  const keys: Array<keyof WorkRef> = [
    'workspaceId',
    'customerId',
    'goalId',
    'objectiveId',
    'initiativeId',
    'workstreamId',
    'milestoneId',
    'taskId',
  ];
  return keys.every((key) => left[key] === right[key]);
}
