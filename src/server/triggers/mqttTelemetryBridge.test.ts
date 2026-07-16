// claude/mqtt-wire (2026-06) — coverage for the MQTT → telemetry_events
// bridge. Exercises REAL code end-to-end:
//
//   • resolveMqttBridgeConfig — env contract incl. legacy mapping.
//   • sanitizeInboundSample — exhaustive payload validation.
//   • verifyDeviceSignature — per-device HMAC defense-in-depth.
//   • makeDeviceGate — registered-device authorization (+ TTL cache,
//     fail-closed lookups).
//   • makeMqttMessageHandler — full pipeline orchestration, never throws.
//   • startMqttTelemetryBridge — lifecycle: OFF when env absent (no
//     connection attempts), broker connect with credentials, stop().
//   • Integration: a published O₂ reading becomes a top-level
//     telemetry_events doc that the confined-space gas gate blocks on.

import { afterEach, describe, it, expect, beforeEach, vi } from 'vitest';
import type { MqttBridgeHandle } from './mqttTelemetryBridge.js';
import crypto from 'node:crypto';

const H = vi.hoisted(() => ({
  db: null as ReturnType<typeof import('../../__tests__/helpers/fakeFirestore').createFakeFirestore> | null,
}));

vi.mock('firebase-admin', () => ({
  default: {
    firestore: {
      FieldValue: {
        // ISO string so the gas gate's Date.parse(timestamp) path works.
        serverTimestamp: () => new Date().toISOString(),
      },
    },
  },
}));

vi.mock('../routes/emergency.js', () => ({
  sendToProjectSupervisors: vi.fn(async () => ({
    notified: 0,
    failed: 0,
    supervisorEmails: [],
  })),
}));

import { createFakeFirestore } from '../../__tests__/helpers/fakeFirestore';
import {
  resolveMqttBridgeConfig,
  normalizeTopicPrefix,
  sanitizeInboundSample,
  verifyDeviceSignature,
  makeDeviceGate,
  makeMqttMessageHandler,
  startMqttTelemetryBridge,
  MQTT_MAX_FUTURE_SKEW_MS,
} from './mqttTelemetryBridge.js';
import { canonicalize } from '../middleware/canonicalBody.js';
import {
  buildTopic,
  InMemoryAdapter,
  type MqttLikeClient,
  type MqttConnectModule,
} from '../../services/iot/mqttAdapter.js';
import { evaluateGasTelemetry } from '../../services/workPermits/gasGate.js';
import type { TelemetrySample } from '../../services/iot/types.js';

const NOW = 1_750_000_000_000;

function wireSample(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    deviceId: 'gas-7',
    timestamp: NOW - 1000,
    metric: 'o2_pct',
    value: 20.9,
    unit: '%',
    kind: 'gas-sensor',
    ...over,
  };
}

function signPayload(payload: Record<string, unknown>, secret: string): string {
  const { sig: _s, ...unsigned } = payload;
  return crypto.createHmac('sha256', secret).update(canonicalize(unsigned)).digest('hex');
}

// ────────────────────────────────────────────────────────────────────────
// Config resolution
// ────────────────────────────────────────────────────────────────────────

describe('resolveMqttBridgeConfig', () => {
  it('is cleanly OFF when no MQTT/IOT env is present', () => {
    expect(resolveMqttBridgeConfig({})).toEqual({
      config: null,
      disabledReason: 'disabled',
    });
  });

  it('treats empty/whitespace MQTT_BROKER_URL as absent', () => {
    expect(resolveMqttBridgeConfig({ MQTT_BROKER_URL: '   ' }).disabledReason).toBe(
      'disabled',
    );
  });

  it('rejects non-MQTT URL schemes as misconfiguration (not silently OFF)', () => {
    for (const url of ['http://broker', 'ftp://x', 'not a url', 'mqtt//broker']) {
      expect(resolveMqttBridgeConfig({ MQTT_BROKER_URL: url })).toEqual({
        config: null,
        disabledReason: 'invalid_broker_url',
      });
    }
  });

  it('builds a broker config from the MQTT_* env contract', () => {
    const { config, disabledReason } = resolveMqttBridgeConfig({
      MQTT_BROKER_URL: 'mqtts://broker.faena.cl:8883',
      MQTT_USERNAME: 'praeventio',
      MQTT_PASSWORD: 'broker-pass-123',
      MQTT_TOPIC_PREFIX: '/praeventio/prod/',
      MQTT_TLS_CA: 'PEM',
      MQTT_CLIENT_ID: 'bridge-cl-1',
    });
    expect(disabledReason).toBeNull();
    expect(config).toEqual({
      mode: 'broker',
      url: 'mqtts://broker.faena.cl:8883',
      username: 'praeventio',
      password: 'broker-pass-123',
      ca: 'PEM',
      cert: undefined,
      key: undefined,
      clientId: 'bridge-cl-1',
      topicPrefix: 'praeventio/prod',
      source: 'mqtt-env',
    });
  });

  it('accepts ws:// and wss:// brokers', () => {
    expect(
      resolveMqttBridgeConfig({ MQTT_BROKER_URL: 'wss://broker:443/mqtt' }).config?.mode,
    ).toBe('broker');
  });

  it('legacy IOT_BROKER_ENABLED=1 defaults to the in-memory bus (dev mode preserved)', () => {
    expect(resolveMqttBridgeConfig({ IOT_BROKER_ENABLED: '1' })).toEqual({
      config: { mode: 'memory' },
      disabledReason: null,
    });
  });

  it('legacy emqx adapter maps IOT_EMQX_* onto a broker config', () => {
    const { config } = resolveMqttBridgeConfig({
      IOT_BROKER_ENABLED: '1',
      IOT_BROKER_ADAPTER: 'emqx',
      IOT_EMQX_URL: 'mqtts://emqx.interno:8883',
      IOT_EMQX_CA: 'CA',
      IOT_EMQX_CERT: 'CERT',
      IOT_EMQX_KEY: 'KEY',
    });
    expect(config).toMatchObject({
      mode: 'broker',
      url: 'mqtts://emqx.interno:8883',
      ca: 'CA',
      cert: 'CERT',
      key: 'KEY',
      source: 'legacy-emqx',
    });
  });

  it('legacy emqx without URL is flagged as misconfiguration', () => {
    expect(
      resolveMqttBridgeConfig({ IOT_BROKER_ENABLED: '1', IOT_BROKER_ADAPTER: 'emqx' })
        .disabledReason,
    ).toBe('legacy_emqx_missing_url');
  });

  it('legacy cloud/gcp adapters are refused (Cloud IoT Core retired — ADR 0015)', () => {
    for (const adapter of ['cloud', 'gcp']) {
      expect(
        resolveMqttBridgeConfig({ IOT_BROKER_ENABLED: '1', IOT_BROKER_ADAPTER: adapter })
          .disabledReason,
      ).toBe('legacy_cloud_superseded');
    }
  });

  it('MQTT_BROKER_URL takes precedence over the legacy contract', () => {
    const { config } = resolveMqttBridgeConfig({
      MQTT_BROKER_URL: 'mqtt://nuevo:1883',
      IOT_BROKER_ENABLED: '1',
      IOT_BROKER_ADAPTER: 'memory',
    });
    expect(config).toMatchObject({ mode: 'broker', url: 'mqtt://nuevo:1883' });
  });
});

describe('normalizeTopicPrefix', () => {
  it('strips slashes/whitespace and maps empty to null', () => {
    expect(normalizeTopicPrefix(undefined)).toBeNull();
    expect(normalizeTopicPrefix('')).toBeNull();
    expect(normalizeTopicPrefix('  /a/b/ ')).toBe('a/b');
    expect(normalizeTopicPrefix('praeventio')).toBe('praeventio');
  });
});

// ────────────────────────────────────────────────────────────────────────
// Payload validation
// ────────────────────────────────────────────────────────────────────────

describe('sanitizeInboundSample', () => {
  it('accepts a well-formed gas reading and extracts zoneId + sig', () => {
    const verdict = sanitizeInboundSample(
      wireSample({ zoneId: 'zona-estanque-3', sig: 'abc123' }),
      NOW,
    );
    expect(verdict).toMatchObject({
      ok: true,
      zoneId: 'zona-estanque-3',
      sig: 'abc123',
    });
    if (verdict.ok) {
      expect(verdict.sample).toEqual({
        deviceId: 'gas-7',
        timestamp: NOW - 1000,
        metric: 'o2_pct',
        value: 20.9,
        unit: '%',
        kind: 'gas-sensor',
      });
    }
  });

  it.each([
    ['missing deviceId', { deviceId: undefined }, 'invalid_device_id'],
    ['deviceId with bad chars', { deviceId: 'dev 7/../x' }, 'invalid_device_id'],
    ['deviceId too long', { deviceId: 'a'.repeat(129) }, 'invalid_device_id'],
    ['metric empty', { metric: '' }, 'invalid_metric'],
    ['metric too long', { metric: 'm'.repeat(65) }, 'invalid_metric'],
    ['metric non-string', { metric: 42 }, 'invalid_metric'],
    ['value string', { value: '20.9' }, 'invalid_value'],
    ['value NaN', { value: Number.NaN }, 'invalid_value'],
    ['value Infinity', { value: Number.POSITIVE_INFINITY }, 'invalid_value'],
    ['unit non-string', { unit: 7 }, 'invalid_unit'],
    ['unit too long', { unit: 'u'.repeat(33) }, 'invalid_unit'],
    ['timestamp string', { timestamp: 'now' }, 'invalid_timestamp'],
    ['timestamp NaN', { timestamp: Number.NaN }, 'invalid_timestamp'],
  ] as Array<[string, Record<string, unknown>, string]>)(
    'rejects %s',
    (_label, over, reason) => {
      expect(sanitizeInboundSample(wireSample(over), NOW)).toEqual({ ok: false, reason });
    },
  );

  it('rejects timestamps beyond the 5-minute future skew (types.ts contract)', () => {
    const bad = sanitizeInboundSample(
      wireSample({ timestamp: NOW + MQTT_MAX_FUTURE_SKEW_MS + 1 }),
      NOW,
    );
    expect(bad).toEqual({ ok: false, reason: 'future_timestamp' });
    const edge = sanitizeInboundSample(
      wireSample({ timestamp: NOW + MQTT_MAX_FUTURE_SKEW_MS }),
      NOW,
    );
    expect(edge.ok).toBe(true);
  });

  it('degrades malformed optional fields instead of rejecting (HTTP-ingest zoneId policy)', () => {
    const verdict = sanitizeInboundSample(
      wireSample({ zoneId: 'z'.repeat(129), kind: 'submarine', sig: 42 }),
      NOW,
    );
    expect(verdict).toMatchObject({ ok: true, zoneId: null, sig: null });
    if (verdict.ok) expect(verdict.sample.kind).toBeUndefined();
  });
});

// ────────────────────────────────────────────────────────────────────────
// Per-device HMAC
// ────────────────────────────────────────────────────────────────────────

describe('verifyDeviceSignature', () => {
  const secret = 'device-secret-32-bytes-aaaaaaaaaa';

  it('accepts the canonical-JSON HMAC of the payload without sig', () => {
    const payload = wireSample({ zoneId: 'z1' });
    const sig = signPayload(payload, secret);
    expect(verifyDeviceSignature({ ...payload, sig }, sig, secret)).toBe(true);
  });

  it('is key-order independent (RFC 8785 canonicalization, same as HTTP ingest)', () => {
    const payload = wireSample();
    const reordered = Object.fromEntries(Object.entries(payload).reverse());
    const sig = signPayload(payload, secret);
    expect(verifyDeviceSignature(reordered, sig, secret)).toBe(true);
  });

  it('rejects missing sig, wrong sig and tampered values', () => {
    const payload = wireSample();
    const sig = signPayload(payload, secret);
    expect(verifyDeviceSignature(payload, null, secret)).toBe(false);
    expect(verifyDeviceSignature(payload, 'deadbeef', secret)).toBe(false);
    expect(verifyDeviceSignature({ ...payload, value: 999 }, sig, secret)).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────────────────
// Device gate
// ────────────────────────────────────────────────────────────────────────

function countingDb(docs: Record<string, Record<string, unknown> | (() => never)>) {
  let reads = 0;
  const db = {
    collection: (c1: string) => ({
      doc: (id1: string) => ({
        collection: (c2: string) => ({
          doc: (id2: string) => ({
            async get() {
              reads += 1;
              const entry = docs[`${c1}/${id1}/${c2}/${id2}`];
              if (typeof entry === 'function') entry();
              return { exists: entry !== undefined, data: () => entry };
            },
          }),
        }),
      }),
    }),
  } as unknown as FirebaseFirestore.Firestore;
  return { db, getReads: () => reads };
}

describe('makeDeviceGate', () => {
  it('authorizes an active registered device bound to the topic project', async () => {
    const { db } = countingDb({
      'tenants/t1/iot_devices/gas-7': { projectId: 'p1', status: 'active' },
    });
    const gate = makeDeviceGate({ db });
    expect(await gate('t1', 'p1', 'gas-7')).toEqual({ ok: true, secret: null });
  });

  it('surfaces the stored per-device secret', async () => {
    const { db } = countingDb({
      'tenants/t1/iot_devices/gas-7': { projectId: 'p1', status: 'active', secret: 's3cret-dev' },
    });
    const gate = makeDeviceGate({ db });
    expect(await gate('t1', 'p1', 'gas-7')).toEqual({ ok: true, secret: 's3cret-dev' });
  });

  it('rejects unregistered, inactive and project-mismatched devices', async () => {
    const { db } = countingDb({
      'tenants/t1/iot_devices/revoked': { projectId: 'p1', status: 'inactive' },
      'tenants/t1/iot_devices/otherproj': { projectId: 'pX', status: 'active' },
    });
    const gate = makeDeviceGate({ db });
    expect(await gate('t1', 'p1', 'ghost')).toEqual({ ok: false, reason: 'unregistered' });
    expect(await gate('t1', 'p1', 'revoked')).toEqual({ ok: false, reason: 'inactive' });
    expect(await gate('t1', 'p1', 'otherproj')).toEqual({
      ok: false,
      reason: 'project_mismatch',
    });
  });

  it('fails CLOSED when the lookup throws (outage must not open the rail)', async () => {
    const { db } = countingDb({
      'tenants/t1/iot_devices/gas-7': () => {
        throw new Error('firestore down');
      },
    });
    const gate = makeDeviceGate({ db });
    expect(await gate('t1', 'p1', 'gas-7')).toEqual({ ok: false, reason: 'lookup_failed' });
  });

  it('caches positive lookups within the TTL and re-reads after expiry', async () => {
    let now = NOW;
    const { db, getReads } = countingDb({
      'tenants/t1/iot_devices/gas-7': { projectId: 'p1', status: 'active' },
    });
    const gate = makeDeviceGate({ db, positiveTtlMs: 60_000, nowMs: () => now });
    await gate('t1', 'p1', 'gas-7');
    await gate('t1', 'p1', 'gas-7');
    await gate('t1', 'p1', 'gas-7');
    expect(getReads()).toBe(1);
    now += 60_001;
    await gate('t1', 'p1', 'gas-7');
    expect(getReads()).toBe(2);
  });

  it('negative-caches misses with a shorter TTL (rogue-device flood protection)', async () => {
    let now = NOW;
    const { db, getReads } = countingDb({});
    const gate = makeDeviceGate({ db, negativeTtlMs: 15_000, nowMs: () => now });
    await gate('t1', 'p1', 'ghost');
    await gate('t1', 'p1', 'ghost');
    expect(getReads()).toBe(1);
    now += 15_001;
    await gate('t1', 'p1', 'ghost');
    expect(getReads()).toBe(2);
  });
});

// ────────────────────────────────────────────────────────────────────────
// Message handler pipeline
// ────────────────────────────────────────────────────────────────────────

describe('makeMqttMessageHandler', () => {
  beforeEach(() => {
    H.db = createFakeFirestore();
    H.db._seed('tenants/t1/iot_devices/gas-7', { projectId: 'p1', status: 'active' });
  });

  const ctx = (deviceId = 'gas-7') => ({
    tenantId: 't1',
    projectId: 'p1',
    deviceId,
    topic: buildTopic('t1', 'p1', deviceId, 'telemetry'),
  });

  function handler() {
    return makeMqttMessageHandler({
      db: H.db! as unknown as FirebaseFirestore.Firestore,
      messaging: {} as never,
      gate: makeDeviceGate({ db: H.db! as unknown as FirebaseFirestore.Firestore }),
      nowMs: () => NOW,
    });
  }

  const telemetryDocs = () =>
    Object.entries(H.db!._dump()).filter(([k]) => k.startsWith('telemetry_events/'));

  it('ANTI-SILENT-LOSS: reports outcome "failed" (not "persisted") when the telemetry write fails', async () => {
    const real = H.db! as unknown as { collection: (n: string) => any };
    const failingDb = {
      collection: (n: string) => {
        const col = real.collection(n);
        if (n === 'telemetry_events') {
          return {
            ...col,
            add: async () => {
              throw new Error('firestore unavailable');
            },
          };
        }
        return col;
      },
    } as unknown as FirebaseFirestore.Firestore;
    const h = makeMqttMessageHandler({
      db: failingDb,
      messaging: {} as never,
      gate: makeDeviceGate({ db: failingDb }),
      nowMs: () => NOW,
    });
    const out = await h(
      wireSample({ zoneId: 'zona-estanque-3' }) as unknown as TelemetrySample,
      ctx(),
    );
    // The row never landed — the handler must NOT claim it persisted.
    expect(out.outcome).toBe('failed');
    expect(telemetryDocs()).toHaveLength(0);
  });

  it('persists a registered device reading into top-level telemetry_events with zoneId', async () => {
    const out = await handler()(
      wireSample({ zoneId: 'zona-estanque-3' }) as unknown as TelemetrySample,
      ctx(),
    );
    expect(out.outcome).toBe('persisted');
    const docs = telemetryDocs();
    expect(docs).toHaveLength(1);
    expect(docs[0][1]).toMatchObject({
      source: 'gas-7',
      metric: 'o2_pct',
      value: 20.9,
      projectId: 'p1',
      zoneId: 'zona-estanque-3',
      type: 'environmental',
    });
  });

  it('rejects payloads whose deviceId does not match the topic device (spoof)', async () => {
    const out = await handler()(
      wireSample({ deviceId: 'gas-OTRO' }) as unknown as TelemetrySample,
      ctx('gas-7'),
    );
    expect(out).toEqual({ outcome: 'rejected', reason: 'device_id_mismatch' });
    expect(telemetryDocs()).toHaveLength(0);
  });

  it('rejects readings from devices never registered (open topic ≠ write path)', async () => {
    const out = await handler()(
      wireSample({ deviceId: 'ghost' }) as unknown as TelemetrySample,
      ctx('ghost'),
    );
    expect(out).toEqual({ outcome: 'rejected', reason: 'unregistered' });
    expect(telemetryDocs()).toHaveLength(0);
  });

  it('rejects malformed payloads before any Firestore access', async () => {
    const out = await handler()(
      wireSample({ value: 'high' }) as unknown as TelemetrySample,
      ctx(),
    );
    expect(out).toEqual({ outcome: 'rejected', reason: 'invalid_value' });
    expect(telemetryDocs()).toHaveLength(0);
  });

  it('enforces the per-device HMAC when the device doc carries a secret', async () => {
    const secret = 'device-secret-32-bytes-aaaaaaaaaa';
    H.db!._seed('tenants/t1/iot_devices/gas-7', {
      projectId: 'p1',
      status: 'active',
      secret,
    });
    const h = handler();
    const unsigned = wireSample();
    expect(await h(unsigned as unknown as TelemetrySample, ctx())).toEqual({
      outcome: 'rejected',
      reason: 'bad_signature',
    });
    const wrongSig = wireSample({ sig: 'deadbeef' });
    expect(await h(wrongSig as unknown as TelemetrySample, ctx())).toEqual({
      outcome: 'rejected',
      reason: 'bad_signature',
    });
    const payload = wireSample();
    const signed = { ...payload, sig: signPayload(payload, secret) };
    const out = await h(signed as unknown as TelemetrySample, ctx());
    expect(out.outcome).toBe('persisted');
    expect(telemetryDocs()).toHaveLength(1);
  });

  it('never throws — unexpected gate explosions resolve to an error outcome', async () => {
    const exploding = makeMqttMessageHandler({
      db: H.db! as unknown as FirebaseFirestore.Firestore,
      gate: async () => {
        throw new Error('kaboom');
      },
      nowMs: () => NOW,
    });
    await expect(
      exploding(wireSample() as unknown as TelemetrySample, ctx()),
    ).resolves.toEqual({ outcome: 'error' });
  });
});

// ────────────────────────────────────────────────────────────────────────
// Lifecycle
// ────────────────────────────────────────────────────────────────────────

interface FakeClient extends MqttLikeClient {
  emit(event: string, ...args: unknown[]): void;
  ended: boolean;
  subscriptions: string[];
}

function makeFakeMqttModule() {
  const listeners = new Map<string, Array<(...args: unknown[]) => void>>();
  const client: FakeClient = {
    ended: false,
    subscriptions: [],
    on(event, listener) {
      const arr = listeners.get(event) ?? [];
      arr.push(listener);
      listeners.set(event, arr);
      return client;
    },
    emit(event, ...args) {
      for (const fn of listeners.get(event) ?? []) fn(...args);
    },
    subscribe(topic, _opts, cb) {
      client.subscriptions.push(topic);
      cb?.(null);
      return client;
    },
    unsubscribe(_topic, cb) {
      cb?.(null);
      return client;
    },
    publish(_topic, _payload, _opts, cb) {
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

describe('startMqttTelemetryBridge', () => {
  // Tracks any bridge started in a test so afterEach can stop it and
  // release the in-memory adapter's EventEmitter listeners. Without this
  // teardown, tests that call startMqttTelemetryBridge but don't invoke
  // handle.stop() leave the adapter holding live subscriptions → the
  // DETECT_HANDLES reporter flags "leaked listener" handles on the worker.
  let _activeHandle: MqttBridgeHandle | null = null;

  beforeEach(() => {
    H.db = createFakeFirestore();
    H.db._seed('tenants/t1/iot_devices/gas-7', { projectId: 'p1', status: 'active' });
    _activeHandle = null;
  });

  afterEach(async () => {
    if (_activeHandle) {
      try {
        await _activeHandle.stop();
      } catch {
        // ignore stop errors in teardown
      }
      _activeHandle = null;
    }
  });

  const db = () => H.db! as unknown as FirebaseFirestore.Firestore;

  it('returns null and never touches the mqtt module when env carries no config', async () => {
    const { mqttModule, connectCalls } = makeFakeMqttModule();
    const handle = await startMqttTelemetryBridge({ env: {}, db: db(), mqttModule });
    expect(handle).toBeNull();
    expect(connectCalls).toHaveLength(0);
  });

  it('returns null (no crash, no connect) for an invalid broker URL', async () => {
    const { mqttModule, connectCalls } = makeFakeMqttModule();
    const handle = await startMqttTelemetryBridge({
      env: { MQTT_BROKER_URL: 'http://nope' },
      db: db(),
      mqttModule,
    });
    expect(handle).toBeNull();
    expect(connectCalls).toHaveLength(0);
  });

  it('refuses the superseded legacy cloud adapter without connecting', async () => {
    const { mqttModule, connectCalls } = makeFakeMqttModule();
    const handle = await startMqttTelemetryBridge({
      env: { IOT_BROKER_ENABLED: '1', IOT_BROKER_ADAPTER: 'cloud' },
      db: db(),
      mqttModule,
    });
    expect(handle).toBeNull();
    expect(connectCalls).toHaveLength(0);
  });

  it('connects to the broker with credentials and subscribes under the prefix', async () => {
    const { client, mqttModule, connectCalls } = makeFakeMqttModule();
    _activeHandle = await startMqttTelemetryBridge({
      env: {
        MQTT_BROKER_URL: 'mqtts://broker.faena.cl:8883',
        MQTT_USERNAME: 'praeventio',
        MQTT_PASSWORD: 'broker-pass-123',
        MQTT_TOPIC_PREFIX: 'praeventio/prod',
      },
      db: db(),
      mqttModule,
    });
    expect(_activeHandle).not.toBeNull();
    expect(_activeHandle!.mode).toBe('broker');
    expect(connectCalls).toHaveLength(1);
    expect(connectCalls[0].url).toBe('mqtts://broker.faena.cl:8883');
    expect(connectCalls[0].opts).toMatchObject({
      username: 'praeventio',
      password: 'broker-pass-123',
    });
    expect(client.subscriptions).toEqual([
      'praeventio/prod/tenants/+/projects/+/devices/+/telemetry',
    ]);
  });

  it('a broker message from a registered device lands in telemetry_events; rogue devices do not', async () => {
    const { client, mqttModule } = makeFakeMqttModule();
    _activeHandle = await startMqttTelemetryBridge({
      env: { MQTT_BROKER_URL: 'mqtt://broker:1883' },
      db: db(),
      mqttModule,
    });
    const topic = buildTopic('t1', 'p1', 'gas-7', 'telemetry');
    client.emit(
      'message',
      topic,
      Buffer.from(JSON.stringify(wireSample({ timestamp: Date.now(), zoneId: 'z1' }))),
    );
    client.emit(
      'message',
      buildTopic('t1', 'p1', 'ghost', 'telemetry'),
      Buffer.from(
        JSON.stringify(wireSample({ deviceId: 'ghost', timestamp: Date.now() })),
      ),
    );
    await vi.waitFor(() => {
      const docs = Object.entries(H.db!._dump()).filter(([k]) =>
        k.startsWith('telemetry_events/'),
      );
      expect(docs).toHaveLength(1);
      expect(docs[0][1]).toMatchObject({ source: 'gas-7', zoneId: 'z1' });
    });
  });

  it('stop() ends the broker client (graceful SIGTERM path)', async () => {
    const { client, mqttModule } = makeFakeMqttModule();
    _activeHandle = await startMqttTelemetryBridge({
      env: { MQTT_BROKER_URL: 'mqtt://broker:1883' },
      db: db(),
      mqttModule,
    });
    await _activeHandle!.stop();
    _activeHandle = null; // already stopped
    expect(client.ended).toBe(true);
  });

  it('a poison message (Firestore write failing) does not crash the subscription', async () => {
    const { client, mqttModule } = makeFakeMqttModule();
    _activeHandle = await startMqttTelemetryBridge({
      env: { MQTT_BROKER_URL: 'mqtt://broker:1883' },
      db: db(),
      mqttModule,
    });
    H.db!._failReads(''); // every read explodes → gate lookup_failed (fail closed)
    expect(() =>
      client.emit(
        'message',
        buildTopic('t1', 'p1', 'gas-7', 'telemetry'),
        Buffer.from(JSON.stringify(wireSample({ timestamp: Date.now() }))),
      ),
    ).not.toThrow();
    await new Promise((r) => setImmediate(r));
    expect(
      Object.keys(H.db!._dump()).filter((k) => k.startsWith('telemetry_events/')),
    ).toHaveLength(0);
  });

  // ── Integration: MQTT reading → telemetry_events → gas gate verdict ──

  it('INTEGRATION: a published low-O₂ reading becomes a doc the confined-space gas gate blocks on', async () => {
    _activeHandle = await startMqttTelemetryBridge({
      env: { IOT_BROKER_ENABLED: '1', IOT_BROKER_ADAPTER: 'memory' },
      db: db(),
    });
    expect(_activeHandle).not.toBeNull();
    expect(_activeHandle!.mode).toBe('memory');
    const adapter = _activeHandle!.adapter as InMemoryAdapter;

    await adapter.publish(
      buildTopic('t1', 'p1', 'gas-7', 'telemetry'),
      wireSample({ metric: 'o2_pct', value: 16.5, timestamp: Date.now(), zoneId: 'zona-3' }),
    );
    await new Promise((r) => setImmediate(r));

    // Same query shape the workPermits route runs: top-level
    // telemetry_events filtered by (projectId, zoneId).
    const snap = await db()
      .collection('telemetry_events')
      .where('projectId', '==', 'p1')
      .where('zoneId', '==', 'zona-3')
      .get();
    expect(snap.size).toBe(1);

    // Same mapping the route applies (string timestamp → Date.parse).
    const readings = snap.docs.map((d) => {
      const data = d.data()!;
      return {
        metric: data.metric as string,
        value: data.value as number,
        timestampMs: Date.parse(data.timestamp as string),
        source: data.source as string,
      };
    });
    const verdict = evaluateGasTelemetry(readings, Date.now());
    expect(verdict.blocked).toBe(true);
    expect(verdict.reasons.map((r) => r.code)).toContain('GAS_OXYGEN_LOW');
    await _activeHandle!.stop();
    _activeHandle = null; // already stopped
  });
});
