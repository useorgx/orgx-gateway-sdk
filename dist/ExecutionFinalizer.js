import { validateExecutionFinalizationRequest, validateExecutionFinalizationResponse, } from './execution.js';
export class ExecutionFinalizationError extends Error {
    recoverable;
    status;
    constructor(message, recoverable, status) {
        super(message);
        this.recoverable = recoverable;
        this.status = status;
        this.name = 'ExecutionFinalizationError';
    }
}
export async function postExecutionFinalization(config, envelope, request) {
    await validateExecutionFinalizationRequest(request, envelope);
    const fetcher = config.fetch ?? globalThis.fetch;
    if (!fetcher) {
        throw new ExecutionFinalizationError('execution finalization requires fetch', true);
    }
    const base = config.baseUrl
        .replace(/^ws:/, 'http:')
        .replace(/^wss:/, 'https:');
    const url = new URL(`/api/v1/runs/${encodeURIComponent(request.runId)}/finalize`, base);
    let response;
    try {
        response = await fetcher(url, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${config.apiKey}`,
                'Content-Type': 'application/json',
                'Idempotency-Key': request.idempotencyKey,
            },
            body: JSON.stringify(request),
        });
    }
    catch (error) {
        throw new ExecutionFinalizationError(`execution finalization request failed: ${errorMessage(error)}`, true);
    }
    if (!response.ok) {
        throw new ExecutionFinalizationError(`execution finalization failed with ${response.status}`, response.status >= 500 || response.status === 429, response.status);
    }
    const payload = await response.json().catch(() => null);
    if (!isRecord(payload) || !isRecord(payload.response)) {
        throw new ExecutionFinalizationError('execution finalization returned an invalid payload', false, response.status);
    }
    const outcome = {
        response: payload.response,
        duplicate: payload.duplicate === true,
    };
    try {
        await validateExecutionFinalizationResponse(outcome.response, request, envelope);
    }
    catch (error) {
        throw new ExecutionFinalizationError(errorMessage(error), false);
    }
    return outcome;
}
function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function errorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}
//# sourceMappingURL=ExecutionFinalizer.js.map