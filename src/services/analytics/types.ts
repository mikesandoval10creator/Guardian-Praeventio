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
  | 'emergency.checkin.completed'
  // 11th wave additions — see catalog rows 100–102, 108.
  | 'payment.checkout.started'
  | 'payment.transaction.succeeded'
  | 'payment.transaction.failed'
  | 'knowledge.doc.viewed'
  // 12th wave additions — see catalog rows 76–78 (SLM) and 116–117 (app shell).
  | 'app.opened'
  | 'app.backgrounded'
  | 'slm.queue.grew'
  | 'slm.queue.reconciled'
  | 'slm.model.downloaded'
  // 13th wave additions — see catalog rows 23–24 (auth.role.*),
  // 109–110 (knowledge.zk.*) plus a new `tarea.escalated` row added in
  // this wave to docs/tracking/event-catalog.md + .telemetry/proposed-events.yaml.
  | 'auth.role.granted'
  | 'auth.role.revoked'
  | 'knowledge.zk.node.created'
  | 'knowledge.zk.link.traversed'
  | 'tarea.escalated'
  // 14th wave additions — see catalog rows 48 (proceso.created), 58–60
  // (risk.detected.predictive + risk.resolved), 94 (suseso.form.submitted)
  // plus a new `payment.checkout.cancelled` row added in this wave to
  // docs/tracking/event-catalog.md + .telemetry/proposed-events.yaml.
  | 'suseso.form.submitted'
  | 'proceso.created'
  | 'risk.detected.predictive'
  | 'risk.resolved'
  | 'payment.checkout.cancelled'
  // 15th wave additions — see catalog rows 49 (tarea.created),
  // 51 (tarea.blocked), 85–87 (Comité Paritario × 3). Property enums are
  // copied verbatim from docs/tracking/property-glossary.md — drift hunt
  // for this wave was `block_reason_code` enum (missing_epp|weather|
  // dependency|injury|other), `drafted_by_kind` enum (manual|gemini_assist
  // — the catalog description uses "Gemini-assisted" but the glossary spells
  // it `gemini_assist`), and `task_priority` enum (low|medium|high|critical).
  | 'comite.meeting.scheduled'
  | 'comite.minutes.drafted'
  | 'comite.action_item.assigned'
  | 'tarea.created'
  | 'tarea.blocked'
  // 16th wave additions — final 10 unwired catalog rows. After this wave
  // EventName covers every row in docs/tracking/event-catalog.md (full 45/45
  // typed coverage; 3 of these are typed-only and lack a sensible wire-point
  // today — see commit description for which deferrals lack a surface).
  // Source: docs/tracking/event-catalog.md (Project, Cuadrilla, Emergency,
  // SUSESO sections) + property-glossary.md.
  | 'project.member.accepted'
  | 'project.member.removed'
  | 'cuadrilla.created'
  | 'cuadrilla.member.added'
  | 'cuadrilla.member.swapped'
  | 'emergency.sos.triggered'
  | 'emergency.fall.detected'
  | 'emergency.evacuation.started'
  | 'suseso.form.started'
  | 'suseso.form.rejected';

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

// ---------------------------------------------------------------------------
// 11th wave additions — types matching catalog rows for the 4 new events.
// Source-of-truth: docs/tracking/event-catalog.md (rows 100–102, 108) +
// .telemetry/proposed-events.yaml.
// ---------------------------------------------------------------------------

/** Payment gateways — Stripe intentionally absent (project_business_decisions_2026-05-03). */
export type PaymentGateway = 'webpay' | 'khipu' | 'mercadopago' | 'google_play';

export interface PaymentCheckoutStartedProperties extends CommonProperties {
  gateway: PaymentGateway;
  plan_code: string;
  amount_clp: number;
}

export interface PaymentTransactionSucceededProperties extends CommonProperties {
  gateway: PaymentGateway;
  plan_code: string;
  amount_clp: number;
  transaction_id_hash: string;
  auth_latency_ms?: number;
}

export interface PaymentTransactionFailedProperties extends CommonProperties {
  gateway: PaymentGateway;
  plan_code: string;
  failure_code: string;
  amount_clp?: number;
}

/** Doc kinds — mirrors catalog enum exactly (property-glossary row 170). */
export type DocKind = 'regulatory' | 'manual' | 'incident_report' | 'training' | 'other';

export interface KnowledgeDocViewedProperties extends CommonProperties {
  doc_id: string;
  doc_kind: DocKind;
  view_duration_seconds_estimate?: number;
}

// ---------------------------------------------------------------------------
// 12th wave additions — types matching catalog rows for the 5 new events.
// Source-of-truth: docs/tracking/event-catalog.md (rows 76–78 for SLM,
// rows 116–117 for app shell) + property-glossary "App shell" + "SLM"
// sections. Names + enums copied verbatim — drift hunt for the wave was
// `boot_kind` (catalog) NOT `launch_kind`, `cache_origin` enum (cdn|peer|
// pre_packaged) NOT cache|network, and `pass_duration_ms` (catalog) NOT
// `duration_ms`.
// ---------------------------------------------------------------------------

/** Discriminator for `app.opened` — catalog enum (`boot_kind`). */
export type BootKind = 'cold' | 'warm' | 'pwa_resume';

export interface AppOpenedProperties extends CommonProperties {
  boot_kind: BootKind;
  /** Seconds since the previous `app.opened` for the same browser. */
  last_open_delta_seconds?: number;
}

export interface AppBackgroundedProperties extends CommonProperties {
  /** Foreground time before the page hid (catalog optional). */
  foreground_duration_seconds?: number;
}

export interface SlmQueueGrewProperties extends CommonProperties {
  queue_depth_after: number;
  /** UUID of the queued offline session — joins to ZK once reconciled. */
  session_id: string;
}

export interface SlmQueueReconciledProperties extends CommonProperties {
  attempted: number;
  succeeded: number;
  failed: number;
  pass_duration_ms?: number;
}

/** Origin of the cached/fetched bytes (catalog enum on `cache_origin`). */
export type CacheOrigin = 'cdn' | 'peer' | 'pre_packaged';

export interface SlmModelDownloadedProperties extends CommonProperties {
  model_id: string;
  model_bytes: number;
  download_duration_ms: number;
  cache_origin?: CacheOrigin;
}

// ---------------------------------------------------------------------------
// 13th wave additions — types matching catalog rows for the 5 new events.
// Source-of-truth: docs/tracking/event-catalog.md (rows 23–24 for auth.role.*,
// 109–110 for knowledge.zk.*) + .telemetry/proposed-events.yaml. The
// `tarea.escalated` row is brand-new — added to both manifests in this wave
// (the catalog had only created/completed/blocked under Tarea; escalation
// was the implicit gap).
// ---------------------------------------------------------------------------

export interface AuthRoleGrantedProperties extends CommonProperties {
  role: Role;
  granted_by_user_id_hash: string;
}

/** Why a role was revoked — narrow enum keeps the column low-cardinality. */
export type RevocationReason = 'admin_action' | 'role_change' | 'user_left' | 'security_incident' | 'other';

export interface AuthRoleRevokedProperties extends CommonProperties {
  role: Role;
  revoked_by_user_id_hash: string;
  revocation_reason?: RevocationReason;
}

/**
 * Zettelkasten node kinds — coarse-grained taxonomy that mirrors the
 * `NodeType` runtime enum without coupling analytics to the entire
 * domain enum (which leaks UI labels). Add new kinds here only if the
 * catalog row is bumped.
 */
export type ZkNodeKind =
  | 'risk'
  | 'finding'
  | 'incident'
  | 'control'
  | 'normative'
  | 'task'
  | 'worker'
  | 'project'
  | 'audit'
  | 'epp'
  | 'asset'
  | 'other';

export interface KnowledgeZkNodeCreatedProperties extends CommonProperties {
  zk_node_id: string;
  zk_node_kind: ZkNodeKind;
  source_session_id?: string;
}

/** How the user reached the link — click vs keyboard nav vs deep-link. */
export type ZkLinkKind = 'backlink' | 'forward' | 'smart_action' | 'deep_link';

export interface KnowledgeZkLinkTraversedProperties extends CommonProperties {
  zk_node_id_from: string;
  zk_node_id_to: string;
  link_kind: ZkLinkKind;
}

/**
 * Why a tarea was escalated. `pause` covers the worker-pauses-and-asks-for-help
 * path; `block_unresolved` is when a `tarea.blocked` lingers past SLA;
 * `manual_supervisor_request` is when the worker explicitly asks for help
 * via UI; `auto_sla` is reserved for future server-side timers.
 */
export type TareaEscalationKind =
  | 'pause'
  | 'block_unresolved'
  | 'manual_supervisor_request'
  | 'auto_sla';

export interface TareaEscalatedProperties extends CommonProperties {
  tarea_id: string;
  proceso_id: string;
  escalation_kind: TareaEscalationKind;
  /** Process status before the escalation fired (org domain enum). */
  from_status?: string;
  /** Process status after the escalation fired. */
  to_status?: string;
}

// ---------------------------------------------------------------------------
// 14th wave additions — types matching catalog rows for the 5 new events.
// Source-of-truth: docs/tracking/event-catalog.md (rows 48, 58, 60, 94)
// + .telemetry/proposed-events.yaml. The `payment.checkout.cancelled` row
// is brand-new — added to both manifests in this wave (the catalog had
// only checkout.started + transaction.{succeeded,failed} under Payments;
// explicit user-cancellation was the gap, distinct from gateway rejection
// because the user never reached authorisation).
// Property names match property-glossary.md verbatim — drift hunt this
// wave was `proceso_template` enum (iper|prexor|tmert|custom) and
// `resolution_kind` enum (tarea_completed|protocol_applied|escalated|
// false_positive). `detector_kind` shares the seven-value enum from the
// glossary (iper|prexor|tmert|weather|seismic|wearable|cv_model).
// ---------------------------------------------------------------------------

/** SUSESO form variant — only istas21 short/full are in scope at v1. */
export type SusesoFormKind = 'istas21_short' | 'istas21_full';

export interface SusesoFormSubmittedProperties extends CommonProperties {
  form_kind: SusesoFormKind;
  dimension_count: number;
  time_to_submit_seconds: number;
}

/** Proceso template — coarse taxonomy mirroring services/protocols/. */
export type ProcesoTemplate = 'iper' | 'prexor' | 'tmert' | 'custom';

export interface ProcesoCreatedProperties extends CommonProperties {
  proceso_id: string;
  proceso_template: ProcesoTemplate;
  parent_proceso_id?: string;
}

/** Detector kind for predictive risk — mirrors property-glossary "Risk". */
export type DetectorKind =
  | 'iper'
  | 'prexor'
  | 'tmert'
  | 'weather'
  | 'seismic'
  | 'wearable'
  | 'cv_model';

export interface RiskDetectedPredictiveProperties extends CommonProperties {
  risk_id: string;
  risk_class: RiskClass;
  severity: Severity;
  detector_kind: DetectorKind;
  confidence_pct?: number;
  commune_code?: string;
}

/**
 * How the risk was resolved. `tarea_completed` is the canonical "fixed
 * via task work"; `protocol_applied` covers ack-only paths (e.g. Man Down
 * widget) where a protocol was followed without a discrete tarea;
 * `escalated` is when ownership moved up; `false_positive` retires a
 * detector hit that turned out to be noise.
 */
export type ResolutionKind =
  | 'tarea_completed'
  | 'protocol_applied'
  | 'escalated'
  | 'false_positive';

export interface RiskResolvedProperties extends CommonProperties {
  risk_id: string;
  risk_class: RiskClass;
  time_to_resolve_seconds: number;
  resolution_kind: ResolutionKind;
}

/**
 * User-initiated checkout cancellation — distinct from
 * `payment.transaction.failed` (gateway rejection) because the user
 * abandoned BEFORE authorisation. `amount_clp` is optional because the
 * cancellation can happen before the user picked a tier total in some
 * gateways (e.g. Khipu QR scan timeout).
 */
export interface PaymentCheckoutCancelledProperties extends CommonProperties {
  gateway: PaymentGateway;
  plan_code: string;
  amount_clp?: number;
}

// ---------------------------------------------------------------------------
// 15th wave additions — types matching catalog rows for the 5 new events.
// Source-of-truth: docs/tracking/event-catalog.md (rows 49, 51, 85–87)
// + docs/tracking/property-glossary.md (Procesos & Tareas section + Comité
// Paritario section). Property enums are tightly constrained at the
// glossary level so we mirror them as closed unions instead of `string`.
// ---------------------------------------------------------------------------

/** Coarse priority bucket for a tarea (property-glossary "Procesos & Tareas"). */
export type TaskPriority = 'low' | 'medium' | 'high' | 'critical';

export interface TareaCreatedProperties extends CommonProperties {
  tarea_id: string;
  proceso_id: string;
  task_priority: TaskPriority;
  /** Joins to the safety closed-loop when the tarea was generated from a risk row. */
  created_from_risk_id?: string;
}

/**
 * Closed reason codes for tarea blockers. The list is intentionally narrow —
 * free-text notes travel as a `block_note_length` integer (never the text
 * itself) so we keep the dashboard cardinality bounded.
 */
export type BlockReasonCode =
  | 'missing_epp'
  | 'weather'
  | 'dependency'
  | 'injury'
  | 'other';

export interface TareaBlockedProperties extends CommonProperties {
  tarea_id: string;
  proceso_id: string;
  block_reason_code: BlockReasonCode;
  /** Length only — never the note text (PII). */
  block_note_length?: number;
}

export interface ComiteMeetingScheduledProperties extends CommonProperties {
  meeting_id: string;
  scheduled_for_iso: string;
  agenda_item_count?: number;
}

/**
 * Whether the acta was authored by a human or generated by a Gemini-assisted
 * pipeline. Catalog says "Gemini-assisted or manual"; the glossary spells
 * the enum value `gemini_assist` — we match the glossary exactly.
 */
export type DraftedByKind = 'manual' | 'gemini_assist';

export interface ComiteMinutesDraftedProperties extends CommonProperties {
  meeting_id: string;
  drafted_by_kind: DraftedByKind;
}

export interface ComiteActionItemAssignedProperties extends CommonProperties {
  action_item_id: string;
  meeting_id: string;
  /** sha256 hex of the assignee's role label — never the human-readable role. */
  assignee_role_hash: string;
  due_in_days?: number;
}

// ---------------------------------------------------------------------------
// 16th wave additions — final 10 catalog rows. After this wave the EventName
// union matches docs/tracking/event-catalog.md row-for-row. Three rows are
// typed but currently unwired (no sensible surface yet — see commit
// description): `cuadrilla.member.swapped`, `suseso.form.rejected`, and
// `project.archived` (already typed in 10th wave but lacks a UI archive
// button). Property names + enums copied verbatim from
// docs/tracking/property-glossary.md — drift hunt this wave was
// `removal_reason` enum (`offboarding|policy_change|manual` from glossary
// row 58 — NOT the broader `RevocationReason` enum) and `swap_reason` enum
// (`vacation|injury|transfer|manual` from glossary row 71).
// ---------------------------------------------------------------------------

/** Why an invite was accepted as a particular role — same set as `role`. */
export interface ProjectMemberAcceptedProperties extends CommonProperties {
  accepted_role: Role;
  /** Time between invite emission and acceptance (catalog optional). */
  accept_latency_seconds?: number;
}

/**
 * Why a member was removed. Glossary row 58 lists three values; we mirror
 * those exactly so the dashboard column stays low-cardinality. Distinct
 * from `RevocationReason` (used for role revokes, not member removals).
 */
export type RemovalReason = 'offboarding' | 'policy_change' | 'manual';

export interface ProjectMemberRemovedProperties extends CommonProperties {
  target_user_id_hash: string;
  removed_by_user_id_hash: string;
  removal_reason?: RemovalReason;
}

export interface CuadrillaCreatedProperties extends CommonProperties {
  cuadrilla_id: string;
  member_count: number;
  parent_proceso_id?: string;
}

export interface CuadrillaMemberAddedProperties extends CommonProperties {
  cuadrilla_id: string;
  target_user_id_hash: string;
  member_role: Role;
}

/**
 * Why a worker was swapped. `injury` is flagged `low` PII risk in the
 * glossary because it correlates with safety status; the rest are routine
 * operational reasons.
 */
export type SwapReason = 'vacation' | 'injury' | 'transfer' | 'manual';

export interface CuadrillaMemberSwappedProperties extends CommonProperties {
  cuadrilla_id: string;
  out_user_id_hash: string;
  in_user_id_hash: string;
  swap_reason?: SwapReason;
}

/**
 * Reason the SOS button was activated. The catalog enum for `sos_type`
 * mirrors the SOSButton payload keys — these collapse the freeform
 * `type` field to a closed set so dashboards stay legible.
 */
export type SosType = 'medical' | 'accident' | 'evacuation' | 'assault' | 'unknown';

/** How the SOS surface was reached — long-press vs auto-detection. */
export type TriggerSource = 'long_press' | 'auto_fall' | 'auto_geofence' | 'voice';

/** Network kind at the time of trigger — distinguishes mesh fallbacks. */
export type NetworkKind = 'wifi' | 'cellular_4g' | 'cellular_5g' | 'bluetooth_mesh' | 'unknown';

export interface EmergencySosTriggeredProperties extends CommonProperties {
  sos_type: SosType;
  trigger_source: TriggerSource;
  /** sha256 hex of the worker's role label (never the raw role). */
  role_hash: string;
  commune_code?: string;
  network_kind?: NetworkKind;
}

export interface EmergencyFallDetectedProperties extends CommonProperties {
  /** Confidence score 0..100 from the accelerometer impact heuristic. */
  confidence_pct: number;
  /** Length of accelerometer window in ms that triggered the fall heuristic. */
  accel_window_ms: number;
  role_hash: string;
  commune_code?: string;
}

export interface EmergencyEvacuationStartedProperties extends CommonProperties {
  evacuation_route_id: string;
  protocol_id: string;
}

export interface SusesoFormStartedProperties extends CommonProperties {
  form_kind: SusesoFormKind;
}

/**
 * SUSESO API rejection codes — the vocabulary lives in
 * `services/normativa/`. Free-form string because gateway-style codes are
 * not enumerable in advance (e.g. `E_INCOMPLETE`, `E_DUPLICATE`).
 */
export interface SusesoFormRejectedProperties extends CommonProperties {
  form_kind: SusesoFormKind;
  rejection_code: string;
  retry_count?: number;
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
  // 11th wave additions
  'payment.checkout.started': PaymentCheckoutStartedProperties;
  'payment.transaction.succeeded': PaymentTransactionSucceededProperties;
  'payment.transaction.failed': PaymentTransactionFailedProperties;
  'knowledge.doc.viewed': KnowledgeDocViewedProperties;
  // 12th wave additions
  'app.opened': AppOpenedProperties;
  'app.backgrounded': AppBackgroundedProperties;
  'slm.queue.grew': SlmQueueGrewProperties;
  'slm.queue.reconciled': SlmQueueReconciledProperties;
  'slm.model.downloaded': SlmModelDownloadedProperties;
  // 13th wave additions
  'auth.role.granted': AuthRoleGrantedProperties;
  'auth.role.revoked': AuthRoleRevokedProperties;
  'knowledge.zk.node.created': KnowledgeZkNodeCreatedProperties;
  'knowledge.zk.link.traversed': KnowledgeZkLinkTraversedProperties;
  'tarea.escalated': TareaEscalatedProperties;
  // 14th wave additions
  'suseso.form.submitted': SusesoFormSubmittedProperties;
  'proceso.created': ProcesoCreatedProperties;
  'risk.detected.predictive': RiskDetectedPredictiveProperties;
  'risk.resolved': RiskResolvedProperties;
  'payment.checkout.cancelled': PaymentCheckoutCancelledProperties;
  // 15th wave additions
  'comite.meeting.scheduled': ComiteMeetingScheduledProperties;
  'comite.minutes.drafted': ComiteMinutesDraftedProperties;
  'comite.action_item.assigned': ComiteActionItemAssignedProperties;
  'tarea.created': TareaCreatedProperties;
  'tarea.blocked': TareaBlockedProperties;
  // 16th wave additions — final 10 rows for full 45/45 type coverage
  'project.member.accepted': ProjectMemberAcceptedProperties;
  'project.member.removed': ProjectMemberRemovedProperties;
  'cuadrilla.created': CuadrillaCreatedProperties;
  'cuadrilla.member.added': CuadrillaMemberAddedProperties;
  'cuadrilla.member.swapped': CuadrillaMemberSwappedProperties;
  'emergency.sos.triggered': EmergencySosTriggeredProperties;
  'emergency.fall.detected': EmergencyFallDetectedProperties;
  'emergency.evacuation.started': EmergencyEvacuationStartedProperties;
  'suseso.form.started': SusesoFormStartedProperties;
  'suseso.form.rejected': SusesoFormRejectedProperties;
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
