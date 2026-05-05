// SPDX-License-Identifier: MIT
//
// Sprint 32 Bucket TT — MQTT adapter (dual + in-memory).
//
// See ADR 0015 for the strategy. Three implementations are provided:
//
//   • InMemoryAdapter        — EventEmitter pub/sub for tests & dev local.
//   • createCloudIotCoreAdapter — factory for Google Cloud IoT Core
//     (production default). Lazy-imports `googleapis` (already a dep) and
//     `mqtt`. NOT wired into prod boot here — server.ts opt-in by
//     IOT_BROKER_ADAPTER=cloud.
//   • createEmqxAdapter      — factory for EMQX self-hosted (data
//     residency alt). Lazy-imports `mqtt`. NOT wired into prod boot here.
//
// The lazy-import is intentional: `mqtt` is NOT a dependency of the
// repo today. Tests run against InMemoryAdapter only; the cloud / emqx
// factories throw a clear error if called without the package installed,
// but importing this module never crashes.
//
// Wildcard topic matching follows MQTT spec semantics:
//   • `+`  matches a single level (e.g. `tenants/+/projects/p1/...`).
//   • `#`  matches all remaining levels (terminal only, e.g. `tenants/t1/#`).

import { EventEmitter } from 'node:events';
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
// CloudIotCoreAdapter — default productive backend. Lazy-imported.
// ---------------------------------------------------------------------------

export interface CloudIotCoreOptions {
  projectId: string;
  region: string;
  registryId: string;
  /** Path or PEM string of the service-account credentials. */
  credentials?: string;
}

/**
 * Returns a `MqttAdapter` that bridges to Google Cloud IoT Core via the
 * `googleapis` cloudiot v1 client (already a dep) for control-plane
 * (device CRUD) and via the `mqtt` npm package for the data plane.
 *
 * Throws clearly if `mqtt` is not installed — keep this off the boot
 * path until the dep is added. The factory is async so the dynamic
 * import happens only when the operator opts in via env.
 */
export async function createCloudIotCoreAdapter(
  _opts: CloudIotCoreOptions,
): Promise<MqttAdapter> {
  let mqttPkg: any;
  try {
    mqttPkg = await import('mqtt');
  } catch (err) {
    throw new Error(
      'createCloudIotCoreAdapter: package "mqtt" is not installed. ' +
        'Add it to package.json or set IOT_BROKER_ADAPTER=memory for dev.',
    );
  }
  // Stub: real implementation wires JWT short-lived password, MQTT
  // bridge endpoint, etc. Out of scope for Bucket TT — we ship the
  // contract + the in-memory implementation; cloud + emqx land in
  // Sprint 33 H1 once the `mqtt` dep is approved.
  void mqttPkg;
  throw new Error(
    'createCloudIotCoreAdapter: not yet implemented. Use InMemoryAdapter or ' +
      'createEmqxAdapter (also stubbed) until Sprint 33 H1.',
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

export async function createEmqxAdapter(_opts: EmqxAdapterOptions): Promise<MqttAdapter> {
  try {
    await import('mqtt');
  } catch (err) {
    throw new Error(
      'createEmqxAdapter: package "mqtt" is not installed. ' +
        'Add it to package.json or set IOT_BROKER_ADAPTER=memory for dev.',
    );
  }
  throw new Error(
    'createEmqxAdapter: not yet implemented. Use InMemoryAdapter until Sprint 33 H1.',
  );
}

// ---------------------------------------------------------------------------
// Factory selector — boot-time entry point. Default = memory.
// ---------------------------------------------------------------------------

export type IotBrokerAdapterName = 'cloud' | 'emqx' | 'memory';

export interface BuildAdapterOptions {
  cloud?: CloudIotCoreOptions;
  emqx?: EmqxAdapterOptions;
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
  /**
   * Telemetry handler invoked once per inbound sample. The wrapper
   * extracts `tenantId` + `projectId` from the topic so the handler
   * gets a tenant-scoped context for the Firestore write.
   */
  onTelemetry: (
    sample: TelemetrySample,
    ctx: { tenantId: string; projectId: string; topic: string },
  ) => void | Promise<void>;
  /**
   * Optional topic pattern override. Defaults to all tenants' telemetry:
   *   `tenants/+/projects/+/devices/+/telemetry`
   */
  topicPattern?: string;
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
  const adapter = await buildMqttAdapter(opts.adapter, {
    cloud: opts.cloud,
    emqx: opts.emqx,
  });
  const pattern = opts.topicPattern ?? 'tenants/+/projects/+/devices/+/telemetry';
  await adapter.subscribe(pattern, (sample, topic) => {
    const parsed = parseCanonicalTelemetryTopic(topic);
    if (!parsed) return;
    void Promise.resolve(
      opts.onTelemetry(sample, {
        tenantId: parsed.tenantId,
        projectId: parsed.projectId,
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
