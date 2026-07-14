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
});
