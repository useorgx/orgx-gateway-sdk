import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { PeerClient } from '../dist/PeerClient.js';
import {
  buildExecutionFinalizationRequest,
  computeContractDigest,
} from '../dist/execution.js';

class FakeSocket {
  listeners = new Map();
  sent = [];

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  emit(type, event = {}) {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }

  send(data) {
    this.sent.push(JSON.parse(data));
  }

  close(code = 1000, reason = '') {
    this.emit('close', { code, reason });
  }
}

async function waitFor(predicate, label) {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`timed out waiting for ${label}`);
}

const completed = (runId) => ({
  kind: 'task.completed',
  run_id: runId,
  outcome_kind: 'awaiting_review',
  started_at: '2026-07-13T00:00:00.000Z',
  completed_at: '2026-07-13T00:00:01.000Z',
  tokens_used: 1,
  provider: 'openai',
  source_sub_type: 'subscription',
  source_driver: 'codex',
  cost_estimate_cents: 0,
});

function dispatch(runId = 'run-1', key = 'dispatch-1') {
  return {
    kind: 'task.dispatch',
    run_id: runId,
    idempotency_key: key,
    timeout_seconds: 30,
    task: { title: 'No-op probe', driver: 'codex' },
  };
}

const digest = (character) => `sha256:${character.repeat(64)}`;

function executionEnvelope(runId = 'run-v2', key = 'dispatch-v2') {
  return {
    schemaVersion: '1.0.0',
    producer: {
      actor: { type: 'service', id: 'mission-runtime' },
      service: 'mission-runtime',
      serviceVersion: '1.0.0',
    },
    id: 'envelope-v2',
    runId,
    attemptId: 'attempt-v2',
    idempotencyKey: key,
    workRef: {
      workspaceId: 'workspace-1',
      initiativeId: 'initiative-1',
      taskId: 'task-1',
    },
    missionId: 'mission-1',
    missionContractDigest: digest('1'),
    nodeId: 'node-1',
    contextManifestDigest: digest('2'),
    capabilityLeaseId: 'lease-1',
    capabilityLeaseDigest: digest('3'),
    runtimeProfileDigest: digest('4'),
    qualityBarVersionId: 'quality-1',
    skillVersionDigests: [digest('5')],
    toolManifestDigests: [digest('6')],
    budget: {
      modelCostMicros: '1000',
      toolCostMicros: '1000',
      humanMinutes: 0,
    },
    requestedAt: '2026-07-14T22:00:00.000Z',
    digest: digest('7'),
  };
}

async function executionResult(envelope = executionEnvelope()) {
  const unsigned = {
    schemaVersion: '1.0.0',
    producer: {
      actor: { type: 'service', id: 'orgx-execution-finalizer' },
      service: 'orgx-execution-finalizer',
      serviceVersion: '1.0.0',
    },
    id: 'result-v2',
    envelopeId: envelope.id,
    envelopeDigest: envelope.digest,
    workRef: envelope.workRef,
    missionId: envelope.missionId,
    nodeId: envelope.nodeId,
    runId: envelope.runId,
    attemptId: envelope.attemptId,
    disposition: 'technically_complete',
    receiptRefs: [{ kind: 'run', id: envelope.runId }],
    artifactRefs: [],
    decisionRefs: [],
    blockerRefs: [],
    proofPacketRef: { id: 'proof-1', digest: digest('8') },
    outcomeRefs: [],
    costs: {
      modelMicros: '100',
      toolMicros: '0',
      infrastructureMicros: '0',
      humanLaborMicros: '0',
      totalMicros: '100',
    },
    completedAt: '2026-07-14T22:01:00.000Z',
  };
  return { ...unsigned, digest: await computeContractDigest(unsigned) };
}

function finalizationDraft(envelope = executionEnvelope()) {
  return {
    schemaVersion: '1.0.0',
    producer: {
      actor: { type: 'agent', id: 'engineering-agent' },
      service: 'orgx-codex-plugin',
      serviceVersion: '1.0.0',
    },
    id: `finalization-${envelope.runId}`,
    resultId: `result-${envelope.runId}`,
    envelopeId: envelope.id,
    envelopeDigest: envelope.digest,
    runId: envelope.runId,
    attemptId: envelope.attemptId,
    proofPacketId: `proof-${envelope.runId}`,
    actionIds: ['action-1'],
    verificationIds: ['verification-1'],
    resolvedDependencies: [],
    materialDecisions: [],
    humanInterventions: [],
    blockerRefs: [],
    costs: {
      modelMicros: '100',
      toolMicros: '0',
      infrastructureMicros: '0',
      humanLaborMicros: '0',
      totalMicros: '100',
    },
    completedAt: '2026-07-14T22:01:00.000Z',
    requestedAt: '2026-07-14T22:01:00.000Z',
    idempotencyKey: `finalize-${envelope.runId}`,
  };
}

async function finalizationPayload(envelope, request) {
  const result = await executionResult(envelope);
  const unsigned = {
    schemaVersion: '1.0.0',
    producer: {
      actor: { type: 'service', id: 'orgx-execution-finalizer' },
      service: 'orgx-execution-finalizer',
      serviceVersion: '1.0.0',
    },
    requestId: request.id,
    requestDigest: request.digest,
    executionResult: result,
    proofPacketRef: result.proofPacketRef,
    finalizedAt: '2026-07-14T22:01:01.000Z',
  };
  return {
    response: { ...unsigned, digest: await computeContractDigest(unsigned) },
    duplicate: false,
  };
}

function finalizationFetch(envelope, requests = []) {
  return async (url, init) => {
    requests.push({ url: String(url), init });
    const request = JSON.parse(String(init.body));
    return new Response(
      JSON.stringify(await finalizationPayload(envelope, request)),
      { status: 201, headers: { 'Content-Type': 'application/json' } }
    );
  };
}

function v2Dispatch(runId = 'run-v2', key = 'dispatch-v2') {
  return {
    kind: 'task.dispatch',
    protocol_version: 2,
    run_id: runId,
    idempotency_key: key,
    timeout_seconds: 30,
    task: { title: 'Proof-carrying probe', driver: 'codex' },
    execution_envelope: executionEnvelope(runId, key),
  };
}

function attentionResolution(overrides = {}) {
  return {
    kind: 'attention.resolve',
    protocol_version: 3,
    decision_id: 'decision-1',
    run_id: 'run-1',
    driver: 'codex',
    session_handle: 'thread-1',
    idempotency_key: 'attention:decision-1:resolve',
    resolution: {
      status: 'approved',
      answer: 'Use the restrained direction.',
      option_id: 'restrained',
    },
    ...overrides,
  };
}

function createDriver(counter) {
  return {
    id: 'codex',
    async detect() {
      return { installed: true, authenticated: true };
    },
    async probe() {
      return { subscription_active: true, session_alive: true };
    },
    async *dispatch(_task, context) {
      counter.count += 1;
      yield { kind: 'task.started', run_id: context.run_id, started_at: 'now' };
      yield completed(context.run_id);
    },
    async cancel() {},
  };
}

function createResumableDriver(resolutions) {
  const driver = createDriver({ count: 0 });
  driver.resolveAttention = async function* (message) {
    resolutions.push(message);
    yield { state: 'resuming', detail: 'Restoring thread.' };
    yield {
      state: 'resumed',
      session_handle: message.session_handle,
      detail: 'Thread accepted the answer.',
    };
  };
  return driver;
}

function createV2Driver(contexts, mutateDraft = (draft) => draft) {
  return {
    id: 'codex',
    async detect() {
      return { installed: true, authenticated: true };
    },
    async probe() {
      return { subscription_active: true, session_alive: true };
    },
    async *dispatch(_task, context) {
      contexts.push(context);
      const request = await buildExecutionFinalizationRequest(
        mutateDraft(finalizationDraft(context.execution_envelope)),
        context.execution_envelope
      );
      yield { kind: 'task.started', run_id: context.run_id, started_at: 'now' };
      yield {
        kind: 'task.finalize',
        run_id: context.run_id,
        execution_finalization_request: request,
      };
    },
    async cancel() {},
  };
}

describe('PeerClient', () => {
  it('advertises normalized identity and driver in the socket contract', () => {
    let opened;
    const socket = new FakeSocket();
    const client = new PeerClient({
      baseUrl: 'wss://useorgx.com',
      apiKey: 'oxk_test',
      workspaceId: 'workspace-1',
      pluginId: 'orgx-codex-plugin',
      installationId: 'install-1',
      drivers: [createDriver({ count: 0 })],
      webSocketFactory(url, protocols) {
        opened = { url, protocols };
        return socket;
      },
    });
    client.connect();
    const url = new URL(opened.url);
    assert.equal(url.pathname, '/api/v1/gateway/stream');
    assert.equal(url.searchParams.get('plugin_id'), 'orgx-codex-plugin');
    assert.equal(url.searchParams.get('installation_id'), 'install-1');
    assert.equal(url.searchParams.get('drivers'), 'codex');
    assert.deepEqual(opened.protocols, ['orgx.v1', 'bearer.oxk_test']);
  });

  it('opts into v2 explicitly and forwards the proof-carrying envelope', async () => {
    let opened;
    const socket = new FakeSocket();
    const contexts = [];
    const requests = [];
    const client = new PeerClient({
      baseUrl: 'wss://useorgx.com',
      apiKey: 'oxk_test',
      workspaceId: 'workspace-1',
      pluginId: 'orgx-codex-plugin',
      protocolVersion: 2,
      drivers: [createV2Driver(contexts)],
      fetch: finalizationFetch(executionEnvelope(), requests),
      webSocketFactory(url, protocols) {
        opened = { url, protocols };
        return socket;
      },
    });
    client.connect();
    socket.emit('open');
    socket.emit('message', { data: JSON.stringify(v2Dispatch()) });
    await waitFor(
      () => socket.sent.some((message) => message.kind === 'task.result'),
      'OrgX-issued task result'
    );
    assert.deepEqual(opened.protocols, ['orgx.v2', 'bearer.oxk_test']);
    assert.equal(contexts[0].protocol_version, 2);
    assert.equal(contexts[0].execution_envelope.runtimeProfileDigest, digest('4'));
    assert.equal(requests.length, 1);
    assert.match(requests[0].url, /\/api\/v1\/runs\/run-v2\/finalize$/);
    assert.equal(requests[0].init.headers['Idempotency-Key'], 'finalize-run-v2');
    assert.deepEqual(JSON.parse(requests[0].init.body).verificationIds, [
      'verification-1',
    ]);
    assert.equal(socket.sent.at(-1).kind, 'task.result');
    assert.equal(
      socket.sent.at(-1).execution_result.producer.actor.id,
      'orgx-execution-finalizer'
    );
  });

  it('opts into v3 and carries an attention answer through resumed acknowledgment', async () => {
    let opened;
    const socket = new FakeSocket();
    const resolutions = [];
    const receipts = [];
    const client = new PeerClient({
      baseUrl: 'wss://useorgx.com',
      apiKey: 'oxk_test',
      workspaceId: 'workspace-1',
      pluginId: 'orgx-codex-plugin',
      protocolVersion: 3,
      drivers: [createResumableDriver(resolutions)],
      async fetch(url, init) {
        receipts.push({ url: String(url), init });
        return new Response('{}', { status: 200 });
      },
      webSocketFactory(url, protocols) {
        opened = { url, protocols };
        return socket;
      },
    });
    client.connect();
    socket.emit('open');
    socket.emit('message', { data: JSON.stringify(attentionResolution()) });
    await waitFor(
      () =>
        socket.sent.filter(
          (message) => message.kind === 'continuation.receipt'
        ).length === 3,
      'continuation receipts'
    );

    assert.deepEqual(opened.protocols, ['orgx.v3', 'bearer.oxk_test']);
    assert.equal(resolutions.length, 1);
    assert.equal(resolutions[0].resolution.option_id, 'restrained');
    assert.deepEqual(
      socket.sent
        .filter((message) => message.kind === 'continuation.receipt')
        .map((message) => message.state),
      ['answer_received', 'resuming', 'resumed']
    );
    assert.equal(receipts.length, 3);

    socket.emit('message', { data: JSON.stringify(attentionResolution()) });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(resolutions.length, 1, 'resolution is idempotent');
  });

  it('reports a truthful failure when the selected driver cannot resume', async () => {
    const socket = new FakeSocket();
    const client = new PeerClient({
      baseUrl: 'wss://useorgx.com',
      apiKey: 'oxk_test',
      workspaceId: 'workspace-1',
      pluginId: 'orgx-codex-plugin',
      protocolVersion: 3,
      drivers: [createDriver({ count: 0 })],
      async fetch() {
        return new Response('{}', { status: 200 });
      },
      webSocketFactory: () => socket,
    });
    client.connect();
    socket.emit('open');
    socket.emit('message', { data: JSON.stringify(attentionResolution()) });
    await waitFor(
      () => socket.sent.at(-1)?.state === 'resume_failed',
      'unsupported continuation failure'
    );
    assert.deepEqual(
      socket.sent
        .filter((message) => message.kind === 'continuation.receipt')
        .map((message) => message.state),
      ['answer_received', 'resume_failed']
    );
    assert.match(socket.sent.at(-1).detail, /does not implement/);
  });

  it('persists continuation receipts over HTTP when the socket drops', async () => {
    const socket = new FakeSocket();
    const requests = [];
    socket.send = () => {
      throw new Error('socket dropped');
    };
    const client = new PeerClient({
      baseUrl: 'wss://useorgx.com',
      apiKey: 'oxk_test',
      workspaceId: 'workspace-1',
      pluginId: 'orgx-codex-plugin',
      protocolVersion: 3,
      drivers: [createResumableDriver([])],
      webSocketFactory: () => socket,
      async fetch(url, init) {
        requests.push({ url: String(url), init });
        return new Response('{}', { status: 200 });
      },
    });
    client.connect();
    socket.emit('open');
    socket.emit('message', { data: JSON.stringify(attentionResolution()) });
    await waitFor(() => requests.length === 3, 'continuation HTTP receipts');
    assert.match(
      requests[0].url,
      /\/api\/client\/live\/attention\/decision-1$/
    );
    assert.deepEqual(
      requests.map((request) => JSON.parse(request.init.body).state),
      ['answer_received', 'resuming', 'resumed']
    );
  });

  it('keeps a deferred task suspended and finishes it through continuation', async () => {
    const socket = new FakeSocket();
    let dispatches = 0;
    const driver = createDriver({ count: 0 });
    driver.dispatch = async function* (_task, context) {
      dispatches += 1;
      yield {
        kind: 'task.started',
        run_id: context.run_id,
        started_at: '2026-07-15T21:00:00.000Z',
        session_handle: 'session-1',
      };
      yield {
        kind: 'task.suspended',
        run_id: context.run_id,
        reason: 'attention',
        session_handle: 'session-1',
      };
    };
    driver.resolveAttention = async function* (message) {
      yield { state: 'resuming', session_handle: message.session_handle };
      yield { state: 'resumed', session_handle: message.session_handle };
      yield completed(message.run_id);
    };
    const client = new PeerClient({
      baseUrl: 'wss://useorgx.com',
      apiKey: 'oxk_test',
      workspaceId: 'workspace-1',
      pluginId: 'orgx-codex-plugin',
      protocolVersion: 3,
      drivers: [driver],
      webSocketFactory: () => socket,
      async fetch() {
        return new Response('{}', { status: 200 });
      },
    });
    client.connect();
    socket.emit('open');
    socket.emit('message', { data: JSON.stringify(dispatch()) });
    await waitFor(
      () => socket.sent.at(-1)?.kind === 'task.suspended',
      'suspended task'
    );

    socket.emit('message', { data: JSON.stringify(dispatch()) });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(dispatches, 1, 'suspended dispatch stays idempotent');

    socket.emit('message', { data: JSON.stringify(attentionResolution()) });
    await waitFor(
      () => socket.sent.at(-1)?.kind === 'task.completed',
      'continued task completion'
    );
    assert.deepEqual(
      socket.sent.map((message) => message.kind),
      [
        'task.started',
        'task.suspended',
        'continuation.receipt',
        'continuation.receipt',
        'continuation.receipt',
        'task.completed',
      ]
    );

    socket.emit('message', { data: JSON.stringify(dispatch()) });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(dispatches, 1, 'completed continuation stays idempotent');
  });

  it('fails closed when the finalizer response is not content-valid', async () => {
    const socket = new FakeSocket();
    const client = new PeerClient({
      baseUrl: 'wss://useorgx.com',
      apiKey: 'oxk_test',
      workspaceId: 'workspace-1',
      pluginId: 'orgx-codex-plugin',
      protocolVersion: 2,
      drivers: [createV2Driver([])],
      webSocketFactory: () => socket,
      async fetch(_url, init) {
        const request = JSON.parse(String(init.body));
        const payload = await finalizationPayload(executionEnvelope(), request);
        payload.response.executionResult.digest = digest('f');
        return new Response(JSON.stringify(payload), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        });
      },
    });
    client.connect();
    socket.emit('open');
    socket.emit('message', { data: JSON.stringify(v2Dispatch()) });
    await waitFor(
      () => socket.sent.at(-1)?.kind === 'task.failed',
      'invalid finalizer response rejection'
    );
    assert.equal(socket.sent.at(-1).recoverable, false);
    assert.match(socket.sent.at(-1).reason, /issued execution result digest/);
    assert.equal(
      socket.sent.some((message) => message.kind === 'task.result'),
      false
    );
  });

  it('fails closed when v2 dispatch or terminal identity does not match', async () => {
    const socket = new FakeSocket();
    const contexts = [];
    const client = new PeerClient({
      baseUrl: 'wss://useorgx.com',
      apiKey: 'oxk_test',
      workspaceId: 'workspace-1',
      pluginId: 'orgx-codex-plugin',
      protocolVersion: 2,
      drivers: [
        createV2Driver(contexts, (result) => ({
          ...result,
          envelopeDigest: digest('a'),
        })),
      ],
      webSocketFactory: () => socket,
    });
    client.connect();
    socket.emit('open');
    const invalidDispatch = v2Dispatch('run-invalid', 'dispatch-invalid');
    invalidDispatch.execution_envelope.idempotencyKey = 'different-key';
    socket.emit('message', { data: JSON.stringify(invalidDispatch) });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(contexts.length, 0);
    assert.match(socket.sent.at(-1).reason, /dispatch identity/);

    socket.emit('message', { data: JSON.stringify(v2Dispatch()) });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(contexts.length, 1);
    assert.match(socket.sent.at(-1).reason, /does not match its envelope/);
  });

  it('does not publish a v2 result until exactly one terminal value is proven', async () => {
    const socket = new FakeSocket();
    const requests = [];
    const driver = createV2Driver([]);
    driver.dispatch = async function* (_task, context) {
      const request = await buildExecutionFinalizationRequest(
        finalizationDraft(context.execution_envelope),
        context.execution_envelope
      );
      yield {
        kind: 'task.finalize',
        run_id: context.run_id,
        execution_finalization_request: request,
      };
      yield {
        kind: 'task.finalize',
        run_id: context.run_id,
        execution_finalization_request: request,
      };
    };
    const client = new PeerClient({
      baseUrl: 'wss://useorgx.com',
      apiKey: 'oxk_test',
      workspaceId: 'workspace-1',
      pluginId: 'orgx-codex-plugin',
      protocolVersion: 2,
      drivers: [driver],
      webSocketFactory: () => socket,
      fetch: finalizationFetch(executionEnvelope(), requests),
    });
    client.connect();
    socket.emit('open');
    socket.emit('message', { data: JSON.stringify(v2Dispatch()) });
    await waitFor(
      () => socket.sent.at(-1)?.kind === 'task.failed',
      'duplicate terminal rejection'
    );
    assert.equal(socket.sent.some((message) => message.kind === 'task.result'), false);
    assert.equal(socket.sent.at(-1).kind, 'task.failed');
    assert.match(socket.sent.at(-1).reason, /multiple terminal results/);
    assert.equal(requests.length, 0);
  });

  it('reconnects with bounded exponential backoff but not after protocol mismatch', () => {
    const sockets = [];
    const delays = [];
    const timers = [];
    const client = new PeerClient({
      baseUrl: 'wss://useorgx.com',
      apiKey: 'oxk_test',
      workspaceId: 'workspace-1',
      pluginId: 'orgx-codex-plugin',
      drivers: [createDriver({ count: 0 })],
      reconnect: { maxAttempts: 2, initialDelayMs: 100, jitterRatio: 0 },
      webSocketFactory() {
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket;
      },
      setTimeout(fn, delay) {
        delays.push(delay);
        timers.push(fn);
        return timers.length;
      },
      clearTimeout() {},
    });
    client.connect();
    sockets[0].emit('close', { code: 1006, reason: 'network' });
    assert.deepEqual(delays, [100]);
    timers.shift()();
    sockets[1].emit('close', { code: 1006, reason: 'network' });
    assert.deepEqual(delays, [100, 200]);
    timers.shift()();
    sockets[2].emit('close', { code: 4000, reason: 'protocol-version-unsupported' });
    assert.deepEqual(delays, [100, 200]);
  });

  it('keeps daemon peers retrying beyond the legacy eight-attempt window', () => {
    const sockets = [];
    const delays = [];
    const timers = [];
    const client = new PeerClient({
      baseUrl: 'wss://useorgx.com',
      apiKey: 'oxk_test',
      workspaceId: 'workspace-1',
      pluginId: 'orgx-codex-plugin',
      drivers: [createDriver({ count: 0 })],
      reconnect: { jitterRatio: 0 },
      webSocketFactory() {
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket;
      },
      setTimeout(fn, delay) {
        delays.push(delay);
        timers.push(fn);
        return timers.length;
      },
      clearTimeout() {},
    });

    client.connect();
    for (let attempt = 0; attempt < 9; attempt += 1) {
      sockets[attempt].emit('close', { code: 1001, reason: 'server deploy' });
      assert.equal(timers.length, 1, `attempt ${attempt + 1} schedules a retry`);
      timers.shift()();
    }

    assert.deepEqual(delays, [500, 1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000, 30_000]);
    assert.equal(client.currentState, 'reconnecting');
    assert.equal(sockets.length, 10);
  });

  it('deduplicates repeated dispatch idempotency keys', async () => {
    const socket = new FakeSocket();
    const counter = { count: 0 };
    const client = new PeerClient({
      baseUrl: 'wss://useorgx.com',
      apiKey: 'oxk_test',
      workspaceId: 'workspace-1',
      pluginId: 'orgx-codex-plugin',
      drivers: [createDriver(counter)],
      webSocketFactory: () => socket,
    });
    client.connect();
    socket.emit('open');
    socket.emit('message', { data: JSON.stringify(dispatch()) });
    await new Promise((resolve) => setImmediate(resolve));
    socket.emit('message', { data: JSON.stringify(dispatch()) });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(counter.count, 1);
    assert.equal(socket.sent.filter((message) => message.kind === 'task.completed').length, 1);
  });

  it('recovers a completion through the idempotent HTTP receipt endpoint', async () => {
    const socket = new FakeSocket();
    const requests = [];
    socket.send = () => {
      throw new Error('socket dropped');
    };
    const client = new PeerClient({
      baseUrl: 'wss://useorgx.com',
      apiKey: 'oxk_test',
      workspaceId: 'workspace-1',
      pluginId: 'orgx-codex-plugin',
      drivers: [createDriver({ count: 0 })],
      webSocketFactory: () => socket,
      async fetch(url, init) {
        requests.push({ url: String(url), init });
        return new Response('{}', { status: 201 });
      },
    });
    client.connect();
    socket.emit('open');
    socket.emit('message', { data: JSON.stringify(dispatch('run-recovery')) });
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(requests.length, 1);
    assert.match(requests[0].url, /\/api\/v1\/runs\/run-recovery\/receipt$/);
    assert.equal(requests[0].init.headers.Authorization, 'Bearer oxk_test');
    assert.equal(JSON.parse(requests[0].init.body).source_driver, 'codex');
  });

  it('recovers a v2 terminal result with the canonical result intact', async () => {
    const socket = new FakeSocket();
    const requests = [];
    socket.send = () => {
      throw new Error('socket dropped');
    };
    const client = new PeerClient({
      baseUrl: 'wss://useorgx.com',
      apiKey: 'oxk_test',
      workspaceId: 'workspace-1',
      pluginId: 'orgx-codex-plugin',
      protocolVersion: 2,
      drivers: [createV2Driver([])],
      webSocketFactory: () => socket,
      async fetch(url, init) {
        requests.push({ url: String(url), init });
        if (String(url).endsWith('/finalize')) {
          const request = JSON.parse(String(init.body));
          return new Response(
            JSON.stringify(
              await finalizationPayload(executionEnvelope(), request)
            ),
            { status: 201, headers: { 'Content-Type': 'application/json' } }
          );
        }
        return new Response('{}', { status: 201 });
      },
    });
    client.connect();
    socket.emit('open');
    socket.emit('message', { data: JSON.stringify(v2Dispatch()) });
    await waitFor(() => requests.length === 2, 'finalization and receipt requests');
    assert.equal(requests.length, 2);
    assert.match(requests[0].url, /\/finalize$/);
    assert.match(requests[1].url, /\/receipt$/);
    const body = JSON.parse(requests[1].init.body);
    assert.equal(body.protocol_version, 2);
    assert.equal(body.execution_result.envelopeDigest, digest('7'));
    assert.equal(body.execution_result.workRef.taskId, 'task-1');
  });
});
