/**
 * Analytics — typed event surface (ninth wave, Bucket D).
 *
 * Source-of-truth for the event names + property shapes is the design
 * artefacts shipped in the eighth wave (commit `eebcdbd`):
 *   - `docs/tracking/TRACKING_PLAN.md` (principles)
 *   - `docs/tracking/event-catalog.md` (44 events)
 *   - `docs/tracking/property-glossary.md` (typed properties)
 *   - `.telemetry/proposed-events.yaml` (machine-readable manifest)
 *
 * This file declares ONLY the 5 activation-funnel events the ninth wave
 * actually wires (TRACKING_PLAN §6.1):
 *   1. auth.user.signed_up
 *   2. project.created
 *   3. project.member.invited
 *   4. risk.reported.manual
 *   5. tarea.completed
 *
 * The remaining 39 events are deferred to subsequent buckets and will
 * extend the `EventName` union + add their per-event prop interfaces.
 *
 * The shape mirrors the YAML: required event-specific props + the common
 * prop block (TRACKING_PLAN §4.8) that the adapter fills in automatically.
 *
 * No runtime values here — pure type declarations so `tsc --noEmit` is the
 * only consumer at build time and the adapter is the only consumer at run
 * time.
 */

// TODO add remaining 39 events from event-catalog.md (auth.user.signed_in,
// project.member.accepted, ..., app.mode.switched). Each adds a literal to
// `EventName`, a `*Properties` interface, and a row in
// `EventPropertiesMap`. The 5 activation events stay first because
// downstream funnels assume that ordering (TRACKING_PLAN §6.1).

/**
 * The 5 activation-funnel event names wired in this wave.
 *
 * Closed string-literal union so `analytics.track('typo.event', ...)`
 * fails at compile time. New events are appended to the union (and to
 * `EventPropertiesMap` below) — never reordered, since dashboards key off
 * the name strings.
 */
export type EventName =
  | 'auth.user.signed_up'
  | 'project.created'
  | 'project.member.invited'
  | 'risk.reported.manual'
  | 'tarea.completed'
  // 10th wave additions — see catalog rows 21–22, 35, 65, 67, 74–75, 118.
  | 'auth.user.signed_in'
  | 'auth.user.signed_out'
  | 'project.archived'
  | 'slm.query.online'
  | 'slm.query.offline'
  | 'app.mode.switched'
  | 'emergency.checkin.completed';

/**
 * Common props attached to every event.
 *
 * Mirrors TRACKING_PLAN §4.8 minus `sample_rate` and `app_env` (the
 * adapter resolves those from the runtime sample policy + Vite env at
 * fire time and writes them in alongside these). `user_id_hash` and
 * `project_id` are context-conditional — omitted when there is no
 * user/project (auth pages, public landing) — so they're optional here.
 */
export interface CommonProperties {
  event_version: string;
  app_version: string;
  app_env: 'production' | 'staging' | 'dev';
  app_mode: 'normal-light' | 'normal-dark' | 'driving' | 'emergency';
  locale: string;
  device_class:
    | 'web-desktop'
    | 'web-mobile'
    | 'web-tablet'
    | 'capacitor-android'
    | 'capacitor-ios';
  online: boolean;
  timestamp_iso: string;
  sample_rate: number;
  user_id_hash?: string;
  project_id?: string;
  /** Reserved system prop — threads multi-event flows. */
  correlation_id?: string;
}

// ---------------------------------------------------------------------------
// Per-event properties — required + optional shape from the catalog.
// ---------------------------------------------------------------------------

/** Auth providers supported in v1 (property-glossary "Auth-specific"). */
export type AuthProvider = 'google' | 'webauthn' | 'email_link';

export interface AuthUserSignedUpProperties extends CommonProperties {
  provider: AuthProvider;
  invited_by_project_id?: string;
}

/** Project-tier set: pricing tiers + B2D API tiers (property-glossary). */
export type ProjectTier =
  | 'free'
  | 'essentials'
  | 'professional'
  | 'enterprise'
  | 'government'
  | 'api_climate'
  | 'api_hazmat'
  | 'api_normativa';

export type IndustryCode =
  | 'mining'
  | 'construction'
  | 'agriculture'
  | 'manufacturing'
  | 'energy'
  | 'transport'
  | 'services'
  | 'other';

export interface ProjectCreatedProperties extends CommonProperties {
  project_tier: ProjectTier;
  industry_code: IndustryCode;
}

export type Role =
  | 'worker'
  | 'supervisor'
  | 'prevencionista'
  | 'admin'
  | 'executive';

export type InviteChannel = 'link' | 'email' | 'sms' | 'whatsapp';

export interface ProjectMemberInvitedProperties extends CommonProperties {
  target_role: Role;
  invited_by_user_id_hash: string;
  invite_channel?: InviteChannel;
}

export type RiskClass =
  | 'chemical'
  | 'mechanical'
  | 'electrical'
  | 'ergonomic'
  | 'psychosocial'
  | 'noise'
  | 'fall'
  | 'weather'
  | 'seismic';

export type Severity = 'low' | 'medium' | 'high' | 'critical';

export interface RiskReportedManualProperties extends CommonProperties {
  risk_id: string;
  risk_class: RiskClass;
  severity: Severity;
  commune_code?: string;
  reporter_role_hash?: string;
}

export interface TareaCompletedProperties extends CommonProperties {
  tarea_id: string;
  proceso_id: string;
  time_to_complete_seconds: number;
  closed_by_user_id_hash?: string;
}

// ---------------------------------------------------------------------------
// 10th wave additions — types matching catalog rows for the 7 new events.
// Source-of-truth: docs/tracking/event-catalog.md + .telemetry/proposed-events.yaml.
// ---------------------------------------------------------------------------

export interface AuthUserSignedInProperties extends CommonProperties {
  provider: AuthProvider;
  mfa_used: boolean;
}

/** Optional reason for sign-out — kept narrow to avoid free-text PII. */
export type SignoutReason = 'user_initiated' | 'session_expired' | 'auto_logout' | 'forced';

export interface AuthUserSignedOutProperties extends CommonProperties {
  signout_reason?: SignoutReason;
}

export type ArchiveReason = 'completed' | 'cancelled' | 'merged' | 'inactive' | 'other';

export interface ProjectArchivedProperties extends CommonProperties {
  archived_by_user_id_hash: string;
  archive_reason?: ArchiveReason;
}

/** Coarse-grained query category — kept low-cardinality for dashboards. */
export type SlmQueryKind = 'general' | 'risk' | 'compliance' | 'emergency' | 'asesor';

export interface SlmQueryOnlineProperties extends CommonProperties {
  query_kind: SlmQueryKind;
  latency_ms: number;
  prompt_token_count: number;
  success: boolean;
  model_id?: string;
}

export interface SlmQueryOfflineProperties extends CommonProperties {
  query_kind: SlmQueryKind;
  latency_ms: number;
  model_id: string;
  prompt_token_count: number;
}

/**
 * Mode literals — match `AppModeContext.AppMode` runtime union exactly.
 * Light/dark is a separate dimension (`appearance`) and travels in a
 * different event class; we don't conflate them in analytics.
 */
export type AppModeName = 'normal' | 'driving' | 'emergency';

/** Why the mode switch fired — manual UI vs. automatic detection. */
export type AppModeTriggerKind = 'manual' | 'auto_emergency' | 'auto_driving' | 'auto_appearance';

export interface AppModeSwitchedProperties extends CommonProperties {
  from_mode: AppModeName;
  to_mode: AppModeName;
  trigger_kind: AppModeTriggerKind;
}

/** Whether the check-in was prompted by a schedule or by the worker. */
export type CheckinKind = 'manual' | 'scheduled';

/** Outcome the worker reported during the check-in. */
export type CheckinStatus = 'safe' | 'danger' | 'unknown';

export interface EmergencyCheckinCompletedProperties extends CommonProperties {
  checkin_kind: CheckinKind;
  status: CheckinStatus;
  scheduled_for_iso?: string;
  delay_seconds?: number;
}

/**
 * Map from event name → its full property shape. Used by `Event<N>` below
 * so `analytics.track(name, props)` validates `props` against the right
 * row of the catalog at compile time.
 */
export interface EventPropertiesMap {
  'auth.user.signed_up': AuthUserSignedUpProperties;
  'project.created': ProjectCreatedProperties;
  'project.member.invited': ProjectMemberInvitedProperties;
  'risk.reported.manual': RiskReportedManualProperties;
  'tarea.completed': TareaCompletedProperties;
  // 10th wave additions
  'auth.user.signed_in': AuthUserSignedInProperties;
  'auth.user.signed_out': AuthUserSignedOutProperties;
  'project.archived': ProjectArchivedProperties;
  'slm.query.online': SlmQueryOnlineProperties;
  'slm.query.offline': SlmQueryOfflineProperties;
  'app.mode.switched': AppModeSwitchedProperties;
  'emergency.checkin.completed': EmergencyCheckinCompletedProperties;
}

/**
 * A fully-typed event ready to ship to a sink. The adapter constructs
 * one of these after merging the caller's per-event props with the
 * resolved common props (see `getCommonProps()` in adapter.ts).
 */
export interface Event<N extends EventName = EventName> {
  name: N;
  properties: EventPropertiesMap[N];
}

/**
 * The slice of properties a caller passes to `track()`. The adapter
 * fills in everything in `CommonProperties`, so callers only specify the
 * event-specific keys (plus optionals).
 *
 * `Omit` is keyed on the keys of `CommonProperties` so adding a new
 * common prop (TRACKING_PLAN §4.8) automatically removes it from the
 * caller-provided slice.
 */
export type EventInputProps<N extends EventName> = Omit<
  EventPropertiesMap[N],
  keyof CommonProperties
> &
  Partial<Pick<CommonProperties, 'user_id_hash' | 'project_id' | 'correlation_id'>>;

/**
 * Sink contract — anything that consumes events. The adapter fans out
 * each event to every configured sink in parallel; sink failures are
 * caught and logged via Sentry breadcrumb but never propagate (analytics
 * MUST NOT break user flow — TRACKING_PLAN §11).
 */
export interface Sink {
  /** Stable identifier for log + breadcrumb messages. */
  readonly name: string;
  /** Forward an event. Resolves regardless of whether transport succeeded. */
  track(event: Event<EventName>): Promise<void>;
  /** Drain any internal buffer. Called on `online` event by the adapter. */
  flush(): Promise<void>;
}
