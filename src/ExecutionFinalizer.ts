import {
  validateExecutionFinalizationRequest,
  validateExecutionFinalizationResponse,
  type ExecutionEnvelope,
  type ExecutionFinalizationRequest,
  type ExecutionFinalizationResponse,
} from './execution.js';

export type ExecutionFinalizerConfig = {
  baseUrl: string;
  apiKey: string;
  fetch?: typeof globalThis.fetch;
};

export type ExecutionFinalizationOutcome = {
  response: ExecutionFinalizationResponse;
  duplicate: boolean;
};

export class ExecutionFinalizationError extends Error {
  constructor(
    message: string,
    public readonly recoverable: boolean,
    public readonly status?: number
  ) {
    super(message);
    this.name = 'ExecutionFinalizationError';
  }
}

export async function postExecutionFinalization(
  config: ExecutionFinalizerConfig,
  envelope: ExecutionEnvelope,
  request: ExecutionFinalizationRequest
): Promise<ExecutionFinalizationOutcome> {
  await validateExecutionFinalizationRequest(request, envelope);
  const fetcher = config.fetch ?? globalThis.fetch;
  if (!fetcher) {
    throw new ExecutionFinalizationError(
      'execution finalization requires fetch',
      true
    );
  }
  const base = config.baseUrl
    .replace(/^ws:/, 'http:')
    .replace(/^wss:/, 'https:');
  const url = new URL(
    `/api/v1/runs/${encodeURIComponent(request.runId)}/finalize`,
    base
  );
  let response: Response;
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
  } catch (error) {
    throw new ExecutionFinalizationError(
      `execution finalization request failed: ${errorMessage(error)}`,
      true
    );
  }
  if (!response.ok) {
    throw new ExecutionFinalizationError(
      `execution finalization failed with ${response.status}`,
      response.status >= 500 || response.status === 429,
      response.status
    );
  }
  const payload = await response.json().catch(() => null);
  if (!isRecord(payload) || !isRecord(payload.response)) {
    throw new ExecutionFinalizationError(
      'execution finalization returned an invalid payload',
      false,
      response.status
    );
  }
  const outcome = {
    response: payload.response as ExecutionFinalizationResponse,
    duplicate: payload.duplicate === true,
  };
  try {
    await validateExecutionFinalizationResponse(
      outcome.response,
      request,
      envelope
    );
  } catch (error) {
    throw new ExecutionFinalizationError(errorMessage(error), false);
  }
  return outcome;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
