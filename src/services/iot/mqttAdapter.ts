// SPDX-License-Identifier: MIT
//
// Sprint 32 Bucket TT — MQTT adapter (broker + in-memory).
// 2026-06 (claude/mqtt-wire) — real broker adapter implemented.
//
// See ADR 0015 for the strategy. Implementations provided:
//
//   • InMemoryAdapter        — EventEmitter pub/sub for tests & dev local.
//   • createBrokerAdapter    — REAL MQTT broker client over the `mqtt`
//     npm package (mqtt:// mqtts:// ws:// wss://). This is the production
//     path for industrial gas/atmosphere sensors. Auto-reconnects with
//     mqtt.js's built-in backoff (`reconnectPeriod`) and re-subscribes
//     on reconnect (`resubscribe: true`, the mqtt.js default).
//   • createEmqxAdapter      — EMQX self-hosted (data-residency alt).
//     Now a thin delegate to `createBrokerAdapter` with mTLS PEMs.
//   • createCloudIotCoreAdapter — SUPERSEDED. Google retired Cloud IoT
//     Core in 2023; the factory remains only so legacy configs fail with
//     a clear migration message (point MQTT_BROKER_URL at any standard
//     broker instead). It must stay OFF the boot path.
//
// Note: `mqtt@^5` IS a repo dependency (package.json) — older comments
// claiming otherwise were stale. The dynamic import is kept so merely
// importing this module never loads the client lib (server cold-start).
//
// Wildcard topic matching follows MQTT spec semantics:
//   • `+`  matches a single level (e.g. `tenants/+/projects/p1/...`).
//   • `#`  matches all remaining levels (terminal only, e.g. `tenants/t1/#`).

import { EventEmitter } from 'node:events';
import { randomId } from '../../utils/randomId.js';
import { logger } from '../../utils/logger.js';
import type { TelemetrySample } from './types.js';

export type Qos = 0 | 1 | 2;

export interface PublishOpts {
  qos?: Qos;
  retain?: boolean;
}

export type SampleHandler = (msg: TelemetrySample, topic: string) => void;

export interface MqttAdapter {
  publish(topic: string, payload: Buffer | object, opts?: PublishOpts): Promise<void>;
  subscribe(topic: string, handler: SampleHandler): Promise<void>;
  unsubscribe(topic: string): Promise<void>;
  close(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Topic matching helpers (exported for tests).
// ---------------------------------------------------------------------------

/**
 * Returns true when `topic` matches the MQTT-style `pattern`.
 *
 * Supported wildcards:
 *   `+` — exactly one level
 *   `#` — any remaining levels (must be the last segment)
 */
export function topicMatches(pattern: string, topic: string): boolean {
  const pa = pattern.split('/');
  const ta = topic.split('/');
  for (let i = 0; i < pa.length; i++) {
    const p = pa[i];
    if (p === '#') return true;
    if (p === '+') {
      if (ta[i] === undefined) return false;
      continue;
    }
    if (p !== ta[i]) return false;
  }
  return pa.length === ta.length;
}

function isLikelyTelemetrySample(x: unknown): x is TelemetrySample {
  if (!x || typeof x !== 'object') return false;
  const o = x as any;
  return (
    typeof o.deviceId === 'string' &&
    typeof o.timestamp === 'number' &&
    typeof o.metric === 'string' &&
    typeof o.value === 'number' &&
    typeof o.unit === 'string'
  );
}

// ---------------------------------------------------------------------------
// InMemoryAdapter — used by tests and `IOT_BROKER_ADAPTER=memory` dev mode.
// ---------------------------------------------------------------------------

/**
 * In-memory broker. All `publish` calls fan out synchronously to every
 * subscriber whose topic pattern matches. `close()` removes all
 * listeners; further publish/subscribe calls reject with "closed".
 */
export class InMemoryAdapter implements MqttAdapter {
  private bus = new EventEmitter();
  // pattern → wrapped listener (so unsubscribe can remove the right ref)
  private patterns = new Map<string, Set<(t: string, raw: unknown) => void>>();
  private closed = false;

  async publish(topic: string, payload: Buffer | object, _opts: PublishOpts = {}): Promise<void> {
    if (this.closed) throw new Error('InMemoryAdapter closed');
    let parsed: unknown;
    if (Buffer.isBuffer(payload)) {
      try {
        parsed = JSON.parse(payload.toString('utf8'));
      } catch {
        // Binary frames not understood by the in-memory adapter yet;
        // emit raw buffer so producer-side tests can still observe.
        parsed = { _raw: payload };
      }
    } else {
      parsed = payload;
    }
    this.bus.emit('msg', topic, parsed);
  }

  async subscribe(topic: string, handler: SampleHandler): Promise<void> {
    if (this.closed) throw new Error('InMemoryAdapter closed');
    const wrapped = (t: string, raw: unknown) => {
      if (!topicMatches(topic, t)) return;
      if (!isLikelyTelemetrySample(raw)) return;
      try {
        handler(raw as TelemetrySample, t);
      } catch {
        // Listener errors must NOT poison the bus.
      }
    };
    let set = this.patterns.get(topic);
    if (!set) {
      set = new Set();
      this.patterns.set(topic, set);
    }
    set.add(wrapped);
    this.bus.on('msg', wrapped);
  }

  async unsubscribe(topic: string): Promise<void> {
    const set = this.patterns.get(topic);
    if (!set) return;
    for (const w of set) this.bus.off('msg', w);
    this.patterns.delete(topic);
  }

  async close(): Promise<void> {
    this.closed = true;
    this.bus.removeAllListeners();
    this.patterns.clear();
  }
}

// ---------------------------------------------------------------------------
// BrokerAdapter — real MQTT broker client (mqtt.js). Production path.
// ---------------------------------------------------------------------------

/**
 * Minimal structural surface of an `mqtt.MqttClient` — only what the
 * adapter uses. Declared locally so tests can inject a fake client and
 * the `mqtt` package stays a lazy import.
 */
export interface MqttLikeClient {
  on(event: string, listener: (...args: unknown[]) => void): unknown;
  subscribe(
    topic: string,
    opts: { qos: Qos },
    cb?: (err?: Error | null) => void,
  ): unknown;
  unsubscribe(topic: string, cb?: (err?: Error | null) => void): unknown;
  publish(
    topic: string,
    payload: string | Buffer,
    opts: { qos: Qos; retain?: boolean },
    cb?: (err?: Error | null) => void,
  ): unknown;
  end(force?: boolean, opts?: Record<string, never>, cb?: () => void): unknown;
}

export interface MqttConnectModule {
  connect(url: string, opts: Record<string, unknown>): MqttLikeClient;
}

export interface BrokerAdapterOptions {
  /** Broker URL — mqtt://, mqtts://, ws:// or wss://. */
  url: string;
  /** Broker credentials (broker-level auth — see trust model in the bridge). */
  username?: string;
  password?: string;
  /** Optional mTLS PEM strings (EMQX / self-hosted brokers). */
  ca?: string;
  cert?: string;
  key?: string;
  /** Stable client id. Defaults to a random per-process id. */
  clientId?: string;
  /** mqtt.js auto-reconnect period. Default 5000 ms. */
  reconnectPeriodMs?: number;
  connectTimeoutMs?: number;
  /**
   * Test seam: inject a fake `mqtt` module. When absent the real package
   * is dynamically imported (it IS a dependency — see header).
   */
  mqttModule?: MqttConnectModule;
}

/**
 * Real `MqttAdapter` over a standard MQTT broker. Behavior contract:
 *
 *   • The factory NEVER blocks on the broker being reachable: mqtt.js
 *     queues subscribe/publish while offline and replays them on connect,
 *     and reconnects forever with `reconnectPeriod` backoff. A dead broker
 *     therefore degrades the feature, never the server (fault isolation).
 *   • Inbound payloads MUST be UTF-8 JSON matching the TelemetrySample
 *     shape; anything else is counted + dropped (an open topic is full of
 *     retained noise — the bridge layer re-validates and authorizes).
 *   • Handler exceptions are swallowed (a listener must not poison the bus).
 */
export async function createBrokerAdapter(
  opts: BrokerAdapterOptions,
): Promise<MqttAdapter> {
  const mqttModule: MqttConnectModule =
    opts.mqttModule ?? ((await import('mqtt')).default as unknown as MqttConnectModule);

  const client = mqttModule.connect(opts.url, {
    clientId: opts.clientId ?? `praeventio-bridge-${randomId()}`,
    username: opts.username,
    password: opts.password,
    ...(opts.ca ? { ca: opts.ca } : {}),
    ...(opts.cert ? { cert: opts.cert } : {}),
    ...(opts.key ? { key: opts.key } : {}),
    reconnectPeriod: opts.reconnectPeriodMs ?? 5000,
    connectTimeout: opts.connectTimeoutMs ?? 30_000,
    clean: true,
    // mqtt.js default, made explicit: re-subscribe registered topics on
    // every reconnect so a broker restart doesn't silence the bridge.
    resubscribe: true,
  });

  // pattern → handlers registered through subscribe().
  const patterns = new Map<string, Set<SampleHandler>>();
  let closed = false;
  let droppedMalformed = 0;

  client.on('connect', () => {
    logger.info('iot_mqtt_broker_connected', { url: opts.url });
  });
  client.on('reconnect', () => {
    logger.warn('iot_mqtt_broker_reconnecting', { url: opts.url });
  });
  client.on('error', (err: unknown) => {
    // NEVER throw — mqtt.js keeps retrying; we only observe.
    logger.warn('iot_mqtt_broker_error', {
      url: opts.url,
      message: err instanceof Error ? err.message : String(err),
    });
  });
  client.on('message', (...args: unknown[]) => {
    const topic = args[0] as string;
    const payload = args[1] as Buffer;
    let parsed: unknown;
    try {
      parsed = JSON.parse(payload.toString('utf8'));
    } catch {
      droppedMalformed += 1;
      logger.warn('iot_mqtt_payload_not_json', { topic, droppedMalformed });
      return;
    }
    if (!isLikelyTelemetrySample(parsed)) {
      droppedMalformed += 1;
      logger.warn('iot_mqtt_payload_not_sample', { topic, droppedMalformed });
      return;
    }
    for (const [pattern, handlers] of patterns) {
      if (!topicMatches(pattern, topic)) continue;
      for (const handler of handlers) {
        try {
          handler(parsed as TelemetrySample, topic);
        } catch (err) {
          // Handler errors must not poison the bus (InMemoryAdapter parity).
          logger.warn('iot_mqtt_handler_threw', {
            topic,
            message: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }
  });

  return {
    async publish(topic, payload, publishOpts: PublishOpts = {}) {
      if (closed) throw new Error('BrokerAdapter closed');
      const body = Buffer.isBuffer(payload) ? payload : JSON.stringify(payload);
      await new Promise<void>((resolve, reject) => {
        client.publish(
          topic,
          body,
          { qos: publishOpts.qos ?? 1, retain: publishOpts.retain ?? false },
          (err) => (err ? reject(err) : resolve()),
        );
      });
    },
    async subscribe(topic, handler) {
      if (closed) throw new Error('BrokerAdapter closed');
      let set = patterns.get(topic);
      if (!set) {
        set = new Set();
        patterns.set(topic, set);
      }
      set.add(handler);
      // Intentionally NOT awaiting the suback: while the broker is offline
      // mqtt.js queues the subscription, so awaiting would hang boot. The
      // callback only logs the outcome.
      client.subscribe(topic, { qos: 1 }, (err) => {
        if (err) {
          logger.warn('iot_mqtt_subscribe_failed', { topic, message: err.message });
        }
      });
    },
    async unsubscribe(topic) {
      patterns.delete(topic);
      await new Promise<void>((resolve) => {
        client.unsubscribe(topic, () => resolve());
      });
    },
    async close() {
      closed = true;
      patterns.clear();
      await new Promise<void>((resolve) => {
        client.end(false, {}, () => resolve());
      });
    },
  };
}

// ---------------------------------------------------------------------------
// CloudIotCoreAdapter — SUPERSEDED (kept only for a clear failure message).
// ---------------------------------------------------------------------------

export interface CloudIotCoreOptions {
  projectId: string;
  region: string;
  registryId: string;
  /** Path or PEM string of the service-account credentials. */
  credentials?: string;
}

/**
 * SUPERSEDED (2026-06, claude/mqtt-wire): Google retired Cloud IoT Core
 * in August 2023 — there is no service to connect to. The factory is kept
 * only so legacy `IOT_BROKER_ADAPTER=cloud` configs fail with a clear
 * migration message instead of a cryptic import error. The bridge config
 * resolver (src/server/triggers/mqttTelemetryBridge.ts) refuses this
 * adapter at boot, so this never runs in production.
 */
export async function createCloudIotCoreAdapter(
  _opts: CloudIotCoreOptions,
): Promise<MqttAdapter> {
  throw new Error(
    'createCloudIotCoreAdapter: Cloud IoT Core was retired by Google (2023) — ' +
      'superseded by the generic broker adapter. Point MQTT_BROKER_URL at any ' +
      'standard MQTT broker (EMQX, Mosquitto, HiveMQ) instead. See ADR 0015.',
  );
}

// ---------------------------------------------------------------------------
// EmqxAdapter — data-residency alt. Lazy-imported.
// ---------------------------------------------------------------------------

export interface EmqxAdapterOptions {
  /** mqtts://host:port */
  url: string;
  /** PEM string of the client cert. */
  cert: string;
  /** PEM string of the client private key. */
  key: string;
  /** PEM string(s) of the CA bundle. */
  ca: string;
}

/**
 * EMQX self-hosted (data-residency alternative, ADR 0015). Real since
 * 2026-06 (claude/mqtt-wire): a thin delegate to the generic broker
 * adapter with the mTLS PEM material EMQX clusters expect.
 */
export async function createEmqxAdapter(opts: EmqxAdapterOptions): Promise<MqttAdapter> {
  return createBrokerAdapter({
    url: opts.url,
    ca: opts.ca,
    cert: opts.cert,
    key: opts.key,
  });
}

// ---------------------------------------------------------------------------
// Factory selector — boot-time entry point. Default = memory.
// ---------------------------------------------------------------------------

export type IotBrokerAdapterName = 'cloud' | 'emqx' | 'memory' | 'broker';

export interface BuildAdapterOptions {
  cloud?: CloudIotCoreOptions;
  emqx?: EmqxAdapterOptions;
  broker?: BrokerAdapterOptions;
}

export async function buildMqttAdapter(
  name: IotBrokerAdapterName,
  opts: BuildAdapterOptions = {},
): Promise<MqttAdapter> {
  switch (name) {
    case 'memory':
      return new InMemoryAdapter();
    case 'cloud':
      if (!opts.cloud) throw new Error('buildMqttAdapter: opts.cloud is required for cloud');
      return createCloudIotCoreAdapter(opts.cloud);
    case 'emqx':
      if (!opts.emqx) throw new Error('buildMqttAdapter: opts.emqx is required for emqx');
      return createEmqxAdapter(opts.emqx);
    case 'broker':
      if (!opts.broker) throw new Error('buildMqttAdapter: opts.broker is required for broker');
      return createBrokerAdapter(opts.broker);
    default: {
      const _exhaustive: never = name;
      throw new Error(`buildMqttAdapter: unknown adapter ${_exhaustive}`);
    }
  }
}

/**
 * Helper — build a canonical topic for a (tenant, project, device, kind).
 * Used by both publishers (devices via REST fallback) and subscribers
 * (server gateway, dashboards) so the spelling is identical everywhere.
 */
export function buildTopic(
  tenantId: string,
  projectId: string,
  deviceId: string,
  kind: 'telemetry' | 'status' | 'heartbeat' | 'alert',
): string {
  return `tenants/${tenantId}/projects/${projectId}/devices/${deviceId}/${kind}`;
}

// ---------------------------------------------------------------------------
// connectMqttBroker — boot helper consumed from server.ts.
//
// Sprint 32 P0 audit fix: previously the adapter shipped without a
// boot path. This helper builds the adapter from env, subscribes to the
// canonical telemetry topic wildcard, parses each `tenants/{t}/projects/
// {p}/devices/{d}/telemetry` topic into a (tenantId, projectId) tuple,
// and forwards the sample to the supplied handler. Failures during
// connect are logged and rethrown so the boot path can decide whether
// to fail-fast or degrade.
// ---------------------------------------------------------------------------

export interface ConnectMqttBrokerOptions {
  adapter: IotBrokerAdapterName;
  cloud?: CloudIotCoreOptions;
  emqx?: EmqxAdapterOptions;
  broker?: BrokerAdapterOptions;
  /**
   * Pre-built adapter instance — takes precedence over `adapter` name.
   * Lets the bridge boot module own adapter construction (and tests
   * inject an InMemoryAdapter while exercising the full wrapper).
   */
  adapterInstance?: MqttAdapter;
  /**
   * Telemetry handler invoked once per inbound sample. The wrapper
   * extracts `tenantId` + `projectId` + `deviceId` from the topic so the
   * handler gets a tenant-scoped, device-attributable context for the
   * Firestore write — topic identity is the trust anchor, NEVER payload
   * fields (device-controlled, spoofable).
   */
  onTelemetry: (
    sample: TelemetrySample,
    ctx: { tenantId: string; projectId: string; deviceId: string; topic: string },
  ) => void | Promise<void>;
  /**
   * Optional topic pattern override. Defaults to all tenants' telemetry:
   *   `tenants/+/projects/+/devices/+/telemetry`
   */
  topicPattern?: string;
  /**
   * Optional broker namespace prefix (e.g. `praeventio/prod`). Prepended
   * to the subscribe pattern and stripped before canonical-topic parsing.
   * No trailing slash.
   */
  topicPrefix?: string | null;
}

export interface ConnectedBroker {
  adapter: MqttAdapter;
  unsubscribe: () => Promise<void>;
}

/**
 * Parse a canonical telemetry topic. Returns null when the topic does
 * not match the canonical 6-segment shape — used to drop noise from
 * sibling streams (status/heartbeat/alert) so the bridge handler only
 * sees telemetry samples.
 */
export function parseCanonicalTelemetryTopic(
  topic: string,
): { tenantId: string; projectId: string; deviceId: string } | null {
  const parts = topic.split('/');
  if (parts.length !== 7) return null;
  if (parts[0] !== 'tenants' || parts[2] !== 'projects' || parts[4] !== 'devices') {
    return null;
  }
  if (parts[6] !== 'telemetry') return null;
  return { tenantId: parts[1], projectId: parts[3], deviceId: parts[5] };
}

export async function connectMqttBroker(
  opts: ConnectMqttBrokerOptions,
): Promise<ConnectedBroker> {
  const adapter =
    opts.adapterInstance ??
    (await buildMqttAdapter(opts.adapter, {
      cloud: opts.cloud,
      emqx: opts.emqx,
      broker: opts.broker,
    }));
  const prefix =
    typeof opts.topicPrefix === 'string' && opts.topicPrefix.length > 0
      ? opts.topicPrefix
      : null;
  const canonicalPattern =
    opts.topicPattern ?? 'tenants/+/projects/+/devices/+/telemetry';
  const pattern = prefix ? `${prefix}/${canonicalPattern}` : canonicalPattern;
  await adapter.subscribe(pattern, (sample, topic) => {
    const canonicalTopic =
      prefix && topic.startsWith(`${prefix}/`)
        ? topic.slice(prefix.length + 1)
        : topic;
    const parsed = parseCanonicalTelemetryTopic(canonicalTopic);
    if (!parsed) return;
    void Promise.resolve(
      opts.onTelemetry(sample, {
        tenantId: parsed.tenantId,
        projectId: parsed.projectId,
        deviceId: parsed.deviceId,
        topic,
      }),
    ).catch(() => {
      // Bridge handler errors must not poison the bus — they are already
      // logged via the bridge's own getErrorTracker path.
    });
  });
  return {
    adapter,
    unsubscribe: async () => {
      await adapter.unsubscribe(pattern);
      await adapter.close();
    },
  };
}
