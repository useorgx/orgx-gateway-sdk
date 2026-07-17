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
export type EvidenceRecordRef = {
    id: string;
    digest: Digest;
};
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
    disposition: 'failed' | 'blocked' | 'technically_complete' | 'outcome_pending' | 'accepted';
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
export type ExecutionFinalizationRequestDraft = Omit<ExecutionFinalizationRequest, 'digest'>;
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
export declare function validateExecutionEnvelope(envelope: ExecutionEnvelope): void;
export declare function validateExecutionResult(result: ExecutionResult, envelope: ExecutionEnvelope): void;
export declare function buildExecutionFinalizationRequest(draft: ExecutionFinalizationRequestDraft, envelope: ExecutionEnvelope): Promise<ExecutionFinalizationRequest>;
export declare function validateExecutionFinalizationRequest(request: ExecutionFinalizationRequest, envelope: ExecutionEnvelope): Promise<void>;
export declare function validateExecutionFinalizationResponse(response: ExecutionFinalizationResponse, request: ExecutionFinalizationRequest, envelope: ExecutionEnvelope): Promise<void>;
export declare function computeContractDigest(value: unknown): Promise<Digest>;
export declare function verifyContractDigest(value: unknown, expectedDigest: Digest): Promise<boolean>;
//# sourceMappingURL=execution.d.ts.map