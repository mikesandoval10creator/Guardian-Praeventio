// Praeventio Guard — MQTT → telemetry_events bridge (claude/mqtt-wire, 2026-06).
//
// Closes the audit "MQTT island": ADR 0015 shipped the adapter contract +
// InMemoryAdapter, server.ts had a boot block, but the real-broker factories
// threw "not yet implemented" — no physical gas/atmosphere sensor could ever
// reach the app. This module is the long-lived server-side subscriber
// (same lifecycle family as src/server/triggers/backgroundTriggers.ts:
// started once from server.ts after listen, handle captured, released on
// SIGTERM, and NEVER doing work at import time).
//
// Data path:  sensor → MQTT broker → BrokerAdapter (mqtt.js, auto-reconnect)
//   → connectMqttBroker wrapper (canonical topic parse, prefix strip)
//   → sanitizeInboundSample (pure validation)
//   → device gate (MUST be registered via POST /api/iot/devices/register)
//   → optional per-device HMAC (if the device doc carries a `secret`)
//   → bridgeMqttToFirestore → TOP-LEVEL `telemetry_events` (ingest schema)
//   → consumed transparently by the confined-space gas gate
//     (src/server/routes/workPermits.ts), Telemetry.tsx, Evacuation.tsx.
//
// ── Trust model ─────────────────────────────────────────────────────────
// The HTTP ingest (src/server/routes/telemetry.ts) authenticates with a
// per-TENANT HMAC over the canonical body. MQTT's equivalent transport
// auth is the BROKER connection itself (mqtts:// + credentials/mTLS — the
// broker is operator-provisioned and must NOT allow anonymous publish;
// ADR 0015's X.509-per-device model is enforced at the broker). On top of
// that, this bridge enforces APPLICATION-level authorization so an open
// or misconfigured topic can never become an unauthenticated write path
// into life-safety data:
//   1. Topic identity is the only trusted identity (tenants/{t}/projects/
//      {p}/devices/{d}/telemetry). Payload `deviceId` MUST match the topic
//      deviceId or the sample is rejected (spoof attempt).
//   2. The device MUST exist at `tenants/{t}/iot_devices/{d}` with
//      status 'active' and `projectId` matching the topic project — i.e.
//      enrolled through the existing verifyAuth + role-gated registration
//      flow. Unregistered/revoked devices are rejected. Lookup failures
//      fail CLOSED (a Firestore outage must not open the rail).
//   3. Defense-in-depth: if the device doc carries a `secret`, the payload
//      MUST include `sig` = HMAC-SHA256 hex over the RFC 8785 canonical
//      JSON of the payload WITHOUT `sig` (same canonicalization contract
//      as the HTTP ingest). Devices without a stored secret rely on
//      broker auth + registration (documented operator choice).
//
// ── Config (env) ────────────────────────────────────────────────────────
//   MQTT_BROKER_URL    — mqtt:// mqtts:// ws:// wss://. ABSENT ⇒ bridge
//                        cleanly OFF (logged once at boot, no connections).
//   MQTT_USERNAME / MQTT_PASSWORD — broker credentials (optional).
//   MQTT_TOPIC_PREFIX  — broker namespace (e.g. `praeventio/prod`), optional.
//   MQTT_TLS_CA / MQTT_TLS_CERT / MQTT_TLS_KEY — PEM strings for mTLS, optional.
//   MQTT_CLIENT_ID     — stable client id (optional; random per boot otherwise).
// Legacy (pre-wire) envs still honored when MQTT_BROKER_URL is absent:
//   IOT_BROKER_ENABLED='1' + IOT_BROKER_ADAPTER='memory' → in-process bus
//   (dev/tests); 'emqx' → IOT_EMQX_URL/CA/CERT/KEY; 'cloud'/'gcp' →
//   refused (Cloud IoT Core retired 2023 — superseded, see ADR 0015).
//
// Fault isolation: a broker outage, malformed payload, rogue device or
// Firestore hiccup degrades THIS feature only — `startMqttTelemetryBridge`
// never throws, the message handler never throws, and mqtt.js reconnects
// on its own. The HTTP ingest rail is untouched either way.

import crypto from 'node:crypto';
import admin from 'firebase-admin';
import {
  connectMqttBroker,
  InMemoryAdapter,
  createBrokerAdapter,
  type ConnectedBroker,
  type MqttAdapter,
  type MqttConnectModule,
} from '../../services/iot/mqttAdapter.js';
import { bridgeMqttToFirestore } from '../../services/iot/firestoreBridge.js';
import type { TelemetrySample, IotDeviceKind } from '../../services/iot/types.js';
import { canonicalize } from '../middleware/canonicalBody.js';
import { safeSecretEqual } from '../middleware/safeSecretEqual.js';
import { logger } from '../../utils/logger.js';

// ────────────────────────────────────────────────────────────────────────
// Config resolution (pure)
// ────────────────────────────────────────────────────────────────────────

const ALLOWED_URL_PROTOCOLS = new Set(['mqtt:', 'mqtts:', 'ws:', 'wss:']);

export interface BrokerBridgeConfig {
  mode: 'broker';
  url: string;
  username?: string;
  password?: string;
  ca?: string;
  cert?: string;
  key?: string;
  clientId?: string;
  topicPrefix: string | null;
  /** Which env contract produced this config (observability only). */
  source: 'mqtt-env' | 'legacy-emqx';
}

export interface MemoryBridgeConfig {
  mode: 'memory';
}

export type MqttBridgeConfig = BrokerBridgeConfig | MemoryBridgeConfig;

export interface ResolvedMqttBridgeConfig {
  config: MqttBridgeConfig | null;
  /**
   * Non-null when the bridge is OFF. 'disabled' = clean absence of config
   * (expected, logged at info); anything else = present-but-broken config
   * (logged at error so operators notice).
   */
  disabledReason:
    | 'disabled'
    | 'invalid_broker_url'
    | 'legacy_emqx_missing_url'
    | 'legacy_cloud_superseded'
    | 'legacy_unknown_adapter'
    | null;
}

function nonEmpty(v: string | undefined): string | undefined {
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : undefined;
}

function isValidBrokerUrl(raw: string): boolean {
  try {
    return ALLOWED_URL_PROTOCOLS.has(new URL(raw).protocol);
  } catch {
    return false;
  }
}

/** Normalize a topic prefix: trim, strip leading/trailing slashes, ''→null. */
export function normalizeTopicPrefix(raw: string | undefined): string | null {
  const trimmed = (raw ?? '').trim().replace(/^\/+|\/+$/g, '');
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Pure env → config resolution. ABSENT config ⇒ `{config: null,
 * disabledReason: 'disabled'}` — the bridge stays cleanly OFF.
 */
export function resolveMqttBridgeConfig(
  env: Record<string, string | undefined>,
): ResolvedMqttBridgeConfig {
  const url = nonEmpty(env.MQTT_BROKER_URL);
  if (url) {
    if (!isValidBrokerUrl(url)) {
      return { config: null, disabledReason: 'invalid_broker_url' };
    }
    return {
      config: {
        mode: 'broker',
        url,
        username: nonEmpty(env.MQTT_USERNAME),
        password: nonEmpty(env.MQTT_PASSWORD),
        ca: nonEmpty(env.MQTT_TLS_CA),
        cert: nonEmpty(env.MQTT_TLS_CERT),
        key: nonEmpty(env.MQTT_TLS_KEY),
        clientId: nonEmpty(env.MQTT_CLIENT_ID),
        topicPrefix: normalizeTopicPrefix(env.MQTT_TOPIC_PREFIX),
        source: 'mqtt-env',
      },
      disabledReason: null,
    };
  }

  // Legacy contract (Sprint 32 TT) — preserved so existing deployments keep
  // their semantics while migrating to MQTT_BROKER_URL.
  if (env.IOT_BROKER_ENABLED === '1') {
    const adapter = nonEmpty(env.IOT_BROKER_ADAPTER) ?? 'memory';
    if (adapter === 'memory') {
      return { config: { mode: 'memory' }, disabledReason: null };
    }
    if (adapter === 'emqx') {
      const emqxUrl = nonEmpty(env.IOT_EMQX_URL);
      if (!emqxUrl || !isValidBrokerUrl(emqxUrl)) {
        return { config: null, disabledReason: 'legacy_emqx_missing_url' };
      }
      return {
        config: {
          mode: 'broker',
          url: emqxUrl,
          ca: nonEmpty(env.IOT_EMQX_CA),
          cert: nonEmpty(env.IOT_EMQX_CERT),
          key: nonEmpty(env.IOT_EMQX_KEY),
          topicPrefix: normalizeTopicPrefix(env.MQTT_TOPIC_PREFIX),
          source: 'legacy-emqx',
        },
        disabledReason: null,
      };
    }
    if (adapter === 'cloud' || adapter === 'gcp') {
      return { config: null, disabledReason: 'legacy_cloud_superseded' };
    }
    return { config: null, disabledReason: 'legacy_unknown_adapter' };
  }

  return { config: null, disabledReason: 'disabled' };
}

// ────────────────────────────────────────────────────────────────────────
// Inbound payload validation (pure)
// ────────────────────────────────────────────────────────────────────────

/** Same charset/length contract as RegisterDeviceSchema (routes/iot.ts). */
const DEVICE_ID_RE = /^[A-Za-z0-9_\-:.]{1,128}$/;

/** Server rejects samples stamped further in the future (types.ts contract). */
export const MQTT_MAX_FUTURE_SKEW_MS = 5 * 60_000;

const DEVICE_KINDS: ReadonlySet<string> = new Set<IotDeviceKind>([
  'wearable',
  'gas-sensor',
  'co2-monitor',
  'machinery',
  'environment',
]);

export type SampleVerdict =
  | { ok: true; sample: TelemetrySample; zoneId: string | null; sig: string | null }
  | {
      ok: false;
      reason:
        | 'invalid_device_id'
        | 'invalid_metric'
        | 'invalid_value'
        | 'invalid_unit'
        | 'invalid_timestamp'
        | 'future_timestamp';
    };

/**
 * Re-validate an inbound wire payload (the adapter only shape-checks).
 * Device-controlled, so everything is bounded; malformed optional fields
 * (zoneId, kind) degrade to absent rather than rejecting — mirroring the
 * HTTP ingest's zoneId policy.
 */
export function sanitizeInboundSample(
  raw: Record<string, unknown>,
  nowMs: number,
): SampleVerdict {
  const { deviceId, metric, value, unit, timestamp, kind, zoneId, sig } = raw;
  if (typeof deviceId !== 'string' || !DEVICE_ID_RE.test(deviceId)) {
    return { ok: false, reason: 'invalid_device_id' };
  }
  if (typeof metric !== 'string' || metric.length === 0 || metric.length > 64) {
    return { ok: false, reason: 'invalid_metric' };
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return { ok: false, reason: 'invalid_value' };
  }
  if (typeof unit !== 'string' || unit.length > 32) {
    return { ok: false, reason: 'invalid_unit' };
  }
  if (typeof timestamp !== 'number' || !Number.isFinite(timestamp)) {
    return { ok: false, reason: 'invalid_timestamp' };
  }
  if (timestamp > nowMs + MQTT_MAX_FUTURE_SKEW_MS) {
    return { ok: false, reason: 'future_timestamp' };
  }
  const sample: TelemetrySample = {
    deviceId,
    metric,
    value,
    unit,
    timestamp,
    ...(typeof kind === 'string' && DEVICE_KINDS.has(kind)
      ? { kind: kind as IotDeviceKind }
      : {}),
  };
  return {
    ok: true,
    sample,
    zoneId:
      typeof zoneId === 'string' && zoneId.length > 0 && zoneId.length <= 128
        ? zoneId
        : null,
    sig: typeof sig === 'string' && sig.length > 0 && sig.length <= 256 ? sig : null,
  };
}

/**
 * Defense-in-depth per-device HMAC: `sig` must be the hex HMAC-SHA256 of
 * the RFC 8785 canonical JSON of the payload WITHOUT its `sig` field —
 * the same canonicalization contract producers already implement for the
 * HTTP ingest. Timing-safe comparison.
 */
export function verifyDeviceSignature(
  rawPayload: Record<string, unknown>,
  sig: string | null,
  secret: string,
): boolean {
  if (!sig) return false;
  const { sig: _omitted, ...unsigned } = rawPayload;
  const expected = crypto
    .createHmac('sha256', secret)
    .update(canonicalize(unsigned))
    .digest('hex');
  return safeSecretEqual(sig, expected);
}

// ────────────────────────────────────────────────────────────────────────
// Device authorization gate (registered-device check, cached)
// ────────────────────────────────────────────────────────────────────────

export type DeviceGateResult =
  | { ok: true; secret: string | null }
  | { ok: false; reason: 'unregistered' | 'inactive' | 'project_mismatch' | 'lookup_failed' };

export type DeviceGate = (
  tenantId: string,
  projectId: string,
  deviceId: string,
) => Promise<DeviceGateResult>;

export interface DeviceGateOptions {
  db: FirebaseFirestore.Firestore;
  /** Cache TTL for known-device docs. Default 60 s. */
  positiveTtlMs?: number;
  /** Cache TTL for misses (rogue devices can flood). Default 15 s. */
  negativeTtlMs?: number;
  /** Injectable clock for tests. */
  nowMs?: () => number;
}

interface CachedDevice {
  expiresAtMs: number;
  /** null = doc does not exist. */
  data: Record<string, unknown> | null;
}

/**
 * Authorize (tenantId, projectId, deviceId) against the registration store
 * `tenants/{t}/iot_devices/{d}` written by POST /api/iot/devices/register.
 * A short in-memory TTL cache keeps high-frequency sensors from costing a
 * Firestore read per sample. Fails CLOSED on lookup errors.
 */
export function makeDeviceGate(opts: DeviceGateOptions): DeviceGate {
  const positiveTtl = opts.positiveTtlMs ?? 60_000;
  const negativeTtl = opts.negativeTtlMs ?? 15_000;
  const now = opts.nowMs ?? Date.now;
  const cache = new Map<string, CachedDevice>();

  return async (tenantId, projectId, deviceId) => {
    const cacheKey = `${tenantId}/${deviceId}`;
    let entry = cache.get(cacheKey);
    if (!entry || entry.expiresAtMs <= now()) {
      try {
        const snap = await opts.db
          .collection('tenants')
          .doc(tenantId)
          .collection('iot_devices')
          .doc(deviceId)
          .get();
        const data = snap.exists ? ((snap.data() ?? {}) as Record<string, unknown>) : null;
        entry = {
          data,
          expiresAtMs: now() + (data ? positiveTtl : negativeTtl),
        };
        cache.set(cacheKey, entry);
      } catch (err) {
        // Fail CLOSED: an outage must not open a write path into
        // life-safety telemetry. Not cached — recovers with Firestore.
        logger.warn('mqtt_bridge_device_lookup_failed', {
          tenantId,
          deviceId,
          message: err instanceof Error ? err.message : String(err),
        });
        return { ok: false, reason: 'lookup_failed' };
      }
    }
    if (entry.data === null) return { ok: false, reason: 'unregistered' };
    if (entry.data.status !== 'active') return { ok: false, reason: 'inactive' };
    if (entry.data.projectId !== projectId) {
      return { ok: false, reason: 'project_mismatch' };
    }
    const secret = entry.data.secret;
    return {
      ok: true,
      secret: typeof secret === 'string' && secret.length > 0 ? secret : null,
    };
  };
}

// ────────────────────────────────────────────────────────────────────────
// Message handler (orchestration — never throws)
// ────────────────────────────────────────────────────────────────────────

export interface MessageHandlerDeps {
  db: FirebaseFirestore.Firestore;
  messaging?: admin.messaging.Messaging;
  gate: DeviceGate;
  nowMs?: () => number;
}

export type MessageOutcome =
  | { outcome: 'persisted'; telemetryId: string | null }
  | { outcome: 'failed'; telemetryId: string | null }
  | { outcome: 'rejected'; reason: string }
  | { outcome: 'error' };

/**
 * Full per-message pipeline: sanitize → topic/payload identity match →
 * device gate → optional HMAC → persist. Total: it always resolves with
 * an outcome and NEVER rejects (a poison message must not take down the
 * subscription, let alone the server).
 */
export function makeMqttMessageHandler(deps: MessageHandlerDeps) {
  return async (
    rawSample: TelemetrySample,
    ctx: { tenantId: string; projectId: string; deviceId: string; topic: string },
  ): Promise<MessageOutcome> => {
    try {
      const raw = rawSample as unknown as Record<string, unknown>;
      const verdict = sanitizeInboundSample(raw, (deps.nowMs ?? Date.now)());
      if (!verdict.ok) {
        logger.warn('mqtt_bridge_sample_rejected', {
          reason: verdict.reason,
          topic: ctx.topic,
        });
        return { outcome: 'rejected', reason: verdict.reason };
      }
      // Topic identity is the trust anchor — payload must agree with it.
      if (verdict.sample.deviceId !== ctx.deviceId) {
        logger.warn('mqtt_bridge_sample_rejected', {
          reason: 'device_id_mismatch',
          topic: ctx.topic,
          payloadDeviceId: verdict.sample.deviceId,
        });
        return { outcome: 'rejected', reason: 'device_id_mismatch' };
      }
      const auth = await deps.gate(ctx.tenantId, ctx.projectId, ctx.deviceId);
      if (!auth.ok) {
        logger.warn('mqtt_bridge_device_rejected', {
          reason: auth.reason,
          tenantId: ctx.tenantId,
          projectId: ctx.projectId,
          deviceId: ctx.deviceId,
        });
        return { outcome: 'rejected', reason: auth.reason };
      }
      if (auth.secret !== null && !verifyDeviceSignature(raw, verdict.sig, auth.secret)) {
        logger.warn('mqtt_bridge_device_rejected', {
          reason: 'bad_signature',
          tenantId: ctx.tenantId,
          deviceId: ctx.deviceId,
        });
        return { outcome: 'rejected', reason: 'bad_signature' };
      }
      const result = await bridgeMqttToFirestore(verdict.sample, {
        tenantId: ctx.tenantId,
        projectId: ctx.projectId,
        zoneId: verdict.zoneId,
        db: deps.db,
        messaging: deps.messaging,
      });
      if (result.persistFailed) {
        // Anti-silent-loss: the telemetry row did NOT land in Firestore. Surface
        // it as 'failed' (not 'persisted') so metrics/observability can alert and
        // a future dead-letter can retry. The bridge already logged + Sentry'd.
        logger.warn('mqtt_bridge_persist_failed', {
          tenantId: ctx.tenantId,
          deviceId: ctx.deviceId,
        });
        return { outcome: 'failed', telemetryId: result.telemetryId };
      }
      return { outcome: 'persisted', telemetryId: result.telemetryId };
    } catch (err) {
      // bridgeMqttToFirestore already swallows step errors; this is the
      // last-resort isolation layer for anything unexpected.
      logger.error('mqtt_bridge_message_failed', err, { topic: ctx.topic });
      return { outcome: 'error' };
    }
  };
}

// ────────────────────────────────────────────────────────────────────────
// Lifecycle — boot + graceful shutdown
// ────────────────────────────────────────────────────────────────────────

export interface MqttBridgeHandle {
  /** Active adapter — exposed for integration tests (memory mode). */
  adapter: MqttAdapter;
  mode: MqttBridgeConfig['mode'];
  stop: () => Promise<void>;
}

export interface StartMqttBridgeDeps {
  env: Record<string, string | undefined>;
  /** Defaults to admin.firestore() — tests inject the fake. */
  db?: FirebaseFirestore.Firestore;
  messaging?: admin.messaging.Messaging;
  /** Test seam forwarded to createBrokerAdapter. */
  mqttModule?: MqttConnectModule;
  gate?: DeviceGate;
}

/**
 * Boot the bridge. Resolves to null (and logs exactly once) when the env
 * carries no broker config — no connection attempts, no errors. Never
 * throws: any boot failure is logged and reported as null so server.ts
 * continues serving HTTP regardless.
 */
export async function startMqttTelemetryBridge(
  deps: StartMqttBridgeDeps,
): Promise<MqttBridgeHandle | null> {
  const { config, disabledReason } = resolveMqttBridgeConfig(deps.env);
  if (!config) {
    if (disabledReason === 'disabled') {
      logger.info('mqtt_bridge_disabled', {
        hint: 'Set MQTT_BROKER_URL to enable the industrial-sensor MQTT bridge.',
      });
    } else {
      logger.error('mqtt_bridge_misconfigured', undefined, { reason: disabledReason });
    }
    return null;
  }

  try {
    const db = deps.db ?? admin.firestore();
    const adapter: MqttAdapter =
      config.mode === 'memory'
        ? new InMemoryAdapter()
        : await createBrokerAdapter({
            url: config.url,
            username: config.username,
            password: config.password,
            ca: config.ca,
            cert: config.cert,
            key: config.key,
            clientId: config.clientId,
            mqttModule: deps.mqttModule,
          });

    const gate = deps.gate ?? makeDeviceGate({ db });
    const handler = makeMqttMessageHandler({ db, messaging: deps.messaging, gate });

    const connected: ConnectedBroker = await connectMqttBroker({
      adapter: config.mode,
      adapterInstance: adapter,
      topicPrefix: config.mode === 'broker' ? config.topicPrefix : null,
      onTelemetry: async (sample, ctx) => {
        await handler(sample, ctx);
      },
    });

    logger.info('mqtt_bridge_started', {
      mode: config.mode,
      ...(config.mode === 'broker'
        ? { url: config.url, source: config.source, topicPrefix: config.topicPrefix }
        : {}),
    });

    return {
      adapter,
      mode: config.mode,
      stop: async () => {
        try {
          await connected.unsubscribe();
        } catch {
          /* shutdown — swallow */
        }
      },
    };
  } catch (err) {
    logger.error('mqtt_bridge_boot_failed', err, { mode: config.mode });
    return null;
  }
}
