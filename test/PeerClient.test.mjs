import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { PeerClient } from '../dist/PeerClient.js';

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

function executionResult(envelope = executionEnvelope()) {
  return {
    schemaVersion: '1.0.0',
    producer: {
      actor: { type: 'agent', id: 'engineering-agent' },
      service: 'orgx-codex-plugin',
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
    digest: digest('9'),
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

function createV2Driver(contexts, mutateResult = (result) => result) {
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
      const result = mutateResult(executionResult(context.execution_envelope));
      yield { kind: 'task.started', run_id: context.run_id, started_at: 'now' };
      yield {
        kind: 'task.result',
        protocol_version: 2,
        run_id: context.run_id,
        execution_result: result,
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
    const client = new PeerClient({
      baseUrl: 'wss://useorgx.com',
      apiKey: 'oxk_test',
      workspaceId: 'workspace-1',
      pluginId: 'orgx-codex-plugin',
      protocolVersion: 2,
      drivers: [createV2Driver(contexts)],
      webSocketFactory(url, protocols) {
        opened = { url, protocols };
        return socket;
      },
    });
    client.connect();
    socket.emit('open');
    socket.emit('message', { data: JSON.stringify(v2Dispatch()) });
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(opened.protocols, ['orgx.v2', 'bearer.oxk_test']);
    assert.equal(contexts[0].protocol_version, 2);
    assert.equal(contexts[0].execution_envelope.runtimeProfileDigest, digest('4'));
    assert.equal(socket.sent.at(-1).kind, 'task.result');
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
    const driver = createV2Driver([]);
    driver.dispatch = async function* (_task, context) {
      const result = executionResult(context.execution_envelope);
      yield {
        kind: 'task.result',
        protocol_version: 2,
        run_id: context.run_id,
        execution_result: result,
      };
      yield {
        kind: 'task.result',
        protocol_version: 2,
        run_id: context.run_id,
        execution_result: result,
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
    });
    client.connect();
    socket.emit('open');
    socket.emit('message', { data: JSON.stringify(v2Dispatch()) });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(socket.sent.some((message) => message.kind === 'task.result'), false);
    assert.equal(socket.sent.at(-1).kind, 'task.failed');
    assert.match(socket.sent.at(-1).reason, /multiple terminal results/);
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
        return new Response('{}', { status: 201 });
      },
    });
    client.connect();
    socket.emit('open');
    socket.emit('message', { data: JSON.stringify(v2Dispatch()) });
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    const body = JSON.parse(requests[0].init.body);
    assert.equal(body.protocol_version, 2);
    assert.equal(body.execution_result.envelopeDigest, digest('7'));
    assert.equal(body.execution_result.workRef.taskId, 'task-1');
  });
});
