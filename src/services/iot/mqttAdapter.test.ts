// SPDX-License-Identifier: MIT
//
// claude/mqtt-wire (2026-06) — coverage for the REAL broker adapter and
// the connectMqttBroker wrapper (topic prefix + deviceId context).
//
// The `mqtt` package is never loaded: createBrokerAdapter takes an
// injected `mqttModule` test seam, so we drive the client surface
// (connect opts, subscribe, message events, end) with a fake.

import { describe, it, expect, vi } from 'vitest';
import {
  createBrokerAdapter,
  connectMqttBroker,
  topicMatches,
  parseCanonicalTelemetryTopic,
  InMemoryAdapter,
  buildTopic,
  type MqttLikeClient,
  type MqttConnectModule,
} from './mqttAdapter.js';
import type { TelemetrySample } from './types.js';

// ── fake mqtt module ────────────────────────────────────────────────────

interface FakeClient extends MqttLikeClient {
  emit(event: string, ...args: unknown[]): void;
  subscriptions: Array<{ topic: string; qos: number }>;
  unsubscribed: string[];
  published: Array<{ topic: string; payload: string | Buffer; qos: number }>;
  ended: boolean;
}

function makeFakeMqtt() {
  const listeners = new Map<string, Array<(...args: unknown[]) => void>>();
  const client: FakeClient = {
    subscriptions: [],
    unsubscribed: [],
    published: [],
    ended: false,
    on(event, listener) {
      const arr = listeners.get(event) ?? [];
      arr.push(listener);
      listeners.set(event, arr);
      return client;
    },
    emit(event, ...args) {
      for (const fn of listeners.get(event) ?? []) fn(...args);
    },
    subscribe(topic, opts, cb) {
      client.subscriptions.push({ topic, qos: opts.qos });
      cb?.(null);
      return client;
    },
    unsubscribe(topic, cb) {
      client.unsubscribed.push(topic);
      cb?.(null);
      return client;
    },
    publish(topic, payload, opts, cb) {
      client.published.push({ topic, payload, qos: opts.qos });
      cb?.(null);
      return client;
    },
    end(_force, _opts, cb) {
      client.ended = true;
      cb?.();
      return client;
    },
  };
  const connectCalls: Array<{ url: string; opts: Record<string, unknown> }> = [];
  const mqttModule: MqttConnectModule = {
    connect(url, opts) {
      connectCalls.push({ url, opts });
      return client;
    },
  };
  return { client, mqttModule, connectCalls };
}

const sample = (over: Partial<TelemetrySample> = {}): TelemetrySample => ({
  deviceId: 'dev-1',
  timestamp: 1_700_000_000_000,
  metric: 'o2_pct',
  value: 20.9,
  unit: '%',
  ...over,
});

describe('createBrokerAdapter', () => {
  it('connects with url, credentials, TLS material and a praeventio client id', async () => {
    const { mqttModule, connectCalls } = makeFakeMqtt();
    await createBrokerAdapter({
      url: 'mqtts://broker.faena.cl:8883',
      username: 'praeventio',
      password: 's3cr3t-broker-pass',
      ca: 'PEM_CA',
      mqttModule,
    });
    expect(connectCalls).toHaveLength(1);
    expect(connectCalls[0].url).toBe('mqtts://broker.faena.cl:8883');
    expect(connectCalls[0].opts).toMatchObject({
      username: 'praeventio',
      password: 's3cr3t-broker-pass',
      ca: 'PEM_CA',
      clean: true,
      resubscribe: true,
    });
    expect(String(connectCalls[0].opts.clientId)).toMatch(/^praeventio-bridge-/);
  });

  it('delivers JSON telemetry samples to matching wildcard subscribers', async () => {
    const { client, mqttModule } = makeFakeMqtt();
    const adapter = await createBrokerAdapter({ url: 'mqtt://localhost', mqttModule });
    const seen: Array<{ s: TelemetrySample; topic: string }> = [];
    await adapter.subscribe('tenants/+/projects/+/devices/+/telemetry', (s, topic) =>
      seen.push({ s, topic }),
    );
    expect(client.subscriptions).toEqual([
      { topic: 'tenants/+/projects/+/devices/+/telemetry', qos: 1 },
    ]);
    const topic = buildTopic('t1', 'p1', 'dev-1', 'telemetry');
    client.emit('message', topic, Buffer.from(JSON.stringify(sample())));
    expect(seen).toHaveLength(1);
    expect(seen[0].topic).toBe(topic);
    expect(seen[0].s.metric).toBe('o2_pct');
  });

  it('drops malformed JSON and non-sample payloads without throwing', async () => {
    const { client, mqttModule } = makeFakeMqtt();
    const adapter = await createBrokerAdapter({ url: 'mqtt://localhost', mqttModule });
    const handler = vi.fn();
    await adapter.subscribe('tenants/#', handler);
    const topic = buildTopic('t1', 'p1', 'dev-1', 'telemetry');
    client.emit('message', topic, Buffer.from('not json {'));
    client.emit('message', topic, Buffer.from(JSON.stringify({ hello: 'world' })));
    client.emit('message', topic, Buffer.from(JSON.stringify({ ...sample(), value: 'NaN' })));
    expect(handler).not.toHaveBeenCalled();
  });

  it('a throwing handler does not poison the bus for other handlers', async () => {
    const { client, mqttModule } = makeFakeMqtt();
    const adapter = await createBrokerAdapter({ url: 'mqtt://localhost', mqttModule });
    const good = vi.fn();
    await adapter.subscribe('tenants/#', () => {
      throw new Error('boom');
    });
    await adapter.subscribe('tenants/+/projects/+/devices/+/telemetry', good);
    client.emit(
      'message',
      buildTopic('t1', 'p1', 'dev-1', 'telemetry'),
      Buffer.from(JSON.stringify(sample())),
    );
    expect(good).toHaveBeenCalledTimes(1);
  });

  it('broker error events are observed without throwing', async () => {
    const { client, mqttModule } = makeFakeMqtt();
    await createBrokerAdapter({ url: 'mqtt://localhost', mqttModule });
    expect(() => client.emit('error', new Error('ECONNREFUSED'))).not.toThrow();
    expect(() => client.emit('reconnect')).not.toThrow();
  });

  it('publish stringifies objects and close() ends the client and rejects further use', async () => {
    const { client, mqttModule } = makeFakeMqtt();
    const adapter = await createBrokerAdapter({ url: 'mqtt://localhost', mqttModule });
    await adapter.publish('tenants/t1/x', { a: 1 }, { qos: 2 });
    expect(client.published).toEqual([
      { topic: 'tenants/t1/x', payload: JSON.stringify({ a: 1 }), qos: 2 },
    ]);
    await adapter.close();
    expect(client.ended).toBe(true);
    await expect(adapter.subscribe('t', vi.fn())).rejects.toThrow(/closed/);
    await expect(adapter.publish('t', {})).rejects.toThrow(/closed/);
  });
});

describe('connectMqttBroker — prefix + deviceId context', () => {
  it('subscribes under the broker prefix, strips it, and passes deviceId to the handler', async () => {
    const adapter = new InMemoryAdapter();
    const seen: Array<{ s: TelemetrySample; ctx: Record<string, string> }> = [];
    await connectMqttBroker({
      adapter: 'memory',
      adapterInstance: adapter,
      topicPrefix: 'praeventio/prod',
      onTelemetry: (s, ctx) => {
        seen.push({ s, ctx: { ...ctx } });
      },
    });
    await adapter.publish(
      `praeventio/prod/${buildTopic('t1', 'p1', 'gas-7', 'telemetry')}`,
      sample({ deviceId: 'gas-7' }),
    );
    expect(seen).toHaveLength(1);
    expect(seen[0].ctx).toMatchObject({
      tenantId: 't1',
      projectId: 'p1',
      deviceId: 'gas-7',
    });
  });

  it('ignores sibling streams (status/heartbeat) and unprefixed topics when a prefix is set', async () => {
    const adapter = new InMemoryAdapter();
    const handler = vi.fn();
    await connectMqttBroker({
      adapter: 'memory',
      adapterInstance: adapter,
      topicPrefix: 'praeventio/prod',
      onTelemetry: handler,
    });
    await adapter.publish(
      `praeventio/prod/${buildTopic('t1', 'p1', 'gas-7', 'status')}`,
      sample(),
    );
    await adapter.publish(buildTopic('t1', 'p1', 'gas-7', 'telemetry'), sample());
    expect(handler).not.toHaveBeenCalled();
  });

  it('without prefix keeps the canonical pattern and still reports deviceId', async () => {
    const adapter = new InMemoryAdapter();
    const handler = vi.fn();
    await connectMqttBroker({
      adapter: 'memory',
      adapterInstance: adapter,
      onTelemetry: handler,
    });
    await adapter.publish(buildTopic('t9', 'p9', 'dev-9', 'telemetry'), sample({ deviceId: 'dev-9' }));
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][1]).toMatchObject({ deviceId: 'dev-9' });
  });
});

describe('topic helpers (regression)', () => {
  it('topicMatches handles + and # per MQTT spec', () => {
    expect(topicMatches('a/+/c', 'a/b/c')).toBe(true);
    expect(topicMatches('a/#', 'a/b/c/d')).toBe(true);
    expect(topicMatches('a/+/c', 'a/b/x')).toBe(false);
  });
  it('parseCanonicalTelemetryTopic only accepts the 7-segment telemetry shape', () => {
    expect(parseCanonicalTelemetryTopic(buildTopic('t', 'p', 'd', 'telemetry'))).toEqual({
      tenantId: 't',
      projectId: 'p',
      deviceId: 'd',
    });
    expect(parseCanonicalTelemetryTopic(buildTopic('t', 'p', 'd', 'status'))).toBeNull();
    expect(parseCanonicalTelemetryTopic('x/y')).toBeNull();
  });
});
