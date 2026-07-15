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

export type DecisionRef = {
  id: string;
  version: number;
  digest: Digest;
};

export type CostSummary = {
  modelMicros: MoneyMicros;
  toolMicros: MoneyMicros;
  infrastructureMicros: MoneyMicros;
  humanLaborMicros: MoneyMicros;
  totalMicros: MoneyMicros;
};

export type HumanIntervention = {
  actor: ActorRef;
  reason: string;
  minutes: number;
  occurredAt: string;
  evidenceRefs: ArtifactRef[];
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

export type ExecutionFinalizationRequest = {
  schemaVersion: string;
  producer: ContractProducer;
  id: string;
  resultId: string;
  envelopeId: string;
  envelopeDigest: Digest;
  runId: string;
  attemptId: string;
  proofPacketId: string;
  actionIds: string[];
  verificationIds: string[];
  resolvedDependencies: ArtifactRef[];
  materialDecisions: DecisionRef[];
  humanInterventions: HumanIntervention[];
  blockerRefs: string[];
  costs: CostSummary;
  completedAt: string;
  requestedAt: string;
  idempotencyKey: string;
  digest: Digest;
};

export type ExecutionFinalizationRequestDraft = Omit<
  ExecutionFinalizationRequest,
  'digest'
>;

export type ExecutionFinalizationResponse = {
  schemaVersion: string;
  producer: ContractProducer;
  requestId: string;
  requestDigest: Digest;
  executionResult: ExecutionResult;
  proofPacketRef: EvidenceRecordRef;
  finalizedAt: string;
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

export async function buildExecutionFinalizationRequest(
  draft: ExecutionFinalizationRequestDraft,
  envelope: ExecutionEnvelope
): Promise<ExecutionFinalizationRequest> {
  const request = {
    ...draft,
    digest: await computeContractDigest(draft),
  };
  await validateExecutionFinalizationRequest(request, envelope);
  return request;
}

export async function validateExecutionFinalizationRequest(
  request: ExecutionFinalizationRequest,
  envelope: ExecutionEnvelope
): Promise<void> {
  if (request.schemaVersion !== '1.0.0') {
    throw new Error('execution finalization schema version unsupported');
  }
  if (
    request.runId !== envelope.runId ||
    request.attemptId !== envelope.attemptId ||
    request.envelopeId !== envelope.id ||
    request.envelopeDigest !== envelope.digest
  ) {
    throw new Error('execution finalization does not match its envelope');
  }
  if (request.verificationIds.length === 0) {
    throw new Error('execution finalization requires a verification source');
  }
  assertUnique('action ids', request.actionIds);
  assertUnique('verification ids', request.verificationIds);
  assertUnique('blocker refs', request.blockerRefs);
  assertUnique(
    'resolved dependency digests',
    request.resolvedDependencies.map((artifact) => artifact.digest)
  );
  assertUnique(
    'material decision ids',
    request.materialDecisions.map((decision) => decision.id)
  );
  if (Date.parse(request.completedAt) > Date.parse(request.requestedAt)) {
    throw new Error('execution completion cannot follow finalization request');
  }
  if (!(await verifyContractDigest(request, request.digest))) {
    throw new Error('execution finalization request digest is invalid');
  }
}

export async function validateExecutionFinalizationResponse(
  response: ExecutionFinalizationResponse,
  request: ExecutionFinalizationRequest,
  envelope: ExecutionEnvelope
): Promise<void> {
  if (response.schemaVersion !== '1.0.0') {
    throw new Error('execution finalization response schema version unsupported');
  }
  if (
    response.requestId !== request.id ||
    response.requestDigest !== request.digest
  ) {
    throw new Error('execution finalization response does not match its request');
  }
  const resultProof = response.executionResult.proofPacketRef;
  if (
    !resultProof ||
    resultProof.id !== response.proofPacketRef.id ||
    resultProof.digest !== response.proofPacketRef.digest
  ) {
    throw new Error('execution finalization response proof is inconsistent');
  }
  validateExecutionResult(response.executionResult, envelope);
  if (
    !(await verifyContractDigest(
      response.executionResult,
      response.executionResult.digest
    ))
  ) {
    throw new Error('issued execution result digest is invalid');
  }
  if (!(await verifyContractDigest(response, response.digest))) {
    throw new Error('execution finalization response digest is invalid');
  }
}

export async function computeContractDigest(value: unknown): Promise<Digest> {
  const canonical = canonicalJson(stripTopLevelHashFields(value));
  const bytes = new TextEncoder().encode(canonical);
  const hash = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  const hex = Array.from(new Uint8Array(hash), (byte) =>
    byte.toString(16).padStart(2, '0')
  ).join('');
  return `sha256:${hex}`;
}

export async function verifyContractDigest(
  value: unknown,
  expectedDigest: Digest
): Promise<boolean> {
  return (await computeContractDigest(value)) === expectedDigest;
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

function assertUnique(label: string, values: string[]): void {
  if (new Set(values).size !== values.length) {
    throw new Error(`execution finalization ${label} must be unique`);
  }
}

const HASH_FIELDS = new Set([
  'digest',
  'receiptDigest',
  'merkleRoot',
  'signature',
]);

function canonicalJson(value: unknown): string {
  return JSON.stringify(normalize(value, new WeakSet<object>()));
}

function stripTopLevelHashFields(value: unknown): unknown {
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value).filter(([key]) => !HASH_FIELDS.has(key))
  );
}

function normalize(value: unknown, seen: WeakSet<object>): unknown {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean'
  ) {
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('non-finite number');
    return value;
  }
  if (Array.isArray(value)) {
    guardCycle(value, seen);
    const normalized = value.map((entry) => normalize(entry, seen));
    seen.delete(value);
    return normalized;
  }
  if (isRecord(value)) {
    guardCycle(value, seen);
    const normalized = Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, normalize(value[key], seen)])
    );
    seen.delete(value);
    return normalized;
  }
  throw new TypeError(`unsupported canonical JSON value: ${typeof value}`);
}

function guardCycle(value: object, seen: WeakSet<object>): void {
  if (seen.has(value)) throw new TypeError('cyclic contract value');
  seen.add(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
