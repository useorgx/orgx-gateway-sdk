import { type ExecutionEnvelope, type ExecutionFinalizationRequest, type ExecutionFinalizationResponse } from './execution.js';
export type ExecutionFinalizerConfig = {
    baseUrl: string;
    apiKey: string;
    fetch?: typeof globalThis.fetch;
};
export type ExecutionFinalizationOutcome = {
    response: ExecutionFinalizationResponse;
    duplicate: boolean;
};
export declare class ExecutionFinalizationError extends Error {
    readonly recoverable: boolean;
    readonly status?: number | undefined;
    constructor(message: string, recoverable: boolean, status?: number | undefined);
}
export declare function postExecutionFinalization(config: ExecutionFinalizerConfig, envelope: ExecutionEnvelope, request: ExecutionFinalizationRequest): Promise<ExecutionFinalizationOutcome>;
//# sourceMappingURL=ExecutionFinalizer.d.ts.map