// SystemEngine — Event schema (discriminated union).
//
// The bus is Firestore: writes to `projects/{projectId}/system_events` are
// emits, `onSnapshot` queries are subscriptions (A4 re-scope 2026-06 — the
// old `tenants/{tid}` path was default-denied and its tenant key never
// assigned; `tenantId` in the envelope is informational only). This file
// defines the typed envelopes every emitter and policy must agree on.
//
// Adding a new event type:
//   1) Define a Zod schema for the payload (NOT for the envelope).
//   2) Add `{ type: 'your_event', payload: YourPayload }` to the union below.
//   3) Add the type to `SystemEventType`.
//   4) (Optional) Add a policy that consumes it.
//
// The metadata field is intentionally `Record<string, unknown>` — extension
// without schema churn. Critical fields go on `payload` (typed); ad-hoc
// telemetry / debugging context goes on `metadata`.

import { z } from 'zod';

// ── Payload schemas ────────────────────────────────────────────────────

const FallDetectedPayload = z.object({
  workerId: z.string().min(1),
  projectId: z.string().min(1),
  confidence: z.number().min(0).max(1),
  accelMagnitude: z.number().nonnegative(),
});

const SosTriggeredPayload = z.object({
  workerId: z.string().min(1),
  projectId: z.string().min(1),
  emergencyType: z.string().min(1),
  origin: z.enum(['user_button', 'fall_detection', 'mandown', 'geofence', 'iot', 'other']),
});

const GeofenceCrossedPayload = z.object({
  workerId: z.string().min(1),
  projectId: z.string().min(1),
  zoneId: z.string().min(1),
  zoneName: z.string(),
  zoneType: z.enum(['HAZMAT', 'DANGER', 'RESTRICTED']),
  direction: z.enum(['enter', 'exit']),
  // Optional only for legacy/injected events without a location fix. Never
  // synthesize (0,0): consumers must distinguish "unknown" from a real point.
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
}).refine(
  payload => (payload.lat === undefined) === (payload.lng === undefined),
  { message: 'lat and lng must be provided together' },
);

const CountdownExpiredPayload = z.object({
  workerId: z.string().min(1),
  projectId: z.string().min(1),
  context: z.enum(['fall_detection', 'mandown', 'check_in']),
});

const NodeCreatedPayload = z.object({
  nodeId: z.string().min(1),
  projectId: z.string().min(1),
  nodeType: z.string().min(1),
  severity: z.string().optional(),
});

const NodeLinkedPayload = z.object({
  sourceId: z.string().min(1),
  targetId: z.string().min(1),
  projectId: z.string().min(1),
});

const NormativeUpdatedPayload = z.object({
  normativeId: z.string().min(1),
  jurisdiction: z.string().min(1),
});

const TierChangedPayload = z.object({
  userId: z.string().min(1),
  fromTier: z.string(),
  toTier: z.string(),
  source: z.enum(['webhook', 'admin', 'manual', 'webpay', 'mercadopago', 'google_play', 'apple']),
});

const EntitlementRevokedPayload = z.object({
  userId: z.string().min(1),
  reason: z.enum(['tier_downgrade', 'expired', 'admin_revoke', 'fraud']),
});

const WeatherAlertPayload = z.object({
  projectId: z.string().min(1),
  kind: z.enum(['wind', 'temp_high', 'temp_low', 'rain', 'storm', 'fire_risk']),
  value: z.number(),
  unit: z.string(),
});

const SeismicEventPayload = z.object({
  magnitude: z.number(),
  depthKm: z.number(),
  lat: z.number(),
  lng: z.number(),
  timestampMs: z.number(),
});

const ZettelkastenHealthChangedPayload = z.object({
  projectId: z.string().min(1),
  score: z.number().min(0).max(100),
  components: z.number().int().nonnegative(),
  cycles: z.number().int().nonnegative(),
  hasEulerianPath: z.boolean(),
  hasEulerianCycle: z.boolean(),
});

const AuditLogAppendedPayload = z.object({
  action: z.string().min(1),
  actorUid: z.string().nullable(),
  resourceId: z.string().optional(),
  result: z.enum(['ok', 'denied', 'failed']),
});

// ── Envelope ───────────────────────────────────────────────────────────

const Envelope = z.object({
  // `randomId()` returns crypto.randomUUID in production, but emits a
  // `fallback-...` string in environments without WebCrypto (older jsdom).
  // Strict UUID validation would reject those, so we accept any non-empty
  // identifier and rely on `randomId` for collision resistance.
  id: z.string().min(1).max(64),
  tenantId: z.string().min(1),
  projectId: z.string().optional(),
  actorUid: z.string().nullable().optional(),
  ts: z.number().int().nonnegative(),
  idempotencyKey: z.string().min(1).max(256),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const SystemEventSchema = z.discriminatedUnion('type', [
  Envelope.extend({ type: z.literal('fall_detected'), payload: FallDetectedPayload }),
  Envelope.extend({ type: z.literal('sos_triggered'), payload: SosTriggeredPayload }),
  Envelope.extend({ type: z.literal('geofence_crossed'), payload: GeofenceCrossedPayload }),
  Envelope.extend({ type: z.literal('countdown_expired'), payload: CountdownExpiredPayload }),
  Envelope.extend({ type: z.literal('node_created'), payload: NodeCreatedPayload }),
  Envelope.extend({ type: z.literal('node_linked'), payload: NodeLinkedPayload }),
  Envelope.extend({ type: z.literal('normative_updated'), payload: NormativeUpdatedPayload }),
  Envelope.extend({ type: z.literal('tier_changed'), payload: TierChangedPayload }),
  Envelope.extend({ type: z.literal('entitlement_revoked'), payload: EntitlementRevokedPayload }),
  Envelope.extend({ type: z.literal('weather_alert'), payload: WeatherAlertPayload }),
  Envelope.extend({ type: z.literal('seismic_event'), payload: SeismicEventPayload }),
  Envelope.extend({ type: z.literal('zettelkasten_health_changed'), payload: ZettelkastenHealthChangedPayload }),
  Envelope.extend({ type: z.literal('audit_log_appended'), payload: AuditLogAppendedPayload }),
]);

export type SystemEvent = z.infer<typeof SystemEventSchema>;
export type SystemEventType = SystemEvent['type'];

export type EventOfType<T extends SystemEventType> = Extract<SystemEvent, { type: T }>;

export const ALL_EVENT_TYPES: readonly SystemEventType[] = [
  'fall_detected',
  'sos_triggered',
  'geofence_crossed',
  'countdown_expired',
  'node_created',
  'node_linked',
  'normative_updated',
  'tier_changed',
  'entitlement_revoked',
  'weather_alert',
  'seismic_event',
  'zettelkasten_health_changed',
  'audit_log_appended',
] as const;

export function isSystemEvent(value: unknown): value is SystemEvent {
  return SystemEventSchema.safeParse(value).success;
}
